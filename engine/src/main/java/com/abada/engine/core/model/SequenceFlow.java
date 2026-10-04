package com.abada.engine.core.model;

import java.io.Serializable;

public class SequenceFlow implements Serializable {
    private final String id;
    private final String sourceRef;
    private final String targetRef;
    private final String name;
    private final String conditionExpression;
    private final boolean isDefault;
    private String language; // (optional: to support expression languages like groovy, js, etc.)
    /** Set when this flow leaves its activity through a boundary (on_error, on_timeout, ...), never as `next`. */
    private final String boundaryId;


    public SequenceFlow(String id, String sourceRef, String targetRef,
                        String name, String conditionExpression, boolean isDefault) {
        this(id, sourceRef, targetRef, name, conditionExpression, isDefault, null);
    }

    public SequenceFlow(String id, String sourceRef, String targetRef,
                        String name, String conditionExpression, boolean isDefault, String boundaryId) {
        this.boundaryId = boundaryId;
        this.id = id;
        this.sourceRef = sourceRef;
        this.targetRef = targetRef;
        this.name = name;
        this.conditionExpression = conditionExpression;
        this.isDefault = isDefault;
    }

    public boolean isDefault() {
        return isDefault;
    }

    public String getBoundaryId() {
        return boundaryId;
    }

    /** True for a boundary route; the token takes it only when that boundary fires. */
    public boolean isBoundary() {
        return boundaryId != null;
    }

    public String getId() {
        return id;
    }

    public String getSourceRef() {
        return sourceRef;
    }

    public String getTargetRef() {
        return targetRef;
    }

    public String getName() {
        return name;
    }

    public String getConditionExpression() {
        return conditionExpression;
    }

    public String getLanguage() {
        return language;
    }

    public void setLanguage(String language) {
        this.language = language;
    }
}
