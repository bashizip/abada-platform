package com.abada.engine.persistence.entity;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "activity_history")
public class ActivityHistoryEntity {
    @Id
    private String id = UUID.randomUUID().toString();
    private String processInstanceId;
    private String processDefinitionId;
    private String activityId;
    @Column(nullable = false)
    private String eventType;
    @Column(nullable = false)
    private String actor;
    @Column(nullable = false)
    private Instant occurredAt = Instant.now();
    private String traceId;
    @Column(nullable = false, columnDefinition = "TEXT")
    private String detailsJson = "{}";

    public String getId() { return id; }
    public String getProcessInstanceId() { return processInstanceId; }
    public void setProcessInstanceId(String value) { processInstanceId = value; }
    public String getProcessDefinitionId() { return processDefinitionId; }
    public void setProcessDefinitionId(String value) { processDefinitionId = value; }
    public String getActivityId() { return activityId; }
    public void setActivityId(String value) { activityId = value; }
    public String getEventType() { return eventType; }
    public void setEventType(String value) { eventType = value; }
    public String getActor() { return actor; }
    public void setActor(String value) { actor = value; }
    public Instant getOccurredAt() { return occurredAt; }
    public void setOccurredAt(Instant value) { occurredAt = value; }
    public String getTraceId() { return traceId; }
    public void setTraceId(String value) { traceId = value; }
    public String getDetailsJson() { return detailsJson; }
    public void setDetailsJson(String value) { detailsJson = value; }
}
