package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;

/**
 * Governance draft: a complete replacement APL document (with embedded
 * optimizer comments) targeting an immutable definition version. Status
 * transitions DRAFT -> ADOPTED (new version through the schema dispatcher)
 * or REJECTED are idempotent and record the adopting event.
 */
@Entity
@Table(name = "insight_proposals")
public class InsightProposalEntity {

    public enum Status {
        DRAFT,
        IN_REVIEW,
        ADOPTED,
        REJECTED,
        SUPERSEDED
    }

    public enum ApprovalMode { PARALLEL, SEQUENTIAL }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private long id;

    @Column(name = "window_id")
    private Long windowId;

    @Column(name = "definition_key")
    private String definitionKey;

    @Column(name = "definition_deployment_id")
    private String definitionDeploymentId;

    @Column(name = "target_version")
    private int targetVersion;

    @Column(name = "target_checksum")
    private String targetChecksum;

    @Column(name = "target_source", columnDefinition = "TEXT")
    private String targetSource;

    @Column(name = "proposed_source", columnDefinition = "TEXT")
    private String proposedSource;

    @Column(name = "rationale", columnDefinition = "TEXT")
    private String rationale;

    @Enumerated(EnumType.STRING)
    @Column(name = "status")
    private Status status = Status.DRAFT;

    /**
     * Portable partial-uniqueness discriminator. TRUE is reserved by the one
     * open proposal for a deployment; terminal rows use NULL, which remains
     * non-conflicting on PostgreSQL and H2.
     */
    @Column(name = "open_slot")
    private Boolean openSlot = Boolean.TRUE;

    @Column(name = "required_approvals")
    private int requiredApprovals = 1;

    @Column(name = "required_groups")
    private String requiredGroups = "abada-insight-reviewer";

    @Enumerated(EnumType.STRING)
    @Column(name = "approval_mode")
    private ApprovalMode approvalMode = ApprovalMode.PARALLEL;

    @Column(name = "adopted_deployment_id")
    private String adoptedDeploymentId;

    @Column(name = "adopted_version")
    private Integer adoptedVersion;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Version
    @Column(name = "entity_version")
    private long entityVersion;

    public long getId() {
        return id;
    }

    public Long getWindowId() {
        return windowId;
    }

    public void setWindowId(Long windowId) {
        this.windowId = windowId;
    }

    public String getDefinitionKey() {
        return definitionKey;
    }

    public void setDefinitionKey(String definitionKey) {
        this.definitionKey = definitionKey;
    }

    public String getDefinitionDeploymentId() {
        return definitionDeploymentId;
    }

    public void setDefinitionDeploymentId(String definitionDeploymentId) {
        this.definitionDeploymentId = definitionDeploymentId;
    }

    public int getTargetVersion() {
        return targetVersion;
    }

    public void setTargetVersion(int targetVersion) {
        this.targetVersion = targetVersion;
    }

    public String getTargetChecksum() { return targetChecksum; }
    public void setTargetChecksum(String targetChecksum) { this.targetChecksum = targetChecksum; }

    public String getTargetSource() {
        return targetSource;
    }

    public void setTargetSource(String targetSource) {
        this.targetSource = targetSource;
    }

    public String getProposedSource() {
        return proposedSource;
    }

    public void setProposedSource(String proposedSource) {
        this.proposedSource = proposedSource;
    }

    public String getRationale() {
        return rationale;
    }

    public void setRationale(String rationale) {
        this.rationale = rationale;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
        this.openSlot = status == Status.DRAFT || status == Status.IN_REVIEW
                ? Boolean.TRUE : null;
    }

    public int getRequiredApprovals() { return requiredApprovals; }
    public void setRequiredApprovals(int value) { requiredApprovals = value; }
    public String getRequiredGroups() { return requiredGroups; }
    public void setRequiredGroups(String value) { requiredGroups = value; }
    public ApprovalMode getApprovalMode() { return approvalMode; }
    public void setApprovalMode(ApprovalMode value) { approvalMode = value; }

    public String getAdoptedDeploymentId() {
        return adoptedDeploymentId;
    }

    public void setAdoptedDeploymentId(String adoptedDeploymentId) {
        this.adoptedDeploymentId = adoptedDeploymentId;
    }

    public Integer getAdoptedVersion() {
        return adoptedVersion;
    }

    public void setAdoptedVersion(Integer adoptedVersion) {
        this.adoptedVersion = adoptedVersion;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public long getEntityVersion() { return entityVersion; }
}
