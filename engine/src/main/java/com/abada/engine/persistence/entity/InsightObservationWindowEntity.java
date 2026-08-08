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

/**
 * One durable Insight analysis window. ANALYZED windows can be resumed after
 * proposal-generation failures; the latest COMPLETED {@code endedAt} remains
 * the worker cursor across replicas.
 */
@Entity
@Table(name = "insight_observation_windows")
public class InsightObservationWindowEntity {

    public enum Status {
        ANALYZED,
        COMPLETED,
        FAILED
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private long id;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "status")
    private Status status;

    @Column(name = "facts_processed")
    private int factsProcessed;

    @Column(name = "findings_count")
    private int findingsCount;

    @Column(name = "proposals_count")
    private int proposalsCount;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    public long getId() {
        return id;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getEndedAt() {
        return endedAt;
    }

    public void setEndedAt(Instant endedAt) {
        this.endedAt = endedAt;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }

    public int getFactsProcessed() {
        return factsProcessed;
    }

    public void setFactsProcessed(int factsProcessed) {
        this.factsProcessed = factsProcessed;
    }

    public int getFindingsCount() {
        return findingsCount;
    }

    public void setFindingsCount(int findingsCount) {
        this.findingsCount = findingsCount;
    }

    public int getProposalsCount() {
        return proposalsCount;
    }

    public void setProposalsCount(int proposalsCount) {
        this.proposalsCount = proposalsCount;
    }

    public Instant getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(Instant completedAt) {
        this.completedAt = completedAt;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }
}
