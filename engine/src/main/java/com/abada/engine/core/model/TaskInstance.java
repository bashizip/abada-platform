package com.abada.engine.core.model;

import com.abada.engine.core.model.assignment.AssignmentStrategy;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import io.micrometer.core.instrument.Timer;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class TaskInstance {

    private String id;
    private String processInstanceId;
    private String taskDefinitionKey;
    private String name;
    private String assignee;
    private TaskStatus status;
    private Instant startDate;
    private Instant endDate;
    private List<String> candidateUsers = new ArrayList<>();
    private List<String> candidateGroups = new ArrayList<>();
    private AssignmentStrategy assignmentStrategy = AssignmentStrategy.CLAIM;
    private String formKey;
    private long entityVersion;
    
    @JsonIgnore
    private Timer.Sample waitingTimeSample;
    
    @JsonIgnore
    private Timer.Sample processingTimeSample;

    public TaskInstance() {
        this.status = TaskStatus.AVAILABLE;
        this.startDate = Instant.now();
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getProcessInstanceId() {
        return processInstanceId;
    }

    public void setProcessInstanceId(String processInstanceId) {
        this.processInstanceId = processInstanceId;
    }

    public String getTaskDefinitionKey() {
        return taskDefinitionKey;
    }

    public void setTaskDefinitionKey(String taskDefinitionKey) {
        this.taskDefinitionKey = taskDefinitionKey;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getAssignee() {
        return assignee;
    }

    public void setAssignee(String assignee) {
        this.assignee = assignee;
    }

    public TaskStatus getStatus() {
        return status;
    }

    public void setStatus(TaskStatus status) {
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

    public List<String> getCandidateUsers() {
        return candidateUsers;
    }

    public void setCandidateUsers(List<String> candidateUsers) {
        this.candidateUsers = candidateUsers;
    }

    public AssignmentStrategy getAssignmentStrategy() { return assignmentStrategy; }
    public void setAssignmentStrategy(AssignmentStrategy assignmentStrategy) {
        this.assignmentStrategy = assignmentStrategy == null ? AssignmentStrategy.CLAIM : assignmentStrategy;
    }

    public String getFormKey() { return formKey; }
    public void setFormKey(String formKey) { this.formKey = formKey; }

    public List<String> getCandidateGroups() {
        return candidateGroups;
    }

    public void setCandidateGroups(List<String> candidateGroups) {
        this.candidateGroups = candidateGroups;
    }

    public long getEntityVersion() { return entityVersion; }
    public void setEntityVersion(long entityVersion) { this.entityVersion = entityVersion; }

    public Timer.Sample getWaitingTimeSample() {
        return waitingTimeSample;
    }

    public void setWaitingTimeSample(Timer.Sample waitingTimeSample) {
        this.waitingTimeSample = waitingTimeSample;
    }

    public Timer.Sample getProcessingTimeSample() {
        return processingTimeSample;
    }

    public void setProcessingTimeSample(Timer.Sample processingTimeSample) {
        this.processingTimeSample = processingTimeSample;
    }

    // Helper methods

    @JsonIgnore
    public boolean isCompleted() {
        return this.status == TaskStatus.COMPLETED;
    }

    @JsonIgnore
    public boolean isClaimed() {
        return this.status == TaskStatus.CLAIMED;
    }

    @Override
    public String toString() {
        return name;
    }
}
