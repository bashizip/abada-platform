package io.abada.worker;

import java.util.List;
import java.util.Map;

/**
 * A process an agent may delegate to (protocol v1, E20b): offered to the model
 * as the engine-provided tool {@code tool} ({@code delegate:<process>}) with
 * {@code inputSchema} built from the child's declared variables. Journal the
 * call as a {@code DELEGATION} step: {@code PROPOSED} when {@code approval} is
 * {@code required}, otherwise {@code STARTED}; the engine starts the child,
 * parks the work, and finishes the step with the child's declared
 * {@code outputs} when it ends.
 */
public record AgentDelegate(String process, String tool, String description, Map<String, Object> inputSchema,
        String approval, List<String> outputs) {
    public AgentDelegate {
        inputSchema = inputSchema == null ? Map.of() : Map.copyOf(inputSchema);
        outputs = outputs == null ? List.of() : List.copyOf(outputs);
    }

    public boolean approvalRequired() {
        return "required".equals(approval);
    }
}
