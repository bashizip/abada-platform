package com.abada.engine.dto;

/**
 * Request body for retrying failed work.
 *
 * @param retries the attempt budget to restore (job retries endpoints)
 * @param model optional: run failed agent work on this allowed model instead
 *        (this task only; requires {@code reason})
 * @param reason why the operator changed the model; recorded in history
 */
public record RetriesRequest(
        Integer retries,
        String model,
        String reason) {

    public RetriesRequest(Integer retries) {
        this(retries, null, null);
    }
}
