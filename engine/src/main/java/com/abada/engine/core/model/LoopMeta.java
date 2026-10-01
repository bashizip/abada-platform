package com.abada.engine.core.model;

import java.io.Serializable;

/**
 * Bound of a loop whose back-edges enter {@code headerId}: the header may be
 * entered at most {@code maxIterations} times per pass of the loop. When a
 * back-edge would exceed it, the token goes to {@code onExhausted}, or an
 * incident is opened when no route is declared.
 */
public record LoopMeta(String headerId, int maxIterations, String onExhausted) implements Serializable {
    public static final int MIN_ITERATIONS = 1;
    public static final int MAX_ITERATIONS = 1000;
}
