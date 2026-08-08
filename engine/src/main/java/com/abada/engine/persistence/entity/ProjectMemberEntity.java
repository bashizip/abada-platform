package com.abada.engine.persistence.entity;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "project_members")
public class ProjectMemberEntity {
    public enum Role { OWNER, MAINTAINER, OPERATOR, REVIEWER, VIEWER }

    @Id
    private String id = UUID.randomUUID().toString();
    @Column(name = "project_id", nullable = false)
    private String projectId;
    @Column(name = "principal_id", nullable = false)
    private String principalId;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "created_by", nullable = false)
    private String createdBy;
    @Version
    @Column(name = "entity_version", nullable = false)
    private long entityVersion;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "project_member_roles", joinColumns = @JoinColumn(name = "member_id"))
    @Column(name = "role_name")
    @Enumerated(EnumType.STRING)
    private Set<Role> roles = new LinkedHashSet<>();

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "project_member_review_lanes", joinColumns = @JoinColumn(name = "member_id"))
    @Column(name = "lane_name")
    private Set<String> reviewLanes = new LinkedHashSet<>();

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String value) { projectId = value; }
    public String getPrincipalId() { return principalId; }
    public void setPrincipalId(String value) { principalId = value; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
    public String getCreatedBy() { return createdBy; }
    public void setCreatedBy(String value) { createdBy = value; }
    public long getEntityVersion() { return entityVersion; }
    public Set<Role> getRoles() { return roles; }
    public void setRoles(Set<Role> value) { roles = new LinkedHashSet<>(value); }
    public Set<String> getReviewLanes() { return reviewLanes; }
    public void setReviewLanes(Set<String> value) { reviewLanes = new LinkedHashSet<>(value); }
}
