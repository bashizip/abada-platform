package io.abada.agent.mcp;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;

/**
 * The tool server sessions of one agent task: opened on first use, one per
 * server, closed when the task ends.
 */
public final class McpSessionPool implements AutoCloseable {
    private final Function<String, McpToolClient> opener;
    private final Map<String, McpToolClient> open = new LinkedHashMap<>();

    /** @param opener opens a session to a bound server (by server name) */
    public McpSessionPool(Function<String, McpToolClient> opener) {
        this.opener = opener;
    }

    public synchronized McpToolClient session(String server) {
        return open.computeIfAbsent(server, opener);
    }

    @Override
    public synchronized void close() {
        open.values().forEach(McpToolClient::close);
        open.clear();
    }
}
