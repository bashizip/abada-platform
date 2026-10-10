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
    private final com.abada.engine.core.agent.DelegationResultService delegations;

    public TimerJobCommandService(JobRepository repository, @Lazy AbadaEngine engine, ActivityHistoryService history,
            @Lazy com.abada.engine.core.agent.DelegationResultService delegations) {
        this.repository = repository;
        this.engine = engine;
        this.history = history;
        this.delegations = delegations;
    }

    /** How long a due job of a suspended instance waits before it is checked again. */
    private static final java.time.Duration SUSPENDED_RECHECK = java.time.Duration.ofMinutes(1);

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

    /**
     * Leases one job by id if it is still available, e.g. a CHILD_DONE job run
     * right after the child's command committed. False when another runner
     * (a replica's poller) already took it.
     */
    @AtomicRuntimeCommand
    public boolean claim(String jobId, String leaseOwner, Instant now) {
        JobEntity job = repository.findByIdForUpdate(jobId).orElse(null);
        if (job == null || job.getStatus() != JobEntity.Status.AVAILABLE
                || job.getExecutionTimestamp().isAfter(now)) return false;
        job.setStatus(JobEntity.Status.LEASED);
        job.setLeaseOwner(leaseOwner);
        job.setLeaseExpiresAt(now.plusSeconds(120));
        job.setAttempts(job.getAttempts() + 1);
        repository.save(job);
        return true;
    }

    /** Executes one already-leased timer and its workflow advancement atomically. */
    @AtomicRuntimeCommand
    public boolean execute(String jobId, String leaseOwner, Instant now) {
        JobEntity job = repository.findByIdForUpdate(jobId).orElse(null);
        if (job == null || job.getStatus() != JobEntity.Status.LEASED
                || !leaseOwner.equals(job.getLeaseOwner()) || job.getLeaseExpiresAt() == null
                || !job.getLeaseExpiresAt().isAfter(now)) return false;

        ProcessInstance owner = engine.getProcessInstanceById(job.getProcessInstanceId());
        if (owner != null && owner.isSuspended()) {
            // A suspended instance must not move: the timer fires after it is resumed.
            job.setStatus(JobEntity.Status.AVAILABLE);
            job.setLeaseOwner(null);
            job.setLeaseExpiresAt(null);
            job.setAttempts(Math.max(0, job.getAttempts() - 1));
            job.setExecutionTimestamp(now.plus(SUSPENDED_RECHECK));
            repository.save(job);
            return false;
        }

        // Completed before the instance advances: a loop that returns to this
        // timer must be able to schedule the next one for the same token.
        job.setStatus(JobEntity.Status.COMPLETED);
        job.setLeaseOwner(null);
        job.setLeaseExpiresAt(null);
        repository.saveAndFlush(job);
        boolean fired = switch (job.getKind()) {
            case EVENT -> {
                engine.resumeFromEvent(job.getProcessInstanceId(), job.getEventId(), job.getTokenId(), Map.of());
                yield true;
            }
            case BOUNDARY_TIMEOUT -> engine.fireTimeout(job.getProcessInstanceId(), job.getEventId(),
                    job.getTokenId(), job.getBoundaryId());
            case SLA -> engine.escalateTask(job.getProcessInstanceId(), job.getEventId(), job.getTokenId());
            // A child an agent delegated to resumes the agent's work; a call-process child moves the token.
            case CHILD_DONE -> delegations.childEnded(job.getRelatedInstanceId())
                    || engine.childEnded(job.getProcessInstanceId(), job.getEventId(), job.getTokenId(),
                            job.getRelatedInstanceId());
        };

        ProcessInstance instance = engine.getProcessInstanceById(job.getProcessInstanceId());
        history.record("TIMER_JOB_COMPLETED", instance, job.getEventId(),
                Map.of("jobId", jobId, "kind", job.getKind().name(), "fired", fired));
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
