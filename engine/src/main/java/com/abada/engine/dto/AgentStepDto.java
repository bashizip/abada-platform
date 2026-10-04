package com.abada.engine.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * A journaled agent step as the lease holder sees it. {@code idempotencyKey}
 * is set for write tool calls whose server accepts a key: send it with the
 * call, and the same key again if the step is resumed. {@code reused} means an
 * earlier attempt already performed this exact write; do not call the tool.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AgentStepDto(
        int attempt,
        int sequence,
        String kind,
        String state,
        String toolRef,
        String policy,
        String idempotencyKey,
        String requestDigest,
        String resultDigest,
        JsonNode request,
        JsonNode result,
        String errorType,
        String model,
        Integer promptTokens,
        Integer completionTokens,
        Boolean reused) {

    @Override
    public String toString() {
        return "AgentStepDto[attempt=" + attempt + ", sequence=" + sequence + ", kind=" + kind + ", state=" + state
                + ", toolRef=" + toolRef + "]";
    }
}
