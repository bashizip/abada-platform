package com.abada.engine.dto;

/**
 * Optional body of an incident retry.
 *
 * @param model for failed agent work: run it on this allowed model instead
 *        (this task only; the deployed definition is unchanged)
 * @param reason why the operator changed the model; required with {@code model}
 */
public record IncidentRetryRequest(String model, String reason) {
}
