package com.abada.engine.dto;

/**
 * Optional body of an incident retry.
 *
 * @param model for failed agent work: run it on this allowed model instead
 *        (this task only; the deployed definition is unchanged)
 * @param reason why the operator changed the model; required with {@code model}
 * @param toolOutcome for a {@code TOOL_OUTCOME_UNKNOWN} incident (required there):
 *        {@code PERFORMED} or {@code NOT_PERFORMED}, the confirmed fate of the
 *        interrupted write
 */
public record IncidentRetryRequest(String model, String reason, String toolOutcome) {
    public IncidentRetryRequest(String model, String reason) {
        this(model, reason, null);
    }
}
