package com.abada.engine.persistence.entity;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "event_subscriptions", uniqueConstraints =
        @UniqueConstraint(name = "uk_event_subscription", columnNames = {"process_instance_id", "activity_id"}))
public class EventSubscriptionEntity {
    @Id
    private String id = UUID.randomUUID().toString();

    @Column(name = "process_instance_id", nullable = false)
    private String processInstanceId;

    /** Token this work resumes; null for rows created before V23. */
    @Column(name = "token_id", length = 36)
    private String tokenId;

    @Column(name = "activity_id", nullable = false)
    private String activityId;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false)
    private Type eventType;

    @Column(name = "event_name", nullable = false)
    private String eventName;

    @Column(name = "correlation_key")
    private String correlationKey;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    public enum Type { MESSAGE, SIGNAL }

    public String getId() { return id; }
    public String getProcessInstanceId() { return processInstanceId; }
    public void setProcessInstanceId(String value) { processInstanceId = value; }
    public String getActivityId() { return activityId; }
    public void setActivityId(String value) { activityId = value; }
    public Type getEventType() { return eventType; }
    public void setEventType(Type value) { eventType = value; }
    public String getEventName() { return eventName; }
    public void setEventName(String value) { eventName = value; }
    public String getCorrelationKey() { return correlationKey; }
    public void setCorrelationKey(String value) { correlationKey = value; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getConsumedAt() { return consumedAt; }
    public void setConsumedAt(Instant value) { consumedAt = value; }

    public String getTokenId() { return tokenId; }
    public void setTokenId(String tokenId) { this.tokenId = tokenId; }
}
