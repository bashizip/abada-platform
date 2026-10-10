package io.abada.worker;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * A journaled agent step (protocol v1, 1.1.0-rc.2). Returned when a step is
 * recorded and, for the current attempt, with every locked agent task so a
 * worker resumes after the last committed step.
 *
 * @param idempotencyKey set for write tool calls whose server accepts a key:
 *        send it with the call, and the same key again when the step resumes
 * @param reused true when an earlier attempt already performed this exact
 *        write; the worker must not call the tool and uses {@code result}
 */
public record AgentStep(
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
        return "AgentStep[attempt=" + attempt + ", sequence=" + sequence + ", kind=" + kind + ", state=" + state
                + ", toolRef=" + toolRef + "]";
    }
}
