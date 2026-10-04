package com.abada.engine.core.model;

import java.io.Serializable;
import java.util.List;
import com.abada.engine.core.model.assignment.ProcessExpression;
import com.abada.engine.core.model.assignment.UserTaskAssignment;

public class TaskMeta implements Serializable {
    private String id;
    private String name;
    private UserTaskAssignment assignment = UserTaskAssignment.EMPTY;
    private String formKey;
    private String dueDate;
    private String followUpDate;
    private String priority;
    private String documentation;
    /** Service level: after this many hours the open task is escalated (null = none). */
    private Double slaHours;
    /** Groups added as candidates when the task is escalated. */
    private List<String> escalateTo = List.of();
    /** Decisions a reviewer chooses from; empty for an ordinary task. */
    private List<OutcomeMeta> outcomes = List.of();

    // Future fields (e.g., listeners, multi-instance, conditions) can be added here.


    public TaskMeta() {

    }

    public TaskMeta(String id, String name, String assignee, List<String> candidateUsers, List<String> candidateGroups, String formKey, String dueDate, String followUpDate, String priority, String documentation) {
        this.id = id;
        this.name = name;
        setAssignee(assignee);
        setCandidateUsers(candidateUsers);
        setCandidateGroups(candidateGroups);
        this.formKey = formKey;
        this.dueDate = dueDate;
        this.followUpDate = followUpDate;
        this.priority = priority;
        this.documentation = documentation;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getAssignee() {
        return assignment.assignee().map(ProcessExpression::source).orElse(null);
    }

    public void setAssignee(String assignee) {
        this.assignment = new UserTaskAssignment(
                assignee == null || assignee.isBlank() ? java.util.Optional.empty()
                        : java.util.Optional.of(com.abada.engine.core.model.assignment.ProcessExpressions.parse(assignee)),
                assignment.candidateUsers(), assignment.candidateGroups(), assignment.strategy());
    }

    public List<String> getCandidateUsers() {
        return assignment.candidateUsers().stream().map(ProcessExpression::source).toList();
    }

    public void setCandidateUsers(List<String> candidateUsers) {
        this.assignment = new UserTaskAssignment(assignment.assignee(),
                candidateUsers == null ? List.of() : candidateUsers.stream()
                        .map(com.abada.engine.core.model.assignment.ProcessExpressions::parse).toList(),
                assignment.candidateGroups(), assignment.strategy());
    }

    public List<String> getCandidateGroups() {
        return assignment.candidateGroups().stream().map(ProcessExpression::source).toList();
    }

    public void setCandidateGroups(List<String> candidateGroups) {
        this.assignment = new UserTaskAssignment(assignment.assignee(), assignment.candidateUsers(),
                candidateGroups == null ? List.of() : candidateGroups.stream()
                        .map(com.abada.engine.core.model.assignment.ProcessExpressions::parse).toList(),
                assignment.strategy());
    }

    public UserTaskAssignment getAssignment() { return assignment; }

    public void setAssignment(UserTaskAssignment assignment) {
        this.assignment = assignment == null ? UserTaskAssignment.EMPTY : assignment;
    }

    public String getFormKey() {
        return formKey;
    }

    public void setFormKey(String formKey) {
        this.formKey = formKey;
    }

    public Double getSlaHours() {
        return slaHours;
    }

    public void setSlaHours(Double slaHours) {
        this.slaHours = slaHours;
    }

    public List<String> getEscalateTo() {
        return escalateTo;
    }

    public void setEscalateTo(List<String> escalateTo) {
        this.escalateTo = escalateTo == null ? List.of() : List.copyOf(escalateTo);
    }

    public List<OutcomeMeta> getOutcomes() {
        return outcomes;
    }

    public void setOutcomes(List<OutcomeMeta> outcomes) {
        this.outcomes = outcomes == null ? List.of() : List.copyOf(outcomes);
    }

    /** The declared outcome with this name, or null. */
    public OutcomeMeta getOutcome(String name) {
        return outcomes.stream().filter(outcome -> outcome.name().equals(name)).findFirst().orElse(null);
    }

    public String getDueDate() {
        return dueDate;
    }

    public void setDueDate(String dueDate) {
        this.dueDate = dueDate;
    }

    public String getFollowUpDate() {
        return followUpDate;
    }

    public void setFollowUpDate(String followUpDate) {
        this.followUpDate = followUpDate;
    }

    public String getPriority() {
        return priority;
    }

    public void setPriority(String priority) {
        this.priority = priority;
    }

    public String getDocumentation() {
        return documentation;
    }

    public void setDocumentation(String documentation) {
        this.documentation = documentation;
    }
}
