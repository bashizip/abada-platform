package com.abada.engine.core.model;

import java.io.Serializable;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * An APL {@code call-process} node: the token waits while a governed child
 * instance of {@code processKey} (in the same project, at the version pinned
 * when the parent was deployed) runs to its end.
 *
 * @param inputs child variable to the expression evaluated on the parent's variables
 * @param outputs parent variable to the child variable copied back on completion
 *        (default-deny: nothing else returns)
 * @param maxDepth a stricter limit on how deep this call may nest; null for the engine's
 */
public record CallProcessMeta(String id, String name, String processKey, Map<String, String> inputs,
        Map<String, String> outputs, Integer maxDepth) implements Serializable {

    public CallProcessMeta {
        inputs = inputs == null ? Map.of() : java.util.Collections.unmodifiableMap(new LinkedHashMap<>(inputs));
        outputs = outputs == null ? Map.of() : java.util.Collections.unmodifiableMap(new LinkedHashMap<>(outputs));
    }
}
