package com.abada.engine.persistence.repository;

import com.abada.engine.persistence.entity.AgentStepEntity;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AgentStepRepository extends JpaRepository<AgentStepEntity, String> {
    List<AgentStepEntity> findByExternalTaskIdAndAttemptOrderBySequenceAsc(String externalTaskId, int attempt);

    List<AgentStepEntity> findByExternalTaskIdOrderByAttemptAscSequenceAsc(String externalTaskId);

    Optional<AgentStepEntity> findByExternalTaskIdAndAttemptAndSequence(String externalTaskId, int attempt,
            int sequence);

    Optional<AgentStepEntity> findFirstByExternalTaskIdAndAttemptOrderBySequenceDesc(String externalTaskId,
            int attempt);

    long countByExternalTaskId(String externalTaskId);

    List<AgentStepEntity> findByProcessInstanceIdOrderByStartedAtAscSequenceAsc(String processInstanceId);

    /** Engine-computed cost and tokens of the journaled steps, per instance. */
    @org.springframework.data.jpa.repository.Query("select s.processInstanceId as instanceId, sum(s.costUsd) as usd, "
            + "sum(coalesce(s.promptTokens, 0)) as promptTokens, sum(coalesce(s.completionTokens, 0)) as completionTokens, "
            + "sum(case when s.costUnpriced = true then 1 else 0 end) as unpriced "
            + "from AgentStepEntity s where s.processInstanceId in :ids group by s.processInstanceId")
    List<CostRow> costByInstance(@org.springframework.data.repository.query.Param("ids") java.util.Collection<String> ids);

    interface CostRow {
        String getInstanceId();
        java.math.BigDecimal getUsd();
        Long getPromptTokens();
        Long getCompletionTokens();
        Long getUnpriced();
    }

    /** Steps whose payloads passed their retention, locked for this sweep only (other replicas skip them). */
    @org.springframework.data.jpa.repository.Query(value = "select * from agent_steps where purge_after <= :now "
            + "and purged_at is null order by purge_after limit :batch for update skip locked", nativeQuery = true)
    List<AgentStepEntity> findPurgeableForUpdate(@org.springframework.data.repository.query.Param("now") java.time.Instant now,
            @org.springframework.data.repository.query.Param("batch") int batch);

    /** Ids of steps still holding a worker working copy although their task can no longer run. */
    @org.springframework.data.jpa.repository.Query("select s.id from AgentStepEntity s, ExternalTaskEntity t "
            + "where t.id = s.externalTaskId and (s.requestEnc is not null or s.resultEnc is not null) "
            + "and t.status in :finished")
    List<String> findWorkingCopiesOfFinishedTasks(
            @org.springframework.data.repository.query.Param("finished") java.util.Collection<com.abada.engine.persistence.entity.ExternalTaskEntity.Status> finished,
            org.springframework.data.domain.Pageable page);

    @org.springframework.data.jpa.repository.Query(value = "select * from agent_steps where id in (:ids) "
            + "for update skip locked", nativeQuery = true)
    List<AgentStepEntity> lockByIds(@org.springframework.data.repository.query.Param("ids") java.util.Collection<String> ids);

    /**
     * Whether an attempt left a write STARTED (its outcome not journaled): a new
     * attempt must not begin over it, or the write could be sent again. An
     * approved call not yet run counts too: the same attempt runs it, so a
     * person's approval is never lost to a retry.
     */
    @org.springframework.data.jpa.repository.Query("select count(s) > 0 from AgentStepEntity s "
            + "where s.externalTaskId = :taskId and s.attempt = :attempt and s.kind = 'TOOL_CALL' "
            + "and s.state in ('STARTED', 'APPROVED') and s.policy <> 'read'")
    boolean hasOpenWrite(@org.springframework.data.repository.query.Param("taskId") String taskId,
            @org.springframework.data.repository.query.Param("attempt") int attempt);
}
