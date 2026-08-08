package com.abada.engine.core.model;

import java.util.Locale;

/**
 * The source schema of a deployed process definition.
 *
 * <p>Definitions are persistent and immutable by design. The source column on
 * process_definitions stores either canonical BPMN 2.0 XML or a native
 * {@code abada.io/v1} APL YAML document; the runtime selects the compiler by
 * the persisted schema type so that running instances and restarts always
 * rebuild the exact same executable graph.
 */
public enum DefinitionSchema {
    BPMN_XML,
    APL_NATIVE;

    public static DefinitionSchema from(String raw) {
        if (raw == null || raw.isBlank()) return BPMN_XML;
        return valueOf(raw.trim().toUpperCase(Locale.ROOT));
    }
}