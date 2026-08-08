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
 * One analyzer finding for a (definition, node, signal) within a window.
 * Only identifiers and statistics; business values never land here.
 */
@Entity
@Table(name = "insight_findings")
public class InsightFindingEntity {

    public enum SignalType {
        FAILURE_RATE,
        LATENCY_P95,
        FALLBACK_THRASH
    }

    public enum Severity {
        LOW,
        MEDIUM,
        HIGH
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private long id;

    @Column(name = "window_id")
    private long windowId;

    @Column(name = "definition_key")
    private String definitionKey;

    @Column(name = "definition_deployment_id")
    private String definitionDeploymentId;

    @Column(name = "node_id")
    private String nodeId;

    @Column(name = "node_type")
    private String nodeType;

    @Enumerated(EnumType.STRING)
    @Column(name = "signal_type")
    private SignalType signalType;

    @Enumerated(EnumType.STRING)
    @Column(name = "severity")
    private Severity severity;

    @Column(name = "observed_value")
    private double observedValue;

    @Column(name = "threshold")
    private double threshold;

    @Column(name = "sample_count")
    private int sampleCount;

    @Column(name = "summary", columnDefinition = "TEXT")
    private String summary;

    @Column(name = "created_at")
    private Instant createdAt;

    public long getId() {
        return id;
    }

    public long getWindowId() {
        return windowId;
    }

    public void setWindowId(long windowId) {
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

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    public String getNodeType() {
        return nodeType;
    }

    public void setNodeType(String nodeType) {
        this.nodeType = nodeType;
    }

    public SignalType getSignalType() {
        return signalType;
    }

    public void setSignalType(SignalType signalType) {
        this.signalType = signalType;
    }

    public Severity getSeverity() {
        return severity;
    }

    public void setSeverity(Severity severity) {
        this.severity = severity;
    }

    public double getObservedValue() {
        return observedValue;
    }

    public void setObservedValue(double observedValue) {
        this.observedValue = observedValue;
    }

    public double getThreshold() {
        return threshold;
    }

    public void setThreshold(double threshold) {
        this.threshold = threshold;
    }

    public int getSampleCount() {
        return sampleCount;
    }

    public void setSampleCount(int sampleCount) {
        this.sampleCount = sampleCount;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}