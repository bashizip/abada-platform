package com.abada.engine.core.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Locale;

/**
 * What an agent may do with a tool, from least to most guarded. A node may
 * tighten the policy its tool server declares, never loosen it.
 */
public enum ToolPolicy {
    /** No side effects; the worker may call it freely inside the loop limits. */
    READ,
    /** Has side effects; every call is journaled with an idempotency key. */
    WRITE,
    /** Has side effects; the agent stops until a person approves the exact call. */
    APPROVAL_REQUIRED;

    @JsonValue
    public String wireName() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** Parses {@code read}, {@code write} or {@code approval_required}; null for anything else. */
    @JsonCreator
    public static ToolPolicy fromWire(String value) {
        if (value == null) return null;
        for (ToolPolicy policy : values()) {
            if (policy.wireName().equals(value.strip())) return policy;
        }
        return null;
    }

    public boolean atLeastAsStrictAs(ToolPolicy other) {
        return ordinal() >= other.ordinal();
    }
}
