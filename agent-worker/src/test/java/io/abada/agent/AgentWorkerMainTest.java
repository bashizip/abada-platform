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
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
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

    @Test
    void factoryRoutesGeminiModelsToGeminiGateway() {
        var factory = new AgentWorkerMain.AgentGatewayFactory(config(URI.create("http://llm.invalid/v1")));

        assertInstanceOf(AgentWorkerMain.GoogleGeminiGateway.class,
                factory.gatewayFor(descriptor(0.0, "gemini-2.0-flash")));
        assertInstanceOf(AgentWorkerMain.GoogleGeminiGateway.class,
                factory.gatewayFor(descriptor(0.0, "google/gemini-2.5-pro")));
        assertInstanceOf(AgentWorkerMain.OpenAiCompatibleGateway.class,
                factory.gatewayFor(descriptor(0.0, "gpt-5-mini")));
        assertInstanceOf(AgentWorkerMain.OpenAiCompatibleGateway.class,
                factory.gatewayFor(descriptor(0.0, null)));
    }

    @Test
    void geminiGatewayPostsGenerateContentAndDecodesResponse() throws Exception {
        var capturedBody = new StringBuilder();
        URI baseUrl = startGeminiGateway(capturedBody,
                "{\"answer\":\"accepted\",\"_confidence\":92}");
        var gateway = new AgentWorkerMain.GoogleGeminiGateway(config(baseUrl));
        // The google/ prefix must be stripped from the :generateContent request path.
        AgentWorkDescriptor work = descriptor(80.0, "google/gemini-2.0-flash");

        Object result = gateway.execute(work, Map.of("caseId", "CASE-9"));

        assertEquals("accepted", ((Map<?, ?>) result).get("answer"));
        assertTrue(capturedBody.toString().contains("\"systemInstruction\""));
        assertTrue(capturedBody.toString().contains("\"contents\""));
        assertTrue(capturedBody.toString().contains("CASE-9"));
    }

    private URI startGateway(StringBuilder capturedBody, String assistantContent) throws Exception {
        return startServer("/v1/chat/completions",
                "{\"choices\":[{\"message\":{\"content\":\"%s\"}}]}", capturedBody, assistantContent);
    }

    private URI startGeminiGateway(StringBuilder capturedBody, String assistantContent) throws Exception {
        return startServer("/v1/models/gemini-2.0-flash:generateContent",
                "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"%s\"}]}}]}", capturedBody, assistantContent);
    }

    private URI startServer(String contextPath, String responseTemplate, StringBuilder capturedBody,
            String assistantContent) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(contextPath, exchange -> {
            capturedBody.append(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            String escaped = assistantContent.replace("\\", "\\\\").replace("\"", "\\\"");
            byte[] response = responseTemplate.formatted(escaped).getBytes(StandardCharsets.UTF_8);
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
        return descriptor(confidenceThreshold, "test-model");
    }

    private AgentWorkDescriptor descriptor(double confidenceThreshold, String model) {
        return new AgentWorkDescriptor("abada.agent/v1", model, "Handle ${caseId}",
                Map.of("case", "${caseId}"), "result", Map.of("type", "object"), List.of(),
                confidenceThreshold, 0.0, 100, 5_000L, 2, 100L);
    }
}
