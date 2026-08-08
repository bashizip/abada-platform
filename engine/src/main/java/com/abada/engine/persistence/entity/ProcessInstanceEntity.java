package com.abada.engine.persistence.entity;

import com.abada.engine.core.model.ProcessStatus;
import jakarta.persistence.*;

import java.time.Instant;

@Entity
@Table(name = "process_instances")
public class ProcessInstanceEntity {

    @Id
    private String id;

    private String processDefinitionId;

    @Column(name = "project_id", nullable = false)
    private String projectId = com.abada.engine.project.ProjectConstants.DEFAULT_PROJECT_ID;

    @Column(name = "process_definition_deployment_id", nullable = false)
    private String processDefinitionDeploymentId;

    private String currentActivityId;

    @Enumerated(EnumType.STRING)
    private ProcessStatus status;

    @Column(name = "start_date", nullable = false)
    private Instant startDate;

    @Column(name = "end_date")
    private Instant endDate;

    @Column(name = "started_by", nullable = false)
    private String startedBy = "system";

    @Column(name = "variables_json", nullable = false, columnDefinition = "TEXT")
    private String variablesJson; // Jackson-serialized Map

    @Column(name = "suspended", nullable = false)
    private boolean suspended = false;

    @Column(name = "active_tokens_json", nullable = false, columnDefinition = "TEXT")
    private String activeTokensJson = "[]";

    @Column(name = "join_expected_tokens_json", nullable = false, columnDefinition = "TEXT")
    private String joinExpectedTokensJson = "{}";

    @Column(name = "join_arrived_tokens_json", nullable = false, columnDefinition = "TEXT")
    private String joinArrivedTokensJson = "{}";

    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    // Constructors
    public ProcessInstanceEntity() {
    }

    public ProcessInstanceEntity(String id, String processDefinitionId, String currentActivityId,
            ProcessStatus status) {
        this.id = id;
        this.processDefinitionId = processDefinitionId;
        this.currentActivityId = currentActivityId;
        this.status = status;
    }

    public String getVariablesJson() {
        return variablesJson;
    }

    public void setVariablesJson(String variablesJson) {
        this.variablesJson = variablesJson;
    }

    // Getters and Setters
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getProcessDefinitionId() {
        return processDefinitionId;
    }

    public String getProjectId() { return projectId; }
    public void setProjectId(String value) { projectId = value; }

    public void setProcessDefinitionId(String processDefinitionId) {
        this.processDefinitionId = processDefinitionId;
    }

    public String getProcessDefinitionDeploymentId() {
        return processDefinitionDeploymentId;
    }

    public void setProcessDefinitionDeploymentId(String processDefinitionDeploymentId) {
        this.processDefinitionDeploymentId = processDefinitionDeploymentId;
    }

    public String getCurrentActivityId() {
        return currentActivityId;
    }

    public void setCurrentActivityId(String currentActivityId) {
        this.currentActivityId = currentActivityId;
    }

    public ProcessStatus getStatus() {
        return status;
    }

    public void setStatus(ProcessStatus status) {
        this.status = status;
    }

    public Instant getStartDate() {
        return startDate;
    }

    public void setStartDate(Instant startDate) {
        this.startDate = startDate;
    }

    public Instant getEndDate() {
        return endDate;
    }

    public void setEndDate(Instant endDate) {
        this.endDate = endDate;
    }

    public String getStartedBy() {
        return startedBy;
    }

    public void setStartedBy(String startedBy) {
        this.startedBy = startedBy;
    }

    public boolean isSuspended() {
        return suspended;
    }

    public void setSuspended(boolean suspended) {
        this.suspended = suspended;
    }

    public String getActiveTokensJson() { return activeTokensJson; }
    public void setActiveTokensJson(String activeTokensJson) { this.activeTokensJson = activeTokensJson; }
    public String getJoinExpectedTokensJson() { return joinExpectedTokensJson; }
    public void setJoinExpectedTokensJson(String value) { this.joinExpectedTokensJson = value; }
    public String getJoinArrivedTokensJson() { return joinArrivedTokensJson; }
    public void setJoinArrivedTokensJson(String value) { this.joinArrivedTokensJson = value; }
    public long getEntityVersion() { return entityVersion; }
    public void setEntityVersion(long entityVersion) { this.entityVersion = entityVersion; }
}
