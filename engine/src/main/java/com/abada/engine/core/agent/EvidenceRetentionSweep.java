package com.abada.engine.core.agent;

import com.abada.engine.core.ActivityHistoryService;
import com.abada.engine.persistence.entity.AgentStepEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.repository.AgentStepRepository;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Keeps the step journal from leaking or growing forever, in short batches:
 * <ul>
 *   <li>payloads past their retention ({@code purge_after}) are cleared, the
 *       working copy and the evidence copy alike; digests, tokens and cost stay.
 *       One {@code EVIDENCE_PURGED} history entry per instance and batch;</li>
 *   <li>the worker's working copy is cleared once its task can no longer run
 *       (completed, cancelled or ended by a BPMN error).</li>
 * </ul>
 * Rows are locked with {@code SKIP LOCKED}, so replicas sweep disjoint rows
 * and a step is purged once. State lives in the rows, so a restart resumes.
 */
@Component
public class EvidenceRetentionSweep {
    private static final Logger log = LoggerFactory.getLogger(EvidenceRetentionSweep.class);
    static final int BATCH = 500;
    private static final List<ExternalTaskEntity.Status> FINISHED = List.of(ExternalTaskEntity.Status.COMPLETED,
            ExternalTaskEntity.Status.CANCELLED, ExternalTaskEntity.Status.BPMN_ERROR);

    public record Result(int purged, int workingCopiesCleared) {}

    private final AgentStepRepository steps;
    private final ActivityHistoryService history;
    private final TransactionTemplate transactions;

    public EvidenceRetentionSweep(AgentStepRepository steps, ActivityHistoryService history,
            TransactionTemplate transactions) {
        this.steps = steps;
        this.history = history;
        this.transactions = transactions;
    }

    @Scheduled(fixedDelayString = "${abada.evidence.purge-interval-ms:900000}",
            initialDelayString = "${abada.evidence.purge-initial-delay-ms:120000}")
    public void scheduledSweep() {
        Result result = sweep(Instant.now());
        if (result.purged() > 0 || result.workingCopiesCleared() > 0) {
            log.info("evidence_sweep purged={} working_copies_cleared={}", result.purged(),
                    result.workingCopiesCleared());
        }
    }

    /** One full sweep at {@code now}; returns how many steps it changed. */
    public Result sweep(Instant now) {
        int purged = 0;
        int batch;
        do {
            batch = transactions.execute(status -> purgeBatch(now));
            purged += batch;
        } while (batch == BATCH);
        int cleared = 0;
        do {
            batch = transactions.execute(status -> clearWorkingCopies());
            cleared += batch;
        } while (batch == BATCH);
        return new Result(purged, cleared);
    }

    private int purgeBatch(Instant now) {
        List<AgentStepEntity> due = steps.findPurgeableForUpdate(now, BATCH);
        Map<String, Integer> byInstance = new LinkedHashMap<>();
        for (AgentStepEntity step : due) {
            step.setRequestEnc(null);
            step.setResultEnc(null);
            step.setEvidenceRequestEnc(null);
            step.setEvidenceResultEnc(null);
            step.setPurgedAt(now);
            byInstance.merge(step.getProcessInstanceId(), 1, Integer::sum);
        }
        steps.saveAll(due);
        byInstance.forEach((instanceId, count) -> history.record("EVIDENCE_PURGED", instanceId, null, null,
                Map.of("steps", count, "reason", "retention")));
        return due.size();
    }

    private int clearWorkingCopies() {
        List<String> ids = steps.findWorkingCopiesOfFinishedTasks(FINISHED, PageRequest.of(0, BATCH));
        if (ids.isEmpty()) return 0;
        List<AgentStepEntity> locked = steps.lockByIds(ids);
        for (AgentStepEntity step : locked) {
            step.setRequestEnc(null);
            step.setResultEnc(null);
        }
        steps.saveAll(locked);
        return locked.size();
    }
}
