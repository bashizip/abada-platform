package com.abada.engine.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * A step the worker holding an agent task's lease records before or after a
 * model or tool call ({@code POST /v1/external-tasks/{id}/steps}). The engine
 * computes the digests itself from {@code request} and {@code result}.
 *
 * @param kind {@code MODEL_CALL} or {@code TOOL_CALL}
 * @param state {@code STARTED}, {@code COMPLETED} or {@code FAILED}
 * @param toolRef {@code <server>/<tool>} for a tool call
 * @param request what is sent: the tool arguments, or the model call's input summary
 * @param result what came back (terminal states only)
 */
public record AgentStepRequest(
        String workerId,
        Integer attempt,
        Integer sequence,
        String kind,
        String state,
        String toolRef,
        JsonNode request,
        JsonNode result,
        String errorType,
        String model,
        String promptVersion,
        Integer promptTokens,
        Integer completionTokens) {

    @Override
    public String toString() {
        return "AgentStepRequest[workerId=" + workerId + ", attempt=" + attempt + ", sequence=" + sequence
                + ", kind=" + kind + ", state=" + state + ", toolRef=" + toolRef + "]";
    }
}
