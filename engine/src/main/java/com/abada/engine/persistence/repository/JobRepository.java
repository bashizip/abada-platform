package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.JobEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.stereotype.Repository;
import jakarta.persistence.LockModeType;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

@Repository
public interface JobRepository extends JpaRepository<JobEntity, String> {

    /**
     * Finds all jobs that are due to be executed at or before the given timestamp.
     * @param timestamp The current time.
     * @return A list of due jobs.
     */
    List<JobEntity> findByStatusAndExecutionTimestampLessThanEqualOrderByExecutionTimestampAsc(
            JobEntity.Status status, Instant timestamp);

    List<JobEntity> findByStatusAndLeaseExpiresAtLessThanEqualOrderByExecutionTimestampAsc(
            JobEntity.Status status, Instant timestamp);

    boolean existsByProcessInstanceIdAndEventIdAndStatusIn(
            String processInstanceId, String eventId, List<JobEntity.Status> statuses);

    boolean existsByProcessInstanceIdAndTokenIdAndStatusIn(
            String processInstanceId, String tokenId, List<JobEntity.Status> statuses);

    boolean existsByProcessInstanceIdAndTokenIdAndKindAndStatusIn(
            String processInstanceId, String tokenId, JobEntity.Kind kind, List<JobEntity.Status> statuses);

    /**
     * Pending jobs of the given tokens, locked to retire them with the command.
     * A job another transaction holds (its timer is firing right now) is
     * skipped: that timer finds the token gone and does nothing, so skipping
     * never loses a cancellation and never waits in the reverse lock order.
     */
    @Query(value = "select * from jobs where process_instance_id = :processInstanceId "
            + "and token_id in (:tokenIds) and status in ('AVAILABLE', 'LEASED') for update skip locked",
            nativeQuery = true)
    List<JobEntity> findPendingForTokensSkipLocked(@Param("processInstanceId") String processInstanceId,
            @Param("tokenIds") java.util.Collection<String> tokenIds);

    /** Every pending job of an instance, locked, for cancellation or failure of the instance. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select job from JobEntity job where job.processInstanceId = :processInstanceId "
            + "and job.status in :statuses")
    List<JobEntity> findByProcessInstanceIdAndStatusIn(@Param("processInstanceId") String processInstanceId,
            @Param("statuses") List<JobEntity.Status> statuses);

    /** Pending timers created before V23 (no token) for this event. */
    boolean existsByProcessInstanceIdAndEventIdAndTokenIdIsNullAndStatusIn(
            String processInstanceId, String eventId, List<JobEntity.Status> statuses);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select job from JobEntity job where job.id = :id")
    Optional<JobEntity> findByIdForUpdate(@Param("id") String id);

    /** Timer jobs still waiting (available or leased) for the given events of
     *  one instance — the losers of an event-gateway race. Locked so the
     *  cancellation is atomic with the winning event's advancement. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select job from JobEntity job where job.processInstanceId = :processInstanceId "
            + "and job.eventId in :eventIds and job.status in :statuses")
    List<JobEntity> findByProcessInstanceIdAndEventIdInAndStatusIn(
            @Param("processInstanceId") String processInstanceId,
            @Param("eventIds") java.util.Collection<String> eventIds,
            @Param("statuses") List<JobEntity.Status> statuses);

    @Query(value = "select * from jobs where ((status = 'AVAILABLE' and execution_timestamp <= :now) "
            + "or (status = 'LEASED' and lease_expires_at <= :now)) "
            + "order by execution_timestamp, id limit :batchSize for update skip locked", nativeQuery = true)
    List<JobEntity> findClaimableForUpdate(@Param("now") Instant now, @Param("batchSize") int batchSize);

    /** Whether a CHILD_DONE job already exists for this child (one per child, whatever its status). */
    boolean existsByKindAndRelatedInstanceId(JobEntity.Kind kind, String relatedInstanceId);
}
