package com.abada.engine.dto;

import com.fasterxml.jackson.databind.JsonNode;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

/**
 * The tool call a {@code TOOL_APPROVAL} task decides. The decision binds to
 * {@code argumentsDigest}: the call runs only with exactly these arguments.
 * {@code arguments} is shown as the evidence policy keeps it (redacted by
 * default) and is null under {@code none} or after retention.
 */
@Schema(description = "A proposed tool call waiting for a person's approval")
public record ToolApprovalDto(
        @Schema(example = "payments/refund") String toolRef,
        @Schema(example = "payments") String server,
        @Schema(example = "refund") String tool,
        @Schema(description = "The agent node that proposed the call", example = "triage") String agentActivityId,
        @Schema(description = "The agent's model", example = "gemini-3.6-flash") String model,
        int attempt,
        int sequence,
        @Schema(description = "SHA-256 of the proposed call; the decision binds to it") String argumentsDigest,
        @Schema(description = "The proposed arguments under the evidence policy") JsonNode arguments,
        @Schema(description = "Evidence payload mode: none, redacted or full", example = "redacted") String payloadMode,
        Instant proposedAt,
        @Schema(description = "PROPOSED, APPROVED, REJECTED, or the state of the call once it ran") String state) {
}
