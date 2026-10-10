package io.abada.agent.mcp;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.spec.McpSchema;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@link McpToolClient} over the official MCP Java SDK (MIT): streamable HTTP
 * on the JDK {@code HttpClient}. The bearer token comes from the project's tool
 * credential; a per-call idempotency key travels to the HTTP request through
 * the SDK's transport context.
 */
public final class SdkMcpToolClient implements McpToolClient {
    private static final String KEY = "abada.idempotencyKey";
    private static final ThreadLocal<String> CALL_KEY = new ThreadLocal<>();

    private final McpSyncClient client;
    private final String server;

    public SdkMcpToolClient(String server, URI url, String bearerToken, Duration timeout) {
        this.server = server;
        String base = url.getScheme() + "://" + url.getRawAuthority();
        String endpoint = url.getRawPath() == null || url.getRawPath().isBlank() ? "/" : url.getRawPath();
        if (url.getRawQuery() != null) endpoint += "?" + url.getRawQuery();
        HttpClientStreamableHttpTransport transport = HttpClientStreamableHttpTransport.builder(base)
                .endpoint(endpoint)
                .connectTimeout(Duration.ofSeconds(10))
                .httpRequestCustomizer((request, method, uri, body, context) -> {
                    if (bearerToken != null && !bearerToken.isBlank()) {
                        request.header("Authorization", "Bearer " + bearerToken);
                    }
                    Object key = context == null ? null : context.get(KEY);
                    if (key != null) request.header("Idempotency-Key", key.toString());
                })
                .build();
        this.client = McpClient.sync(transport)
                .requestTimeout(timeout)
                .initializationTimeout(timeout)
                .clientInfo(new McpSchema.Implementation("abada-agent-worker", "1"))
                .transportContextProvider(() -> {
                    String key = CALL_KEY.get();
                    return key == null ? McpTransportContext.EMPTY : McpTransportContext.create(Map.of(KEY, key));
                })
                .build();
        try {
            client.initialize();
        } catch (RuntimeException failure) {
            throw unavailable("initialize", failure);
        }
    }

    @Override
    public List<ToolDescription> listTools() {
        try {
            List<ToolDescription> tools = new ArrayList<>();
            String cursor = null;
            do {
                McpSchema.ListToolsResult page = cursor == null ? client.listTools() : client.listTools(cursor);
                for (McpSchema.Tool tool : page.tools()) {
                    tools.add(new ToolDescription(tool.name(), tool.description(), schemaOf(tool)));
                }
                cursor = page.nextCursor();
            } while (cursor != null && !cursor.isBlank());
            return tools;
        } catch (RuntimeException failure) {
            throw unavailable("tools/list", failure);
        }
    }

    @Override
    public ToolOutcome call(String tool, Map<String, Object> arguments, String idempotencyKey) {
        McpSchema.CallToolRequest.Builder request = McpSchema.CallToolRequest.builder()
                .name(tool).arguments(arguments == null ? Map.of() : arguments);
        if (idempotencyKey != null) request.meta(Map.of("idempotencyKey", idempotencyKey));
        McpSchema.CallToolResult result;
        CALL_KEY.set(idempotencyKey);
        try {
            result = client.callTool(request.build());
        } catch (RuntimeException failure) {
            throw unavailable("tools/call " + tool, failure);
        } finally {
            CALL_KEY.remove();
        }
        StringBuilder text = new StringBuilder();
        if (result.content() != null) {
            for (McpSchema.Content content : result.content()) {
                if (content instanceof McpSchema.TextContent textContent) {
                    if (!text.isEmpty()) text.append('\n');
                    text.append(textContent.text());
                } else {
                    if (!text.isEmpty()) text.append('\n');
                    text.append("[").append(content.type()).append(" content omitted]");
                }
            }
        }
        return new ToolOutcome(text.toString(), result.structuredContent(), Boolean.TRUE.equals(result.isError()));
    }

    @Override
    public void close() {
        try {
            client.closeGracefully();
        } catch (RuntimeException ignored) {
            // closing a session the server already dropped
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> schemaOf(McpSchema.Tool tool) {
        Object schema = tool.inputSchema();
        if (schema instanceof Map<?, ?> map) return new LinkedHashMap<>((Map<String, Object>) map);
        return Map.of();
    }

    private McpUnavailableException unavailable(String operation, RuntimeException failure) {
        return new McpUnavailableException("Tool server '" + server + "' did not answer " + operation + ": "
                + failure.getMessage(), failure);
    }
}
