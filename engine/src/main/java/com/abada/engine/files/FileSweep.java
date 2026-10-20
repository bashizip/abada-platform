package com.abada.engine.files;

import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.repository.FileSweepLeaseRepository;
import com.abada.engine.persistence.repository.ProcessFileRepository;
import java.net.InetAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Durable deletion of process files (S9). State lives in the rows, so a
 * restart resumes and replicas share the work:
 * <ol>
 *   <li>{@code PENDING} files older than the pending TTL (24 h), and attached
 *       files of instances that ended longer ago than the project's retention,
 *       become {@code DELETING};</li>
 *   <li>a replica claims {@code DELETING} rows with {@code SKIP LOCKED} and a
 *       lease, deletes their objects outside any transaction, then removes the
 *       rows it still holds. Deleting an absent object counts as done, so a
 *       retry after a crash or an expired lease is safe (at-least-once);</li>
 *   <li>once a day, under a singleton lease, objects with no row and older
 *       than the grace period (failed uploads, a database restored without
 *       its files) are deleted.</li>
 * </ol>
 */
@Component
public class FileSweep {
    private static final Logger log = LoggerFactory.getLogger(FileSweep.class);
    static final int BATCH = 100;
    static final int LIST_PAGE = 500;
    static final String ORPHANS = "orphans";

    public record Result(int marked, int deleted, int failed, int orphansDeleted) {
    }

    private final ProcessFileRepository files;
    private final FileSweepLeaseRepository leases;
    private final ObjectStore store;
    private final FilesProperties properties;
    private final ActivityHistoryService history;
    private final TransactionTemplate transactions;
    private final String owner;
    private final boolean enabled;

    public FileSweep(ProcessFileRepository files, FileSweepLeaseRepository leases, ObjectStore store,
            FilesProperties properties, ActivityHistoryService history, TransactionTemplate transactions,
            @Value("${abada.files.sweep.enabled:true}") boolean enabled) {
        this.files = files;
        this.leases = leases;
        this.store = store;
        this.properties = properties;
        this.history = history;
        this.transactions = transactions;
        this.enabled = enabled;
        this.owner = hostname() + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    @Scheduled(fixedDelayString = "${abada.files.sweep.interval-ms:300000}",
            initialDelayString = "${abada.files.sweep.initial-delay-ms:90000}")
    public void scheduledSweep() {
        if (!enabled) return;
        try {
            Result result = sweep(Instant.now());
            if (result.marked() + result.deleted() + result.failed() + result.orphansDeleted() > 0) {
                log.info("file_sweep marked={} deleted={} failed={} orphans_deleted={}", result.marked(),
                        result.deleted(), result.failed(), result.orphansDeleted());
            }
        } catch (RuntimeException exception) {
            log.warn("file_sweep_failed reason={}", exception.getMessage());
        }
    }

    /** One full pass at {@code now}, as this replica. */
    public Result sweep(Instant now) {
        return sweep(now, owner);
    }

    /** One full pass as a given replica; tests run two replicas side by side. */
    public Result sweep(Instant now, String replica) {
        int marked = mark(now);
        int deleted = 0;
        int failed = 0;
        List<ProcessFileEntity> claimed;
        do {
            claimed = claim(now, replica);
            for (ProcessFileEntity row : claimed) {
                if (deleteOne(row, replica, now)) deleted++;
                else failed++;
            }
        } while (claimed.size() == BATCH && failed == 0);
        int orphans = orphans(now, replica);
        return new Result(marked, deleted, failed, orphans);
    }

    int mark(Instant now) {
        Integer expired = transactions.execute(status -> files.expirePending(now.minus(properties.pendingTtl())));
        Integer retained = transactions.execute(status -> files.expireRetained(now));
        return (expired == null ? 0 : expired) + (retained == null ? 0 : retained);
    }

    private List<ProcessFileEntity> claim(Instant now, String replica) {
        List<ProcessFileEntity> claimed = transactions.execute(status -> {
            List<ProcessFileEntity> rows = files.claimDeletable(now, BATCH);
            for (ProcessFileEntity row : rows) {
                row.setLeaseOwner(replica);
                row.setLeaseExpiresAt(now.plus(properties.lease()));
                row.setAttempts(row.getAttempts() + 1);
            }
            return files.saveAll(rows);
        });
        return claimed == null ? List.of() : claimed;
    }

    /** Deletes the object (no transaction open), then the row if this replica still holds it. */
    private boolean deleteOne(ProcessFileEntity row, String replica, Instant now) {
        try {
            store.delete(row.getObjectKey());
        } catch (RuntimeException exception) {
            String reason = exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage();
            transactions.executeWithoutResult(status -> files.findById(row.getId()).ifPresent(current -> {
                if (!replica.equals(current.getLeaseOwner())) return;
                current.setLastError(reason.length() > 1000 ? reason.substring(0, 1000) : reason);
                // Retry after a backoff that grows with the attempts, bounded at an hour.
                long seconds = Math.min(3600, 30L << Math.min(current.getAttempts(), 7));
                current.setLeaseExpiresAt(now.plus(Duration.ofSeconds(seconds)));
                files.save(current);
            }));
            log.warn("file_delete_deferred file={} attempts={} reason={}", row.getId(), row.getAttempts(), reason);
            return false;
        }
        Integer removed = transactions.execute(status -> {
            int count = files.deleteHeld(row.getId(), replica);
            if (count == 1) {
                Map<String, Object> details = new LinkedHashMap<>(ProcessFileService.details(row, null));
                details.put("reason", row.getDeletingReason());
                history.record("FILE_DELETED", row.getInstanceId(), null, null, details);
            }
            return count;
        });
        return removed != null && removed == 1;
    }

    /** Objects with no row, older than the grace period; at most once per interval across replicas. */
    int orphans(Instant now, String replica) {
        Integer acquired = transactions.execute(status -> leases.acquire(ORPHANS, replica, now,
                now.plus(Duration.ofHours(1)), now.minus(properties.orphanInterval())));
        if (acquired == null || acquired == 0) return 0;
        int deleted = 0;
        try {
            Instant cutoff = now.minus(properties.orphanGrace());
            String continuation = null;
            do {
                ObjectStore.Page page = store.list(continuation, LIST_PAGE);
                List<String> old = new ArrayList<>();
                for (ObjectStore.Listed object : page.objects()) {
                    if (object.key().startsWith("_abada/")) continue;
                    if (object.lastModified() == null || object.lastModified().isBefore(cutoff)) old.add(object.key());
                }
                if (!old.isEmpty()) {
                    Set<String> known = new HashSet<>(files.existingKeys(old));
                    for (String key : old) {
                        if (known.contains(key)) continue;
                        store.delete(key);
                        deleted++;
                        log.info("file_orphan_deleted key_project={}", key.contains("/") ? key.substring(0, key.indexOf('/')) : "?");
                    }
                }
                continuation = page.next();
            } while (continuation != null);
            transactions.executeWithoutResult(status -> leases.complete(ORPHANS, replica, now));
        } catch (RuntimeException exception) {
            transactions.executeWithoutResult(status -> leases.release(ORPHANS, replica));
            log.warn("file_orphan_scan_failed reason={}", exception.getMessage());
        }
        return deleted;
    }

    private static String hostname() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (Exception exception) {
            return "engine";
        }
    }
}
