package io.abada.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A minimal MCP server over streamable HTTP (JSON responses) for tests:
 * {@code get_customer} (read) and {@code create_ticket} (a write that takes
 * effect once per idempotency key, counted in {@link #effectiveWrites}).
 */
public final class StubMcpServer implements AutoCloseable {
    private static final ObjectMapper JSON = new ObjectMapper();
    public static final Map<String, Object> TICKET_SCHEMA = Map.of("type", "object",
            "properties", Map.of("subject", Map.of("type", "string")), "required", List.of("subject"));

    private final HttpServer server;
    public final List<Map<String, String>> calls = new CopyOnWriteArrayList<>();
    public final Map<String, Integer> effectiveWrites = new ConcurrentHashMap<>();
    public final AtomicInteger writesWithoutKey = new AtomicInteger();
    public volatile int failNextCalls;
    public volatile long delayMs;
    /** The next write takes effect, then the server fails before answering (a crash mid-write). */
    public volatile boolean applyThenFailNextWrite;
    public volatile String customerName = "Ada";

    public StubMcpServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/mcp", this::handle);
        server.start();
    }

    public URI url() {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/mcp");
    }

    @Override
    public void close() {
        server.stop(0);
    }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            if (!"POST".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders("DELETE".equals(exchange.getRequestMethod()) ? 200 : 405, -1);
                return;
            }
            JsonNode request = JSON.readTree(exchange.getRequestBody().readAllBytes());
            String method = request.path("method").asText();
            if (!request.has("id")) {                       // a notification
                exchange.sendResponseHeaders(202, -1);
                return;
            }
            ObjectNode result = JSON.createObjectNode();
            switch (method) {
                case "initialize" -> {
                    result.put("protocolVersion", request.path("params").path("protocolVersion").asText("2025-06-18"));
                    result.putObject("capabilities").putObject("tools");
                    result.putObject("serverInfo").put("name", "stub-crm").put("version", "1");
                    exchange.getResponseHeaders().add("Mcp-Session-Id", "session-1");
                }
                case "tools/list" -> {
                    ArrayNode tools = result.putArray("tools");
                    tools.addObject().put("name", "get_customer").put("description", "Read a customer")
                            .set("inputSchema", JSON.valueToTree(Map.of("type", "object",
                                    "properties", Map.of("id", Map.of("type", "integer")))));
                    tools.addObject().put("name", "create_ticket").put("description", "Open a ticket")
                            .set("inputSchema", JSON.valueToTree(TICKET_SCHEMA));
                }
                case "tools/call" -> {
                    if (failNextCalls > 0) {
                        failNextCalls--;
                        exchange.sendResponseHeaders(503, -1);
                        return;
                    }
                    if (delayMs > 0) Thread.sleep(delayMs);
                    String tool = request.path("params").path("name").asText();
                    String headerKey = exchange.getRequestHeaders().getFirst("Idempotency-Key");
                    String metaKey = request.path("params").path("_meta").path("idempotencyKey").asText(null);
                    String authorization = exchange.getRequestHeaders().getFirst("Authorization");
                    Map<String, String> call = new java.util.HashMap<>();
                    call.put("tool", tool);
                    call.put("arguments", request.path("params").path("arguments").toString());
                    if (headerKey != null) call.put("headerKey", headerKey);
                    if (metaKey != null) call.put("metaKey", metaKey);
                    if (authorization != null) call.put("authorization", authorization);
                    calls.add(call);
                    ArrayNode content = result.putArray("content");
                    if ("create_ticket".equals(tool)) {
                        if (headerKey == null) writesWithoutKey.incrementAndGet();
                        else effectiveWrites.merge(headerKey, 1, (left, right) -> left);
                        if (applyThenFailNextWrite) {
                            applyThenFailNextWrite = false;
                            exchange.sendResponseHeaders(503, -1);
                            return;
                        }
                        content.addObject().put("type", "text").put("text", "{\"ticket\":\"T-1\"}");
                    } else if ("get_customer".equals(tool)) {
                        content.addObject().put("type", "text").put("text", "{\"name\":\"" + customerName + "\"}");
                    } else {
                        content.addObject().put("type", "text").put("text", "unknown tool");
                        result.put("isError", true);
                    }
                }
                default -> {
                    respond(exchange, JSON.createObjectNode().put("jsonrpc", "2.0").set("id", request.get("id")),
                            Map.of("code", -32601, "message", "Method not found"));
                    return;
                }
            }
            ObjectNode response = JSON.createObjectNode().put("jsonrpc", "2.0");
            response.set("id", request.get("id"));
            response.set("result", result);
            byte[] body = JSON.writeValueAsBytes(response);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private static void respond(HttpExchange exchange, ObjectNode response, Map<String, Object> error) throws IOException {
        response.set("error", JSON.valueToTree(error));
        byte[] body = JSON.writeValueAsBytes(response);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
    }

    /** All calls to one tool. */
    public List<Map<String, String>> callsTo(String tool) {
        List<Map<String, String>> matching = new ArrayList<>();
        calls.forEach(call -> { if (tool.equals(call.get("tool"))) matching.add(call); });
        return matching;
    }

    static String text(String value) {
        return new String(value.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8);
    }
}
