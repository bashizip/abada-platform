package com.abada.engine.core.model;

import java.io.Serializable;
import java.time.Duration;

/**
 * A boundary attached to a wait-state activity (agent, engine-task, user task):
 * when it fires, the token leaves the activity for {@code target} instead of
 * its normal next step. Its flow is a {@link SequenceFlow} with this id as
 * {@link SequenceFlow#getBoundaryId()}.
 *
 * @param kind which condition fires it
 * @param code for ERROR, the error code it catches; null catches every error
 * @param after for TIMEOUT, how long after the activity is entered it fires
 */
public record BoundaryMeta(String id, String attachedTo, Kind kind, String code, Duration after, String target)
        implements Serializable {

    public enum Kind {
        /** A worker-reported error or the last failed attempt (code {@code WORK_FAILED}). */
        ERROR,
        /** The activity was not left within {@code after}; its work is cancelled. */
        TIMEOUT,
        /** The agent result's confidence is missing or below the threshold. */
        LOW_CONFIDENCE,
        /** The agent result violates the output contract. */
        INVALID_OUTPUT,
        /** A reviewer decided the human task's outcome named by {@code code}. */
        OUTCOME,
        /** The agent chose the route named by {@code code} and the engine allowed it. */
        ROUTE
    }

    /** Error code of an attempt budget exhausted without a worker-reported error. */
    public static final String WORK_FAILED = "WORK_FAILED";

    /** True when this ERROR boundary catches {@code errorCode} (a code-less boundary catches all). */
    public boolean catches(String errorCode) {
        if (kind == Kind.OUTCOME || kind == Kind.ROUTE) return false;
        return kind == Kind.ERROR && (code == null || code.equals(errorCode));
    }
}
