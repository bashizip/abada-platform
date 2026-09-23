package com.abada.engine.api;

/** Stable public error codes. Values may be added, but existing meanings are immutable in API v1. */
public enum ApiErrorCode {
    INVALID_REQUEST,
    BPMN_VALIDATION_FAILED,
    ENGINE_COMMAND_REJECTED,
    RESOURCE_NOT_FOUND,
    CONCURRENT_MODIFICATION,
    AUTHENTICATION_REQUIRED,
    ACCESS_DENIED,
    IDEMPOTENCY_CONFLICT,
    WORKER_LOCK_NOT_OWNED,
    WORKER_LOCK_EXPIRED,
    EXPRESSION_EVALUATION_FAILED,
    INTERNAL_ERROR
}
