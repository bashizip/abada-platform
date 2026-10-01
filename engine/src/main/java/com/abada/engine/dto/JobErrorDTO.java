package com.abada.engine.dto;

/**
 * The error last reported for an external task (job), for Studio's error
 * details dialog: the message and the redacted stack trace the worker sent.
 * Only the most recent attempt's error is kept.
 */
public record JobErrorDTO(
        String jobId,
        String processInstanceId,
        String activityId,
        String status,
        Integer retries,
        String errorMessage,
        String errorDetails) {
}
