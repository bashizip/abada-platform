package com.abada.engine.core.model;

import java.io.Serializable;

/**
 * One decision a reviewer can take on a human task ({@code outcomes:} in APL,
 * {@code abada:outcomes} in BPMN).
 *
 * @param name the outcome, written to {@code <task>_outcome}
 * @param commentRequired whether the decision must carry a non-blank comment
 * @param target where the flow continues (APL); null when the BPMN graph
 *        routes on {@code <task>_outcome} after the task
 */
public record OutcomeMeta(String name, boolean commentRequired, String target) implements Serializable {

    /** Outcome names: lowercase, start with a letter, at most 32 characters. */
    public static final String NAME_PATTERN = "[a-z][a-z0-9_]{0,31}";
    public static final int MIN_OUTCOMES = 2;
    public static final int MAX_OUTCOMES = 6;
    /** Longest comment kept in {@code <task>_comment}. */
    public static final int MAX_COMMENT_LENGTH = 4_000;
}
