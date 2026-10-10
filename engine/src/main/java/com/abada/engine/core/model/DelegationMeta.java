package com.abada.engine.core.model;

import java.io.Serializable;
import java.util.List;

/**
 * One process an agent node may delegate to (E20b). The agent proposes the
 * delegation as the engine-provided tool {@code delegate:<process>}; the
 * engine checks the inputs against the child's declared variables, the depth
 * and, when {@code approvalRequired}, a person's approval, then starts the
 * pinned child. Only the declared {@code outputs} come back to the agent.
 */
public record DelegationMeta(String nodeId, String process, List<String> outputs, boolean approvalRequired,
        List<String> approvers, String description, Integer maxDepth) implements Serializable {
    public static final int MAX_DELEGATES = 8;
    /** The tool reference an agent's steps name a delegation by. */
    public static final String TOOL_PREFIX = "delegate:";

    public DelegationMeta {
        outputs = outputs == null ? List.of() : List.copyOf(outputs);
        approvers = approvers == null ? List.of() : List.copyOf(approvers);
    }

    public String toolRef() {
        return TOOL_PREFIX + process;
    }

    /** The key a delegate's pinned child is stored under in {@code call_targets}. */
    public String targetKey() {
        return nodeId + "#" + toolRef();
    }
}
