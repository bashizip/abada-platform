package com.abada.engine.files;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.entity.ProcessFileEntity.State;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.ProcessFileRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

/**
 * The file sweep (S9) on H2 with the in-memory store: what it marks, that a
 * deletion is idempotent and survives a failing store, and that the orphan
 * scan removes only old objects without a row. Concurrency on PostgreSQL is
 * covered by {@code PostgresRustfsFileTest}.
 */
@SpringBootTest(classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class FileSweepTest {
    @Autowired private FileSweep sweep;
    @Autowired private ProcessFileRepository files;
    @Autowired private ObjectStore objectStore;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private ActivityHistoryRepository history;

    private InMemoryObjectStore store;
    private final Instant now = Instant.parse("2026-11-02T10:00:00Z");

    @BeforeEach
    void empty() {
        store = (InMemoryObjectStore) objectStore;
        store.setAvailable(true);
        store.clear();
        files.deleteAll();
        jdbc.update("update file_sweep_leases set lease_owner = null, lease_expires_at = null, last_completed_at = null");
    }

    @Test
    void expiredPendingFilesAreDeletedOnceAndRecentOnesStay() {
        ProcessFileEntity old = file(State.PENDING, now.minus(Duration.ofHours(25)));
        ProcessFileEntity recent = file(State.PENDING, now.minus(Duration.ofHours(2)));
        ProcessFileEntity attached = file(State.ATTACHED, now.minus(Duration.ofDays(400)));

        FileSweep.Result first = sweep.sweep(now, "replica-a");
        assertThat(first.marked()).isEqualTo(1);
        assertThat(first.deleted()).isEqualTo(1);
        assertThat(files.findById(old.getId())).isEmpty();
        assertThat(store.contains(old.getObjectKey())).isFalse();
        assertThat(files.findById(recent.getId())).isPresent();
        // No retention configured for the project: attached files stay.
        assertThat(files.findById(attached.getId())).isPresent();

        FileSweep.Result again = sweep.sweep(now, "replica-b");
        assertThat(again.marked()).isZero();
        assertThat(again.deleted()).isZero();
    }

    @Test
    void aFailingStoreDefersTheDeletionAndARetryFinishesIt() {
        ProcessFileEntity doomed = file(State.DELETING, now.minus(Duration.ofHours(1)));
        store.setAvailable(false);
        FileSweep.Result failed = sweep.sweep(now, "replica-a");
        assertThat(failed.failed()).isEqualTo(1);
        ProcessFileEntity kept = files.findById(doomed.getId()).orElseThrow();
        assertThat(kept.getAttempts()).isEqualTo(1);
        assertThat(kept.getLastError()).contains("unreachable");
        assertThat(kept.getLeaseExpiresAt()).isAfter(now);

        store.setAvailable(true);
        // Held by the backoff: another replica does not take it before the lease runs out.
        assertThat(sweep.sweep(now, "replica-b").deleted()).isZero();
        assertThat(sweep.sweep(now.plus(Duration.ofHours(2)), "replica-b").deleted()).isEqualTo(1);
        assertThat(files.findById(doomed.getId())).isEmpty();
    }

    @Test
    void anObjectAlreadyGoneCountsAsDeleted() {
        ProcessFileEntity row = file(State.DELETING, now.minus(Duration.ofHours(1)));
        store.delete(row.getObjectKey());
        assertThat(sweep.sweep(now, "replica-a").deleted()).isEqualTo(1);
        assertThat(files.findById(row.getId())).isEmpty();
    }

    @Test
    void theOrphanScanDeletesOldObjectsWithoutARowOnlyOncePerInterval() {
        ProcessFileEntity known = file(State.ATTACHED, now.minus(Duration.ofDays(3)));
        store.putRaw("p/" + UUID.randomUUID(), new byte[] {1}, now.minus(Duration.ofHours(3)));
        String fresh = "p/" + UUID.randomUUID();
        store.putRaw(fresh, new byte[] {1}, now.minus(Duration.ofMinutes(5)));

        assertThat(sweep.sweep(now, "replica-a").orphansDeleted()).isEqualTo(1);
        assertThat(store.contains(known.getObjectKey())).isTrue();
        assertThat(store.contains(fresh)).as("an upload in flight is not an orphan").isTrue();

        store.putRaw("p/" + UUID.randomUUID(), new byte[] {1}, now.minus(Duration.ofHours(3)));
        assertThat(sweep.sweep(now.plus(Duration.ofHours(1)), "replica-b").orphansDeleted())
                .as("the scan ran less than a day ago").isZero();
        assertThat(sweep.sweep(now.plus(Duration.ofHours(25)), "replica-b").orphansDeleted()).isEqualTo(2);
    }

    private ProcessFileEntity file(State state, Instant createdAt) {
        ProcessFileEntity row = new ProcessFileEntity();
        String id = UUID.randomUUID().toString();
        row.setId(id);
        row.setProjectId("p");
        row.setUploadedBy("alice");
        row.setContentType("application/pdf");
        row.setSizeBytes(1);
        row.setSha256("0".repeat(64));
        row.setName("a.pdf");
        row.setObjectKey("p/" + id);
        row.setState(state);
        row.setInstanceId("instance-" + id);
        row.setTaskId("task");
        row.setFieldId("field");
        row.setCreatedAt(createdAt);
        if (state == State.DELETING) row.setDeletingReason("expired");
        store.putRaw(row.getObjectKey(), new byte[] {1}, createdAt);
        return files.save(row);
    }
}
