package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "principals")
public class PrincipalEntity {
    public enum Type { HUMAN, SERVICE }

    @Id
    private String id = UUID.randomUUID().toString();
    @Column(nullable = false)
    private String issuer;
    @Column(name = "subject_id", nullable = false)
    private String subjectId;
    @Column(nullable = false)
    private String username;
    @Enumerated(EnumType.STRING)
    @Column(name = "principal_type", nullable = false)
    private Type principalType = Type.HUMAN;
    @Column(name = "first_seen_at", nullable = false)
    private Instant firstSeenAt;
    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getIssuer() { return issuer; }
    public void setIssuer(String value) { issuer = value; }
    public String getSubjectId() { return subjectId; }
    public void setSubjectId(String value) { subjectId = value; }
    public String getUsername() { return username; }
    public void setUsername(String value) { username = value; }
    public Type getPrincipalType() { return principalType; }
    public void setPrincipalType(Type value) { principalType = value; }
    public Instant getFirstSeenAt() { return firstSeenAt; }
    public void setFirstSeenAt(Instant value) { firstSeenAt = value; }
    public Instant getLastSeenAt() { return lastSeenAt; }
    public void setLastSeenAt(Instant value) { lastSeenAt = value; }
}
