package io.abada.agent.mcp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.abada.agent.StubMcpServer;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The official SDK client against an MCP server over streamable HTTP. */
class SdkMcpToolClientTest {
    private StubMcpServer server;

    @BeforeEach
    void start() throws Exception {
        server = new StubMcpServer();
    }

    @AfterEach
    void stop() {
        server.close();
    }

    @Test
    void listsAndCallsToolsWithTheCredentialAndTheWriteKey() {
        try (SdkMcpToolClient client = new SdkMcpToolClient("crm", server.url(), "secret-token", Duration.ofSeconds(5))) {
            List<McpToolClient.ToolDescription> tools = client.listTools();
            assertEquals(List.of("get_customer", "create_ticket"), tools.stream().map(McpToolClient.ToolDescription::name).toList());
            assertEquals("object", tools.get(1).inputSchema().get("type"));

            McpToolClient.ToolOutcome read = client.call("get_customer", Map.of("id", 7), null);
            assertEquals("{\"name\":\"Ada\"}", read.text());
            assertFalse(read.isError());
            assertNull(server.callsTo("get_customer").getFirst().get("headerKey"));

            client.call("create_ticket", Map.of("subject", "refund"), "key-1");
            Map<String, String> write = server.callsTo("create_ticket").getFirst();
            assertEquals("key-1", write.get("headerKey"));
            assertEquals("key-1", write.get("metaKey"));
            assertEquals("Bearer secret-token", write.get("authorization"));
            assertEquals(Map.of("key-1", 1), server.effectiveWrites);
        }
    }

    @Test
    void aToolErrorIsAnOutcomeNotAnException() {
        try (SdkMcpToolClient client = new SdkMcpToolClient("crm", server.url(), null, Duration.ofSeconds(5))) {
            McpToolClient.ToolOutcome outcome = client.call("no_such_tool", Map.of(), null);
            assertTrue(outcome.isError());
        }
    }

    @Test
    void serverErrorsAndTimeoutsAreUnavailability() {
        try (SdkMcpToolClient client = new SdkMcpToolClient("crm", server.url(), null, Duration.ofMillis(800))) {
            server.failNextCalls = 1;
            assertThrows(McpToolClient.McpUnavailableException.class,
                    () -> client.call("create_ticket", Map.of("subject", "x"), "k"));
            server.delayMs = 3_000;
            assertThrows(McpToolClient.McpUnavailableException.class,
                    () -> client.call("get_customer", Map.of(), null));
        }
    }

    @Test
    void anUnreachableServerIsUnavailability() {
        server.close();
        assertThrows(McpToolClient.McpUnavailableException.class,
                () -> new SdkMcpToolClient("crm", server.url(), null, Duration.ofSeconds(2)));
    }
}
