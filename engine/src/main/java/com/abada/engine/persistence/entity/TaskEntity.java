package com.abada.engine.persistence.entity;

import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.core.model.assignment.AssignmentStrategy;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "tasks")
public class TaskEntity {

    @Id
    private String id;

    @Column(nullable = false)
    private String processInstanceId;

    @Column
    private String assignee;

    @Column
    private String taskDefinitionKey;

    @Column
    private String name;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "task_candidate_users", joinColumns = @JoinColumn(name = "task_id"))
    @Column(name = "user_id")
    private List<String> candidateUsers = new ArrayList<>();


    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "task_candidate_groups", joinColumns = @JoinColumn(name = "task_id"))
    @Column(name = "group_id")
    private List<String> candidateGroups = new ArrayList<>();


    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    private TaskStatus status;

    @Column(name = "start_date", nullable = false)
    private Instant startDate;

    @Column(name = "end_date")
    private Instant endDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "assignment_strategy", nullable = false)
    private AssignmentStrategy assignmentStrategy = AssignmentStrategy.CLAIM;

    @Column(name = "form_key")
    private String formKey;

    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    public TaskStatus getStatus() {
        return status;
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

    public void setStatus(TaskStatus status) {
        this.status = status;
    }

    public String getAssignee() {
        return assignee;
    }

    public void setAssignee(String assignee) {
        this.assignee = assignee;
    }

    public String getProcessInstanceId() {
        return processInstanceId;
    }

    public void setProcessInstanceId(String processInstanceId) {
        this.processInstanceId = processInstanceId;
    }

    public String getId() {
        return id;
    }


    public void setId(String id) {
        this.id = id;
    }

    public List<String> getCandidateUsers() {
        return candidateUsers;
    }

    public void setCandidateUsers(List<String> candidateUsers) {
        this.candidateUsers = candidateUsers;
    }

    public List<String> getCandidateGroups() {
        return candidateGroups;
    }

    public void setCandidateGroups(List<String> candidateGroups) {
        this.candidateGroups = candidateGroups;
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

    public long getEntityVersion() { return entityVersion; }
    public void setEntityVersion(long entityVersion) { this.entityVersion = entityVersion; }
    public AssignmentStrategy getAssignmentStrategy() { return assignmentStrategy; }
    public void setAssignmentStrategy(AssignmentStrategy value) { this.assignmentStrategy = value; }

    public String getFormKey() { return formKey; }
    public void setFormKey(String formKey) { this.formKey = formKey; }
}
