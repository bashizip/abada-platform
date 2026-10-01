package com.abada.engine.dto;

/** Outcome of a provider connection test: status is READY, NOT_CONFIGURED or ERROR. */
public record AiConnectionTestResult(boolean success, String status, Long latencyMs, String model, String message) {
}
