package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import com.abada.engine.project.ProjectConstants;

/**
 * Durable terminal-execution snapshot written inside the workflow
 * transaction (external-task completion/failure, user-task completion,
 * decision-table application). Consumed only by the Insight analyzer; the
 * exact same row is replayed across restarts. Values are never stored — node
 * and decision identifiers only (AGENTS.md audit-boundary rule).
 */
@Entity
@Table(name = "insight_execution_facts")
public class InsightExecutionFactEntity {

    public enum NodeType {
        EXTERNAL_TASK,
        USER_TASK,
        DECISION
    }

    public enum Status {
        SUCCESS,
        FAILED
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private long id;

    @Column(name = "project_id")
    private String projectId = ProjectConstants.DEFAULT_PROJECT_ID;

    @Column(name = "visit_id")
    private String visitId;

    @Column(name = "definition_key")
    private String definitionKey;

    @Column(name = "definition_deployment_id")
    private String definitionDeploymentId;

    @Column(name = "process_instance_id")
    private String processInstanceId;

    @Column(name = "activity_id")
    private String activityId;

    @Enumerated(EnumType.STRING)
    @Column(name = "node_type")
    private NodeType nodeType;

    @Enumerated(EnumType.STRING)
    @Column(name = "status")
    private Status status;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "duration_ms")
    private long durationMs;

    @Column(name = "topic")
    private String topic;

    @Column(name = "decision_key")
    private String decisionKey;

    @Column(name = "matched_rule_indexes")
    private String matchedRuleIndexes;

    @Column(name = "fallback_used")
    private Boolean fallbackUsed;

    public long getId() {
        return id;
    }

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public String getVisitId() {
        return visitId;
    }

    public void setVisitId(String visitId) {
        this.visitId = visitId;
    }

    public String getDefinitionKey() {
        return definitionKey;
    }

    public void setDefinitionKey(String definitionKey) {
        this.definitionKey = definitionKey;
    }

    public String getDefinitionDeploymentId() {
        return definitionDeploymentId;
    }

    public void setDefinitionDeploymentId(String definitionDeploymentId) {
        this.definitionDeploymentId = definitionDeploymentId;
    }

    public String getProcessInstanceId() {
        return processInstanceId;
    }

    public void setProcessInstanceId(String processInstanceId) {
        this.processInstanceId = processInstanceId;
    }

    public String getActivityId() {
        return activityId;
    }

    public void setActivityId(String activityId) {
        this.activityId = activityId;
    }

    public NodeType getNodeType() {
        return nodeType;
    }

    public void setNodeType(NodeType nodeType) {
        this.nodeType = nodeType;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getEndedAt() {
        return endedAt;
    }

    public void setEndedAt(Instant endedAt) {
        this.endedAt = endedAt;
    }

    public long getDurationMs() {
        return durationMs;
    }

    public void setDurationMs(long durationMs) {
        this.durationMs = durationMs;
    }

    public String getTopic() {
        return topic;
    }

    public void setTopic(String topic) {
        this.topic = topic;
    }

    public String getDecisionKey() {
        return decisionKey;
    }

    public void setDecisionKey(String decisionKey) {
        this.decisionKey = decisionKey;
    }

    public String getMatchedRuleIndexes() {
        return matchedRuleIndexes;
    }

    public void setMatchedRuleIndexes(String matchedRuleIndexes) {
        this.matchedRuleIndexes = matchedRuleIndexes;
    }

    public Boolean getFallbackUsed() {
        return fallbackUsed;
    }

    public void setFallbackUsed(Boolean fallbackUsed) {
        this.fallbackUsed = fallbackUsed;
    }
}
