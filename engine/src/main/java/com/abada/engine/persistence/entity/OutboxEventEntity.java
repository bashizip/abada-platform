package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "outbox_events")
public class OutboxEventEntity {
    @Id
    private String id = UUID.randomUUID().toString();
    private String aggregateType;
    private String aggregateId;
    private String eventType;
    @Column(nullable = false, columnDefinition = "TEXT")
    private String payloadJson;
    private Instant occurredAt = Instant.now();
    private Instant publishedAt;
    private int attempts;
    @Column(columnDefinition = "TEXT")
    private String lastError;
    private String leaseOwner;
    private Instant leaseExpiresAt;
    private Instant nextAttemptAt;
    @Version
    private long entityVersion;
    /** Stream order (V33), assigned by the database on insert. */
    @Column(name = "seq", insertable = false, updatable = false)
    private Long seq;
    /** The project of the event's instance (V33); null outside any instance. */
    @Column(name = "project_id")
    private String projectId;

    public Long getSeq() { return seq; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String value) { projectId = value; }

    public String getId() { return id; }
    public String getAggregateType() { return aggregateType; }
    public void setAggregateType(String value) { aggregateType = value; }
    public String getAggregateId() { return aggregateId; }
    public void setAggregateId(String value) { aggregateId = value; }
    public String getEventType() { return eventType; }
    public void setEventType(String value) { eventType = value; }
    public String getPayloadJson() { return payloadJson; }
    public void setPayloadJson(String value) { payloadJson = value; }
    public Instant getOccurredAt() { return occurredAt; }
    public Instant getPublishedAt() { return publishedAt; }
    public void setPublishedAt(Instant value) { publishedAt = value; }
    public int getAttempts() { return attempts; }
    public void setAttempts(int value) { attempts = value; }
    public String getLastError() { return lastError; }
    public void setLastError(String value) { lastError = value; }
    public String getLeaseOwner() { return leaseOwner; }
    public void setLeaseOwner(String value) { leaseOwner = value; }
    public Instant getLeaseExpiresAt() { return leaseExpiresAt; }
    public void setLeaseExpiresAt(Instant value) { leaseExpiresAt = value; }
    public Instant getNextAttemptAt() { return nextAttemptAt; }
    public void setNextAttemptAt(Instant value) { nextAttemptAt = value; }
    public long getEntityVersion() { return entityVersion; }
}
