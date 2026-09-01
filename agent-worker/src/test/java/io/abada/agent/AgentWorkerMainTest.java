package io.abada.agent;

import com.sun.net.httpserver.HttpServer;
import io.abada.worker.AgentWorkDescriptor;
import io.abada.worker.LockedExternalTask;
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
        var gateway = new OpenAiCompatibleGateway(config(baseUrl));
        AgentWorkDescriptor work = descriptor(80.0);

        AgentGateway.AgentResult result = gateway.execute(work,
                Map.of("caseId", "CASE-7", "secret", "do-not-send"));

        assertEquals("accepted", ((Map<?, ?>) result.value()).get("answer"));
        assertEquals(92.0, result.confidence());
        assertTrue(capturedBody.toString().contains("CASE-7"));
        assertTrue(!capturedBody.toString().contains("do-not-send"));
    }

    @Test
    void rejectsOutputBelowTheDeclaredConfidenceThreshold() throws Exception {
        URI baseUrl = startGateway(new StringBuilder(),
                "{\"answer\":\"uncertain\",\"_confidence\":70}");
        var gateway = new OpenAiCompatibleGateway(config(baseUrl));

        AgentGateway.ConfidenceBelowThresholdException error =
                assertThrows(AgentGateway.ConfidenceBelowThresholdException.class,
                        () -> gateway.execute(descriptor(80.0), Map.of("caseId", "CASE-8")));

        assertTrue(error.getMessage().contains("confidence"));
        assertEquals(70.0, error.confidence());
    }

    @Test
    void factoryRoutesGeminiModelsToGeminiGateway() {
        var factory = new AgentGatewayFactory(config(URI.create("http://llm.invalid/v1")));

        assertInstanceOf(GoogleGeminiGateway.class,
                factory.gatewayFor(descriptor(0.0, "gemini-3.6-flash")));
        assertInstanceOf(GoogleGeminiGateway.class,
                factory.gatewayFor(descriptor(0.0, "google/gemini-3.6-flash")));
        assertInstanceOf(OpenAiCompatibleGateway.class,
                factory.gatewayFor(descriptor(0.0, "gpt-5-mini")));
        assertInstanceOf(OpenAiCompatibleGateway.class,
                factory.gatewayFor(descriptor(0.0, null)));
    }

    @Test
    void openAiGatewayUsesTheConfiguredAlternateEndpoint() throws Exception {
        var capturedBody = new StringBuilder();
        URI openAiUrl = startGateway(capturedBody, "{\"answer\":\"ok\",\"_confidence\":95}");
        var config = new WorkerConfig(URI.create("http://engine.invalid"), "token", null,
                "", "", URI.create("http://llm.invalid/v1"), "gemini-key",
                openAiUrl, "openai-key", "test-model", "test-worker",
                Duration.ofMillis(100), Duration.ofSeconds(10), 1, Set.of());

        AgentGateway.AgentResult result = new OpenAiCompatibleGateway(config)
                .execute(descriptor(80.0), Map.of("caseId", "CASE-9"));

        assertEquals("ok", ((Map<?, ?>) result.value()).get("answer"));
        assertEquals(95.0, result.confidence());
        assertTrue(capturedBody.length() > 0);
    }

    @Test
    void resolveEndpointsFallsBackEachWay() {
        var onlyGemini = Map.of("ABADA_AGENT_LLM_BASE_URL", "https://gemini.example/v1beta/",
                "ABADA_AGENT_LLM_API_KEY", "g-key");
        WorkerConfig.Endpoints gemini = WorkerConfig.resolveEndpoints(onlyGemini);
        assertEquals("https://gemini.example/v1beta", gemini.llmUrl());
        assertEquals("https://gemini.example/v1beta", gemini.openAiUrl());
        assertEquals("g-key", gemini.apiKey());
        assertEquals("g-key", gemini.openAiKey());

        var onlyOpenAi = Map.of("ABADA_AGENT_OPENAI_BASE_URL", "https://llm.example/v1/",
                "ABADA_AGENT_OPENAI_API_KEY", "o-key");
        WorkerConfig.Endpoints openAi = WorkerConfig.resolveEndpoints(onlyOpenAi);
        assertEquals("https://llm.example/v1", openAi.llmUrl());
        assertEquals("https://llm.example/v1", openAi.openAiUrl());
        assertEquals("o-key", openAi.apiKey());
        assertEquals("o-key", openAi.openAiKey());
    }

    @Test
    void resolveEndpointsRequiresAtLeastOneEndpoint() {
        assertThrows(IllegalArgumentException.class,
                () -> WorkerConfig.resolveEndpoints(Map.of()));
    }

    @Test
    void localAcknowledgementTopicsAreTrimmedAndDeduplicated() {
        Set<String> topics = WorkerConfig.parseLocalAckTopics(Map.of(
                "ABADA_AGENT_LOCAL_ACK_TOPICS",
                " demo.crm.upsert, demo.nurture.enqueue, demo.crm.upsert, "));

        assertEquals(Set.of("demo.crm.upsert", "demo.nurture.enqueue"), topics);
    }

    @Test
    void localAcknowledgementTopicsCannotReplaceTheAgentHandler() {
        assertThrows(IllegalArgumentException.class,
                () -> WorkerConfig.parseLocalAckTopics(Map.of(
                        "ABADA_AGENT_LOCAL_ACK_TOPICS", "demo.crm.upsert,abada:agent")));
    }

    @Test
    void localAcknowledgementIsExplicitlyADevelopmentAdapter() {
        var task = new LockedExternalTask("task-1", "demo.crm.upsert", Map.of(), "instance-7",
                "sync-crm", 3, null, null, "1", null, "project-1");

        Map<?, ?> ack = (Map<?, ?>) AgentWorkerMain.localAcknowledgement(task).get("systemAck");

        assertEquals("Local demo adapter", ack.get("adapter"));
        assertEquals("demo.crm.upsert", ack.get("topic"));
        assertEquals("instance-7", ack.get("processInstanceId"));
        assertEquals("ACKNOWLEDGED", ack.get("status"));
    }

    @Test
    void geminiGatewayUsesOpenAiCompatibleEndpoint() throws Exception {
        var capturedBody = new StringBuilder();
        URI baseUrl = startServer("/v1/openai/chat/completions",
                "{\"choices\":[{\"message\":{\"content\":\"%s\"}}]}", capturedBody,
                "{\"answer\":\"high\",\"_confidence\":95}");
        var gateway = new GoogleGeminiGateway(config(baseUrl));

        AgentGateway.AgentResult result = gateway.execute(descriptor(0.0, "gemini-3.6-flash"),
                Map.of("caseId", "CASE-9"));

        assertEquals("high", ((Map<?, ?>) result.value()).get("answer"));
        assertEquals(95.0, result.confidence());
        assertTrue(capturedBody.toString().contains("gemini-3.6-flash"));
        assertTrue(capturedBody.toString().contains("\"system\""));
    }

    @Test
    void gatewaysReportStableProviderFamiliesAndPromptHashes() {
        var config = config(URI.create("http://llm.invalid/v1"));
        assertEquals("openai-compatible",
                new OpenAiCompatibleGateway(config).provider());
        assertEquals("google-gemini",
                new GoogleGeminiGateway(config).provider());

        String hash = AgentWorkerMain.promptHash("Summarize case ${caseId}.");
        assertEquals(16, hash.length());
        assertEquals(hash, AgentWorkerMain.promptHash("Summarize case ${caseId}."));
        assertTrue(!hash.contains("Summarize"));
    }

    private URI startGateway(StringBuilder capturedBody, String assistantContent) throws Exception {
        return startServer("/v1/chat/completions",
                "{\"choices\":[{\"message\":{\"content\":\"%s\"}}]}", capturedBody, assistantContent);
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

    private WorkerConfig config(URI llmBaseUrl) {
        return new WorkerConfig(URI.create("http://engine.invalid"), "token", null,
                "", "", llmBaseUrl, "llm-key", llmBaseUrl, "llm-key", "test-model", "test-worker",
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
