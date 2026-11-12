package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.entity.ProcessFileEntity.State;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProcessFileRepository extends JpaRepository<ProcessFileEntity, String> {

    /** The files a completion attaches, locked for the completion transaction. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select f from ProcessFileEntity f where f.id in :ids")
    List<ProcessFileEntity> lockByIds(@Param("ids") Collection<String> ids);

    @Query("select coalesce(sum(f.sizeBytes), 0) from ProcessFileEntity f where f.taskId = :taskId "
            + "and f.uploadedBy = :user and f.state = :state")
    long sumSize(@Param("taskId") String taskId, @Param("user") String user, @Param("state") State state);

    @Query("select count(f) from ProcessFileEntity f where f.taskId = :taskId and f.uploadedBy = :user "
            + "and f.state = :state")
    long countFor(@Param("taskId") String taskId, @Param("user") String user, @Param("state") State state);

    /** PENDING files older than the cutoff become DELETING; idempotent across replicas. */
    @Modifying
    @Query("update ProcessFileEntity f set f.state = 'DELETING', f.deletingReason = 'expired', "
            + "f.entityVersion = f.entityVersion + 1 where f.state = 'PENDING' and f.createdAt < :cutoff")
    int expirePending(@Param("cutoff") Instant cutoff);

    /**
     * ATTACHED files of instances that ended before their project's retention
     * ran out; projects without a retention keep their files.
     */
    @Modifying
    @Query(value = "update process_files set state = 'DELETING', deleting_reason = 'retention', "
            + "entity_version = entity_version + 1 where state = 'ATTACHED' and instance_id in ("
            + "select i.id from process_instances i join projects p on p.id = i.project_id "
            + "where p.file_retention_days is not null and i.end_date is not null "
            + "and i.end_date + (p.file_retention_days * interval '1' day) < :now)", nativeQuery = true)
    int expireRetained(@Param("now") Instant now);

    /** DELETING rows nobody holds, locked so replicas claim disjoint rows. */
    @Query(value = "select * from process_files where state = 'DELETING' "
            + "and (lease_expires_at is null or lease_expires_at < :now) "
            + "order by created_at, id limit :batch for update skip locked", nativeQuery = true)
    List<ProcessFileEntity> claimDeletable(@Param("now") Instant now, @Param("batch") int batch);

    /** Removes a row once its object is gone, only while this replica still holds it. */
    @Modifying
    @Query("delete from ProcessFileEntity f where f.id = :id and f.state = 'DELETING' and f.leaseOwner = :owner")
    int deleteHeld(@Param("id") String id, @Param("owner") String owner);

    @Query("select f.objectKey from ProcessFileEntity f where f.objectKey in :keys")
    List<String> existingKeys(@Param("keys") Collection<String> keys);

    List<ProcessFileEntity> findByInstanceIdAndStateOrderByCreatedAt(String instanceId, State state);
}
