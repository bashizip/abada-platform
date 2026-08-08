package io.abada.agent;

import com.sun.net.httpserver.HttpServer;
import io.abada.worker.AgentWorkDescriptor;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentWorkerMainTest {
    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
    }

    @Test
    void decodesStructuredOutputAndSendsOnlySelectedInputs() throws Exception {
        var capturedBody = new StringBuilder();
        URI baseUrl = startGateway(capturedBody,
                "{\"answer\":\"accepted\",\"_confidence\":92}");
        var gateway = new AgentWorkerMain.OpenAiCompatibleGateway(config(baseUrl));
        AgentWorkDescriptor work = descriptor(80.0);

        Object result = gateway.execute(work, Map.of("caseId", "CASE-7", "secret", "do-not-send"));

        assertEquals("accepted", ((Map<?, ?>) result).get("answer"));
        assertTrue(capturedBody.toString().contains("CASE-7"));
        assertTrue(!capturedBody.toString().contains("do-not-send"));
    }

    @Test
    void rejectsOutputBelowTheDeclaredConfidenceThreshold() throws Exception {
        URI baseUrl = startGateway(new StringBuilder(),
                "{\"answer\":\"uncertain\",\"_confidence\":70}");
        var gateway = new AgentWorkerMain.OpenAiCompatibleGateway(config(baseUrl));

        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> gateway.execute(descriptor(80.0), Map.of("caseId", "CASE-8")));

        assertTrue(error.getMessage().contains("confidence"));
    }

    private URI startGateway(StringBuilder capturedBody, String assistantContent) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            capturedBody.append(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            String escaped = assistantContent.replace("\\", "\\\\").replace("\"", "\\\"");
            byte[] response = ("{\"choices\":[{\"message\":{\"content\":\""
                    + escaped + "\"}}]}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.start();
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
    }

    private AgentWorkerMain.Config config(URI llmBaseUrl) {
        return new AgentWorkerMain.Config(URI.create("http://engine.invalid"), "token", null,
                "", "", llmBaseUrl, "llm-key", "test-model", "test-worker",
                Duration.ofMillis(100), Duration.ofSeconds(10), 1, Set.of());
    }

    private AgentWorkDescriptor descriptor(double confidenceThreshold) {
        return new AgentWorkDescriptor("abada.agent/v1", "test-model", "Handle ${caseId}",
                Map.of("case", "${caseId}"), "result", Map.of("type", "object"), List.of(),
                confidenceThreshold, 0.0, 100, 5_000L, 2, 100L);
    }
}
