package com.abada.engine.core;

import com.abada.engine.persistence.entity.JobEntity;
import com.abada.engine.persistence.repository.JobRepository;
import org.springframework.stereotype.Service;
import org.springframework.context.annotation.Lazy;

import java.time.Instant;
import java.util.Map;
import java.util.List;

@Service
public class TimerJobCommandService {
    private final JobRepository repository;
    private final AbadaEngine engine;
    private final ActivityHistoryService history;

    public TimerJobCommandService(JobRepository repository, @Lazy AbadaEngine engine, ActivityHistoryService history) {
        this.repository = repository;
        this.engine = engine;
        this.history = history;
    }

    /** Executes one timer and its workflow advancement in a single transaction. */
    @AtomicRuntimeCommand
    public List<JobEntity> claimDue(String leaseOwner, Instant now, int batchSize) {
        List<JobEntity> jobs = repository.findClaimableForUpdate(now, batchSize);
        for (JobEntity job : jobs) {
            job.setStatus(JobEntity.Status.LEASED);
            job.setLeaseOwner(leaseOwner);
            job.setLeaseExpiresAt(now.plusSeconds(120));
            job.setAttempts(job.getAttempts() + 1);
        }
        return repository.saveAll(jobs);
    }

    /** Executes one already-leased timer and its workflow advancement atomically. */
    @AtomicRuntimeCommand
    public boolean execute(String jobId, String leaseOwner, Instant now) {
        JobEntity job = repository.findByIdForUpdate(jobId).orElse(null);
        if (job == null || job.getStatus() != JobEntity.Status.LEASED
                || !leaseOwner.equals(job.getLeaseOwner()) || job.getLeaseExpiresAt() == null
                || !job.getLeaseExpiresAt().isAfter(now)) return false;

        engine.resumeFromEvent(job.getProcessInstanceId(), job.getEventId(), job.getTokenId(), Map.of());
        job.setStatus(JobEntity.Status.COMPLETED);
        job.setLeaseOwner(null);
        job.setLeaseExpiresAt(null);
        repository.save(job);

        ProcessInstance instance = engine.getProcessInstanceById(job.getProcessInstanceId());
        history.record("TIMER_JOB_COMPLETED", instance, job.getEventId(), Map.of("jobId", jobId));
        return true;
    }

    /** Records retry state only after execute() has rolled its transaction back. */
    @AtomicRuntimeCommand
    public void recordFailure(String jobId, String error) {
        JobEntity job = repository.findByIdForUpdate(jobId).orElse(null);
        if (job == null || job.getStatus() == JobEntity.Status.COMPLETED) return;

        job.setLastError(error);
        job.setLeaseOwner(null);
        job.setLeaseExpiresAt(null);
        job.setStatus(job.getAttempts() >= job.getMaxAttempts()
                ? JobEntity.Status.FAILED : JobEntity.Status.AVAILABLE);
        repository.save(job);
        ProcessInstance instance = engine.getProcessInstanceById(job.getProcessInstanceId());
        history.record("TIMER_JOB_FAILED", instance, job.getEventId(),
                Map.of("jobId", jobId, "attempts", job.getAttempts(), "error", error == null ? "" : error));
    }

}
