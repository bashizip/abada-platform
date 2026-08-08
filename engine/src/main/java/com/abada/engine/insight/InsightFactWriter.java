package com.abada.engine.insight;

import com.abada.engine.persistence.entity.InsightExecutionFactEntity;
import com.abada.engine.persistence.entity.InsightExecutionFactEntity.NodeType;
import com.abada.engine.persistence.entity.InsightExecutionFactEntity.Status;
import com.abada.engine.persistence.repository.InsightExecutionFactRepository;
import java.time.Instant;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Records terminal execution facts inside the same workflow transaction that
 * produced them. A fact is written exactly once per durable visit identifier,
 * so loops retain every visit while a replayed terminal command cannot create
 * a duplicate. No business values
 * are stored — identifiers only.
 */
@Component
public class InsightFactWriter {

    private final InsightExecutionFactRepository repository;

    public InsightFactWriter(InsightExecutionFactRepository repository) {
        this.repository = repository;
    }

    /**
     * Decision-table application inside the workflow transaction. The
     * otherwise flag is computed by the caller from the definition's rule
     * table (this writer never re-reads the definition).
     */
    public void recordDecisionApplied(String projectId, String visitId, String definitionKey,
            String definitionDeploymentId,
            String processInstanceId, String activityId, String decisionKey,
            List<Integer> matchedRuleIndexes, boolean fallbackUsed, Instant appliedAt) {
        if (repository.existsByVisitId(visitId)) {
            return;
        }
        InsightExecutionFactEntity fact = new InsightExecutionFactEntity();
        fact.setProjectId(projectId);
        fact.setVisitId(visitId);
        fact.setDefinitionKey(definitionKey);
        fact.setDefinitionDeploymentId(definitionDeploymentId);
        fact.setProcessInstanceId(processInstanceId);
        fact.setActivityId(activityId);
        fact.setNodeType(NodeType.DECISION);
        fact.setStatus(Status.SUCCESS);
        fact.setStartedAt(appliedAt);
        fact.setEndedAt(appliedAt);
        fact.setDurationMs(0);
        fact.setDecisionKey(decisionKey);
        fact.setMatchedRuleIndexes(matchedRuleIndexes.stream().map(String::valueOf)
                .collect(Collectors.joining(",")));
        fact.setFallbackUsed(fallbackUsed);
        repository.save(fact);
    }

    /** External-task terminal success (worker completion). */
    public void recordExternalTaskSuccess(String projectId, String visitId, String definitionKey,
            String definitionDeploymentId,
            String processInstanceId, String activityId, String topic, Instant startedAt, Instant endedAt) {
        recordExternalTaskTerminal(projectId, visitId, definitionKey, definitionDeploymentId,
                processInstanceId, activityId, topic, Status.SUCCESS, startedAt, endedAt);
    }

    /** External-task terminal failure (retries exhausted or BPMN error). */
    public void recordExternalTaskFailure(String projectId, String visitId, String definitionKey,
            String definitionDeploymentId,
            String processInstanceId, String activityId, String topic, Instant startedAt, Instant endedAt) {
        recordExternalTaskTerminal(projectId, visitId, definitionKey, definitionDeploymentId,
                processInstanceId, activityId, topic, Status.FAILED, startedAt, endedAt);
    }

    private void recordExternalTaskTerminal(String projectId, String visitId, String definitionKey,
            String definitionDeploymentId,
            String processInstanceId, String activityId, String topic, Status status,
            Instant startedAt, Instant endedAt) {
        if (repository.existsByVisitId(visitId)) {
            return;
        }
        InsightExecutionFactEntity fact = new InsightExecutionFactEntity();
        fact.setProjectId(projectId);
        fact.setVisitId(visitId);
        fact.setDefinitionKey(definitionKey);
        fact.setDefinitionDeploymentId(definitionDeploymentId);
        fact.setProcessInstanceId(processInstanceId);
        fact.setActivityId(activityId);
        fact.setNodeType(NodeType.EXTERNAL_TASK);
        fact.setStatus(status);
        fact.setStartedAt(startedAt);
        fact.setEndedAt(endedAt);
        fact.setDurationMs(Math.max(0, endedAt.toEpochMilli() - startedAt.toEpochMilli()));
        fact.setTopic(topic);
        repository.save(fact);
    }

    /** User-task completion. */
    public void recordUserTaskCompleted(String projectId, String visitId, String definitionKey,
            String definitionDeploymentId,
            String processInstanceId, String activityId, Instant startedAt, Instant endedAt) {
        if (repository.existsByVisitId(visitId)) {
            return;
        }
        InsightExecutionFactEntity fact = new InsightExecutionFactEntity();
        fact.setProjectId(projectId);
        fact.setVisitId(visitId);
        fact.setDefinitionKey(definitionKey);
        fact.setDefinitionDeploymentId(definitionDeploymentId);
        fact.setProcessInstanceId(processInstanceId);
        fact.setActivityId(activityId);
        fact.setNodeType(NodeType.USER_TASK);
        fact.setStatus(Status.SUCCESS);
        fact.setStartedAt(startedAt);
        fact.setEndedAt(endedAt);
        fact.setDurationMs(Math.max(0, endedAt.toEpochMilli() - startedAt.toEpochMilli()));
        repository.save(fact);
    }
}
