package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "insight_proposal_reviews")
public class InsightProposalReviewEntity {
    public enum Decision { APPROVE, REJECT }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private long id;
    @Column(name = "proposal_id") private long proposalId;
    @Column(name = "actor") private String actor;
    @Column(name = "actor_groups") private String actorGroups;
    @Enumerated(EnumType.STRING)
    @Column(name = "decision") private Decision decision;
    @Column(name = "comment_text", columnDefinition = "TEXT") private String comment;
    @Column(name = "created_at") private Instant createdAt;

    public long getId() { return id; }
    public long getProposalId() { return proposalId; }
    public void setProposalId(long value) { proposalId = value; }
    public String getActor() { return actor; }
    public void setActor(String value) { actor = value; }
    public String getActorGroups() { return actorGroups; }
    public void setActorGroups(String value) { actorGroups = value; }
    public Decision getDecision() { return decision; }
    public void setDecision(Decision value) { decision = value; }
    public String getComment() { return comment; }
    public void setComment(String value) { comment = value; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
}
