package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;

/**
 * A file uploaded to a human-task form (V42). Metadata only: the bytes are in
 * the object store under {@link #objectKey}. The name is shown to people who
 * may read the file and is never logged.
 */
@Entity
@Table(name = "process_files")
public class ProcessFileEntity {
    public enum State { PENDING, ATTACHED, DELETING }

    @Id
    private String id;

    @Column(name = "project_id", nullable = false)
    private String projectId;

    @Column(name = "uploaded_by", nullable = false)
    private String uploadedBy;

    @Column(name = "content_type", nullable = false)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(nullable = false, length = 64)
    private String sha256;

    @Column(nullable = false)
    private String name;

    @Column(name = "object_key", nullable = false, length = 512)
    private String objectKey;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private State state;

    @Column(name = "instance_id", nullable = false)
    private String instanceId;

    @Column(name = "task_id", nullable = false)
    private String taskId;

    @Column(name = "field_id", nullable = false)
    private String fieldId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "attached_at")
    private Instant attachedAt;

    @Column(name = "deleting_reason", length = 32)
    private String deletingReason;

    @Column(name = "lease_owner")
    private String leaseOwner;

    @Column(name = "lease_expires_at")
    private Instant leaseExpiresAt;

    private int attempts;

    @Column(name = "last_error", length = 1000)
    private String lastError;

    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String value) { projectId = value; }
    public String getUploadedBy() { return uploadedBy; }
    public void setUploadedBy(String value) { uploadedBy = value; }
    public String getContentType() { return contentType; }
    public void setContentType(String value) { contentType = value; }
    public long getSizeBytes() { return sizeBytes; }
    public void setSizeBytes(long value) { sizeBytes = value; }
    public String getSha256() { return sha256; }
    public void setSha256(String value) { sha256 = value; }
    public String getName() { return name; }
    public void setName(String value) { name = value; }
    public String getObjectKey() { return objectKey; }
    public void setObjectKey(String value) { objectKey = value; }
    public State getState() { return state; }
    public void setState(State value) { state = value; }
    public String getInstanceId() { return instanceId; }
    public void setInstanceId(String value) { instanceId = value; }
    public String getTaskId() { return taskId; }
    public void setTaskId(String value) { taskId = value; }
    public String getFieldId() { return fieldId; }
    public void setFieldId(String value) { fieldId = value; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
    public Instant getAttachedAt() { return attachedAt; }
    public void setAttachedAt(Instant value) { attachedAt = value; }
    public String getDeletingReason() { return deletingReason; }
    public void setDeletingReason(String value) { deletingReason = value; }
    public String getLeaseOwner() { return leaseOwner; }
    public void setLeaseOwner(String value) { leaseOwner = value; }
    public Instant getLeaseExpiresAt() { return leaseExpiresAt; }
    public void setLeaseExpiresAt(Instant value) { leaseExpiresAt = value; }
    public int getAttempts() { return attempts; }
    public void setAttempts(int value) { attempts = value; }
    public String getLastError() { return lastError; }
    public void setLastError(String value) { lastError = value; }
    public long getEntityVersion() { return entityVersion; }
}
