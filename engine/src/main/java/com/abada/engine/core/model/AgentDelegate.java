package com.abada.engine.core.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * A delegation an agent may propose, as the worker sees it (E20b): the
 * engine-provided tool {@code delegate:<process>}, its input schema built from
 * the pinned child's declared variables, whether a person approves it first,
 * and the child variables that come back.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AgentDelegate(String process, String tool, String description, Map<String, Object> inputSchema,
        String approval, List<String> outputs) implements Serializable {
    public AgentDelegate {
        inputSchema = inputSchema == null ? Map.of() : Map.copyOf(inputSchema);
        outputs = outputs == null ? List.of() : List.copyOf(outputs);
    }
}
