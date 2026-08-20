package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

/**
 * A global, project-agnostic worker capability: the principal may serve the
 * given topic across every project. {@code models} is a comma-separated list
 * of supported model identifiers; an empty value means all models.
 */
@Entity
@Table(name = "worker_capabilities")
public class WorkerCapabilityEntity {
    @Id
    private String id = UUID.randomUUID().toString();
    @Column(name = "principal_id", nullable = false)
    private String principalId;
    @Column(nullable = false)
    private String topic;
    @Column(nullable = false)
    private String models;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "created_by", nullable = false)
    private String createdBy;
    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getPrincipalId() { return principalId; }
    public void setPrincipalId(String value) { principalId = value; }
    public String getTopic() { return topic; }
    public void setTopic(String value) { topic = value; }
    public String getModels() { return models; }
    public void setModels(String value) { models = value; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
    public String getCreatedBy() { return createdBy; }
    public void setCreatedBy(String value) { createdBy = value; }
    public long getEntityVersion() { return entityVersion; }
}