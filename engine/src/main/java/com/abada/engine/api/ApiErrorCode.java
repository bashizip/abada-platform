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
    /** An agent step the engine refused; {@code details.reason} names the rule (E9). */
    AGENT_STEP_REJECTED,
    /** The work was retired (completed, cancelled, failed or timed out); its lease no longer acts. */
    WORK_RETIRED,
    /** The proposal's policy requires a finished replay of its current source before it can be approved (E15). */
    REPLAY_REQUIRED,
    /** An AI provider was not saved: a live call with its key, URL and model failed; {@code message} says why. */
    AI_PROVIDER_TEST_FAILED,
    /** Task completion refused by its pinned form; {@code details.violations} list field ids and rule names (S8). */
    FORM_INVALID,
    /** An upload was refused before anything was kept; {@code details.reason} names the rule (S9). */
    FILE_REJECTED,
    /** The object store (RustFS) did not answer; nothing was kept and the call can be retried (S9). */
    OBJECT_STORE_UNAVAILABLE,
    /** The file's record exists but its contents are missing from the object store (S9). */
    FILE_UNAVAILABLE,
    INTERNAL_ERROR
}
