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
@Table(name = "project_resources")
public class ProjectResourceEntity {
    public enum Kind { FORM, RESOURCE }

    @Id
    private String id = UUID.randomUUID().toString();
    @Column(name = "project_id", nullable = false)
    private String projectId;
    @Column(name = "folder_id")
    private String folderId;
    @Column(nullable = false)
    private String name;
    @Column(name = "content_type", nullable = false)
    private String contentType;
    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;
    @Column(nullable = false)
    private String sha256;
    @Column(nullable = false)
    private byte[] content;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Kind kind = Kind.RESOURCE;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String value) { projectId = value; }
    public String getFolderId() { return folderId; }
    public void setFolderId(String value) { folderId = value; }
    public String getName() { return name; }
    public void setName(String value) { name = value; }
    public String getContentType() { return contentType; }
    public void setContentType(String value) { contentType = value; }
    public long getSizeBytes() { return sizeBytes; }
    public void setSizeBytes(long value) { sizeBytes = value; }
    public String getSha256() { return sha256; }
    public void setSha256(String value) { sha256 = value; }
    public byte[] getContent() { return content; }
    public void setContent(byte[] value) { content = value; }
    public Kind getKind() { return kind; }
    public void setKind(Kind value) { kind = value; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant value) { updatedAt = value; }
    public long getEntityVersion() { return entityVersion; }
}