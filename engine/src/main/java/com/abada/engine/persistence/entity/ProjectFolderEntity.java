package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "project_folders")
public class ProjectFolderEntity {
    @Id
    private String id = UUID.randomUUID().toString();
    @Column(name = "project_id", nullable = false)
    private String projectId;
    @Column(name = "parent_id")
    private String parentId;
    @Column(nullable = false)
    private String name;
    @Column(name = "system_folder", nullable = false)
    private boolean systemFolder;
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
    public String getParentId() { return parentId; }
    public void setParentId(String value) { parentId = value; }
    public String getName() { return name; }
    public void setName(String value) { name = value; }
    public boolean isSystemFolder() { return systemFolder; }
    public void setSystemFolder(boolean value) { systemFolder = value; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant value) { updatedAt = value; }
    public long getEntityVersion() { return entityVersion; }
}