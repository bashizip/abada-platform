package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "project_process_documents")
public class ProjectProcessDocumentEntity {
    public enum Status { ACTIVE, ARCHIVED }

    @Id
    private String id = UUID.randomUUID().toString();
    @Column(name = "project_id", nullable = false)
    private String projectId;
    @Column(name = "process_key", nullable = false)
    private String processKey;
    @Column(name = "folder_id")
    private String folderId;
    @Column(name = "file_name")
    private String fileName;
    @Column(nullable = false)
    private String name;
    @Column(nullable = false, columnDefinition = "TEXT")
    private String description = "";
    @Column(name = "apl_source", nullable = false, columnDefinition = "TEXT")
    private String aplSource;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status = Status.ACTIVE;
    @Column(name = "last_deployment_id")
    private String lastDeploymentId;
    @Column(name = "last_deployed_checksum")
    private String lastDeployedChecksum;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    @Column(name = "last_saved_by", nullable = false)
    private String lastSavedBy;
    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String value) { projectId = value; }
    public String getProcessKey() { return processKey; }
    public void setProcessKey(String value) { processKey = value; }
    public String getFolderId() { return folderId; }
    public void setFolderId(String value) { folderId = value; }
    public String getFileName() { return fileName; }
    public void setFileName(String value) { fileName = value; }
    public String getName() { return name; }
    public void setName(String value) { name = value; }
    public String getDescription() { return description; }
    public void setDescription(String value) { description = value; }
    public String getAplSource() { return aplSource; }
    public void setAplSource(String value) { aplSource = value; }
    public Status getStatus() { return status; }
    public void setStatus(Status value) { status = value; }
    public String getLastDeploymentId() { return lastDeploymentId; }
    public void setLastDeploymentId(String value) { lastDeploymentId = value; }
    public String getLastDeployedChecksum() { return lastDeployedChecksum; }
    public void setLastDeployedChecksum(String value) { lastDeployedChecksum = value; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant value) { updatedAt = value; }
    public String getLastSavedBy() { return lastSavedBy; }
    public void setLastSavedBy(String value) { lastSavedBy = value; }
    public long getEntityVersion() { return entityVersion; }
}
