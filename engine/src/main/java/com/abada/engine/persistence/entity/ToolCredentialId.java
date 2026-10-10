package com.abada.engine.persistence.entity;

import java.io.Serializable;
import java.util.Objects;

public class ToolCredentialId implements Serializable {
    private String projectId;
    private String name;

    public ToolCredentialId() {}

    public ToolCredentialId(String projectId, String name) {
        this.projectId = projectId;
        this.name = name;
    }

    public String getProjectId() { return projectId; }
    public String getName() { return name; }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof ToolCredentialId that)) return false;
        return Objects.equals(projectId, that.projectId) && Objects.equals(name, that.name);
    }

    @Override
    public int hashCode() { return Objects.hash(projectId, name); }
}
