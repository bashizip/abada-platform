package com.abada.engine.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * One journaled agent step as project members see it: what happened, its
 * digests, tokens and cost, without any payload. Payloads are read separately,
 * by evidence readers only.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AgentStepEvidenceDto(
        String id,
        String externalTaskId,
        String activityId,
        int attempt,
        int sequence,
        String kind,
        String toolRef,
        String policy,
        String state,
        String requestDigest,
        String resultDigest,
        String errorType,
        String model,
        String promptVersion,
        Integer promptTokens,
        Integer completionTokens,
        BigDecimal costUsd,
        boolean costUnpriced,
        String payloadMode,
        String resolvedBy,
        Instant startedAt,
        Instant finishedAt,
        Instant purgedAt) {
}
