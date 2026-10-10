package io.abada.agent.mcp;

import java.util.List;
import java.util.Map;

/**
 * The MCP operations the agent worker uses on one tool server. The engine
 * never talks to tool servers; the worker does, only for tools the engine
 * bound to the task.
 */
public interface McpToolClient extends AutoCloseable {

    /** The tools the server offers now. */
    List<ToolDescription> listTools();

    /**
     * Calls a tool. {@code idempotencyKey} (null for reads and unkeyed writes)
     * is sent as the {@code Idempotency-Key} header and in {@code _meta}, so a
     * resumed write takes effect once on servers that honour it.
     */
    ToolOutcome call(String tool, Map<String, Object> arguments, String idempotencyKey);

    @Override
    void close();

    /** A tool as the server describes it. */
    record ToolDescription(String name, String description, Map<String, Object> inputSchema) {
        public ToolDescription {
            inputSchema = inputSchema == null ? Map.of() : inputSchema;
        }
    }

    /** A tool's answer: its text content, structured content if any, and whether the tool reported an error. */
    record ToolOutcome(String text, Object structured, boolean isError) {}

    /** The server could not answer (unreachable, timeout, 5xx): the outcome of the call is unknown. */
    final class McpUnavailableException extends RuntimeException {
        public McpUnavailableException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
