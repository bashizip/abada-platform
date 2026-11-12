package com.abada.engine.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.Immutable;

/**
 * One administrative action (V43). Immutable: Hibernate never issues an UPDATE for
 * it, the code only ever persists it, and PostgreSQL refuses both with a trigger.
 * {@link #detailsJson} holds non-sensitive before/after values only; secrets,
 * tokens and key material never reach it ({@link AdminAuditDetails}).
 */
@Entity
@Immutable
@Table(name = "admin_audit_events")
public class AdminAuditEventEntity {
    public enum Outcome { SUCCESS, DENIED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    @Column(nullable = false, updatable = false)
    private String actor;

    @Column(name = "actor_principal_id", updatable = false)
    private String actorPrincipalId;

    @Column(name = "actor_roles", length = 2000, updatable = false)
    private String actorRoles;

    @Column(nullable = false, length = 64, updatable = false)
    private String action;

    @Column(name = "target_type", nullable = false, length = 64, updatable = false)
    private String targetType;

    @Column(name = "target_id", updatable = false)
    private String targetId;

    @Column(name = "project_id", updatable = false)
    private String projectId;

    @Column(nullable = false, length = 16, updatable = false)
    @jakarta.persistence.Enumerated(jakarta.persistence.EnumType.STRING)
    private Outcome outcome;

    @Column(name = "trace_id", length = 64, updatable = false)
    private String traceId;

    @Column(name = "client_ip", length = 64, updatable = false)
    private String clientIp;

    @Column(name = "details_json", columnDefinition = "TEXT", updatable = false)
    private String detailsJson;

    protected AdminAuditEventEntity() {}

    AdminAuditEventEntity(Instant occurredAt, String actor, String actorPrincipalId, String actorRoles,
            String action, String targetType, String targetId, String projectId, Outcome outcome,
            String traceId, String clientIp, String detailsJson) {
        this.occurredAt = occurredAt;
        this.actor = actor;
        this.actorPrincipalId = actorPrincipalId;
        this.actorRoles = actorRoles;
        this.action = action;
        this.targetType = targetType;
        this.targetId = targetId;
        this.projectId = projectId;
        this.outcome = outcome;
        this.traceId = traceId;
        this.clientIp = clientIp;
        this.detailsJson = detailsJson;
    }

    public Long getId() { return id; }
    public Instant getOccurredAt() { return occurredAt; }
    public String getActor() { return actor; }
    public String getActorPrincipalId() { return actorPrincipalId; }
    public String getActorRoles() { return actorRoles; }
    public String getAction() { return action; }
    public String getTargetType() { return targetType; }
    public String getTargetId() { return targetId; }
    public String getProjectId() { return projectId; }
    public Outcome getOutcome() { return outcome; }
    public String getTraceId() { return traceId; }
    public String getClientIp() { return clientIp; }
    public String getDetailsJson() { return detailsJson; }
}
