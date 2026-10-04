package com.abada.engine.dto;

import com.abada.engine.core.model.AgentAttemptMetadata;

/**
 * A worker's report that an attempt failed.
 *
 * @param deferred true when the attempt could not run at all because every
 *        model was unavailable (rate limit, quota, provider outage): the engine
 *        keeps the attempt budget and waits with a growing delay instead
 */
public record ExternalTaskFailureDto(
        String workerId,
        String errorMessage,
        String errorDetails,
        Integer retries,
        Long retryTimeout,
        AgentAttemptMetadata agent,
        Boolean deferred) {

    public ExternalTaskFailureDto(String workerId, String errorMessage, String errorDetails,
            Integer retries, Long retryTimeout) {
        this(workerId, errorMessage, errorDetails, retries, retryTimeout, null, null);
    }

    public ExternalTaskFailureDto(String workerId, String errorMessage, String errorDetails,
            Integer retries, Long retryTimeout, AgentAttemptMetadata agent) {
        this(workerId, errorMessage, errorDetails, retries, retryTimeout, agent, null);
    }

    public boolean isDeferred() {
        return Boolean.TRUE.equals(deferred);
    }
}
