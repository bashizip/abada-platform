package com.abada.engine.persistence.entity;

import java.io.Serializable;
import java.util.Objects;

public class InsightApprovalPolicyId implements Serializable {
    private String projectId;
    private String definitionKey;

    public InsightApprovalPolicyId() {}

    public InsightApprovalPolicyId(String projectId, String definitionKey) {
        this.projectId = projectId;
        this.definitionKey = definitionKey;
    }

    public String getProjectId() { return projectId; }
    public String getDefinitionKey() { return definitionKey; }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof InsightApprovalPolicyId that)) return false;
        return Objects.equals(projectId, that.projectId)
                && Objects.equals(definitionKey, that.definitionKey);
    }

    @Override
    public int hashCode() { return Objects.hash(projectId, definitionKey); }
}
