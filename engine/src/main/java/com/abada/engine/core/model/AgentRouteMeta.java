package com.abada.engine.core.model;

import java.io.Serializable;

/**
 * One route an agent node lets its agent choose (E13): the agent names it in
 * its result's {@code route}, the engine checks it is declared and that its
 * optional CEL {@code when} allows it, then leaves through the matching
 * {@link BoundaryMeta.Kind#ROUTE} boundary to {@code target}.
 */
public record AgentRouteMeta(String name, String description, String when, String target) implements Serializable {
    public static final int MIN_ROUTES = 2;
    public static final int MAX_ROUTES = 8;
    public static final int MAX_DESCRIPTION_LENGTH = 500;
    /** The property of the agent's result that names the chosen route. */
    public static final String RESULT_PROPERTY = "route";
}
