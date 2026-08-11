package com.abada.engine.dto;

import com.abada.engine.core.model.AgentAttemptMetadata;

public record ExternalTaskFailureDto(
        String workerId,
        String errorMessage,
        String errorDetails,
        Integer retries,
        Long retryTimeout,
        AgentAttemptMetadata agent) {

    public ExternalTaskFailureDto(String workerId, String errorMessage, String errorDetails,
            Integer retries, Long retryTimeout) {
        this(workerId, errorMessage, errorDetails, retries, retryTimeout, null);
    }
}
