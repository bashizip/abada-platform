package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;

/** A secret a tool server document names in {@code credential}, AES-GCM encrypted. */
@Entity
@Table(name = "tool_credentials")
@IdClass(ToolCredentialId.class)
public class ToolCredentialEntity {
    @Id
    @Column(name = "project_id", nullable = false)
    private String projectId;
    @Id
    @Column(nullable = false)
    private String name;
    @Column(name = "secret_enc", nullable = false, columnDefinition = "TEXT")
    private String secretEnc;
    @Column(name = "secret_hint")
    private String secretHint;
    @Version
    @Column(nullable = false)
    private long version;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public String getProjectId() { return projectId; }
    public void setProjectId(String value) { projectId = value; }
    public String getName() { return name; }
    public void setName(String value) { name = value; }
    public String getSecretEnc() { return secretEnc; }
    public void setSecretEnc(String value) { secretEnc = value; }
    public String getSecretHint() { return secretHint; }
    public void setSecretHint(String value) { secretHint = value; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant value) { updatedAt = value; }
}
