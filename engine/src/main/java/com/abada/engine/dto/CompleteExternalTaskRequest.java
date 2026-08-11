package com.abada.engine.dto;

import com.abada.engine.core.model.AgentAttemptMetadata;

import java.util.Map;

public record CompleteExternalTaskRequest(String workerId, Map<String, Object> variables,
        AgentAttemptMetadata agent) {

    public CompleteExternalTaskRequest(String workerId, Map<String, Object> variables) {
        this(workerId, variables, null);
    }

    public Map<String, Object> effectiveVariables() {
        return variables == null ? Map.of() : Map.copyOf(variables);
    }
}
