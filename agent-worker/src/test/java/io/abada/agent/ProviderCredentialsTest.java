package io.abada.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import io.abada.worker.AgentWorkDescriptor;
import io.abada.worker.AiCredentials;
import io.abada.worker.WorkerProtocolException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class ProviderCredentialsTest {
    private final AtomicLong clock = new AtomicLong();
    private HttpServer server;

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    @Test
    void engineProvidersWinOverTheWorkerEnvironment() {
        var credentials = credentials(() -> credentials("r1", provider("gemini", "gemini", "studio-key",
                List.of("gemini", "google/"), true)), environment());

        ProviderEndpoint gemini = credentials.resolve("gemini-3.6-flash").orElseThrow();

        assertEquals("studio-key", gemini.apiKey());
        assertEquals(ProviderEndpoint.Source.ENGINE, gemini.source());
        assertEquals("worker-env-openai", credentials.resolve("gpt-5-mini").orElseThrow().id(),
                "a model the engine does not serve falls back to the worker environment");
    }

    @Test
    void anOlderEngineWithoutTheEndpointUsesTheWorkerEnvironment() {
        var credentials = credentials(() -> {
            throw new WorkerProtocolException(404, "HTTP_ERROR", "Not Found");
        }, environment());

        assertEquals("env-gemini-key", credentials.resolve("gemini-3.6-flash").orElseThrow().apiKey());
    }

    @Test
    void cachesForTheTtlAndRefetchesAfterIt() {
        AtomicInteger fetches = new AtomicInteger();
        var credentials = credentials(() -> {
            fetches.incrementAndGet();
            return credentials("r1", provider("anthropic", "anthropic", "k", List.of("claude"), true));
        }, List.of());

        credentials.resolve("claude-sonnet-5");
        credentials.resolve("claude-sonnet-5");
        clock.addAndGet(59_000);
        credentials.resolve("claude-sonnet-5");
        assertEquals(1, fetches.get());

        clock.addAndGet(1_000);
        credentials.resolve("claude-sonnet-5");
        assertEquals(2, fetches.get());
    }

    @Test
    void aTransientEngineFailureKeepsTheLastKnownProviders() {
        AtomicInteger calls = new AtomicInteger();
        var credentials = credentials(() -> {
            if (calls.incrementAndGet() > 1) throw new WorkerProtocolException(0, "NETWORK_ERROR", "refused");
            return credentials("r1", provider("anthropic", "anthropic", "k", List.of("claude"), true));
        }, List.of());

        credentials.resolve("claude-sonnet-5");
        clock.addAndGet(120_000);

        assertEquals("anthropic", credentials.resolve("claude-sonnet-5").orElseThrow().id());
    }

    @Test
    void anUnservedModelFailsWithAMessageThatSaysWhereToAddAProvider() {
        var config = config();
        var factory = new AgentGatewayFactory(config, credentials(() -> credentials("r1"), List.of()));

        var error = assertThrows(AgentGateway.AgentConfigurationException.class,
                () -> factory.gatewayFor(work("claude-sonnet-5")).execute(work("claude-sonnet-5"), Map.of()));

        assertTrue(error.getMessage().contains("claude-sonnet-5"));
        assertTrue(error.getMessage().contains("Studio Settings > AI Providers"));
        assertEquals("unconfigured", factory.gatewayFor(work("claude-sonnet-5")).provider());
    }

    @Test
    void aKeyRotatedInStudioIsPickedUpAfterTheProviderRejectsTheOldOne() throws Exception {
        List<String> seenKeys = new ArrayList<>();
        AtomicReference<String> seenModel = new AtomicReference<>();
        URI base = startProvider(seenKeys, seenModel);
        AtomicReference<String> key = new AtomicReference<>("old-key");
        AtomicInteger fetches = new AtomicInteger();
        var credentials = credentials(() -> {
            fetches.incrementAndGet();
            return credentials("rev-" + key.get(), provider("anthropic", "anthropic", key.get(),
                    List.of("claude", "anthropic/"), true, base.toString()));
        }, List.of());
        var factory = new AgentGatewayFactory(config(), credentials);
        AgentGateway gateway = factory.gatewayFor(work("anthropic/claude-sonnet-5"));

        key.set("new-key");
        AgentGateway.AgentResult result = gateway.execute(work("anthropic/claude-sonnet-5"), Map.of());

        assertEquals(List.of("Bearer old-key", "Bearer new-key"), seenKeys);
        assertEquals("claude-sonnet-5", seenModel.get(), "the provider namespace is stripped");
        assertEquals("ok", ((Map<?, ?>) result.value()).get("answer"));
        assertEquals("anthropic", gateway.provider());
        assertEquals(2, fetches.get());
    }

    @Test
    void anUnchangedKeyIsNotRetried() throws Exception {
        List<String> seenKeys = new ArrayList<>();
        URI base = startProvider(seenKeys, new AtomicReference<>());
        var credentials = credentials(() -> credentials("same", provider("openai", "openai", "old-key",
                List.of("gpt-"), true, base.toString())), List.of());
        AgentGateway gateway = new AgentGatewayFactory(config(), credentials).gatewayFor(work("gpt-5-mini"));

        assertThrows(AgentGateway.AgentAuthenticationException.class,
                () -> gateway.execute(work("gpt-5-mini"), Map.of()));
        assertEquals(1, seenKeys.size());
    }

    @Test
    void geminiRejectingAKeyWithHttp400CountsAsAnAuthenticationFailure() {
        assertTrue(AbstractAgentGateway.rejectsKey(400,
                "[{ \"error\": { \"code\": 400, \"message\": \"Please pass a valid API key\" } }]"));
        assertTrue(AbstractAgentGateway.rejectsKey(400, "INVALID_ARGUMENT - API key not valid. API_KEY_INVALID"));
        assertFalse(AbstractAgentGateway.rejectsKey(400, "Invalid JSON payload received"));
        assertFalse(AbstractAgentGateway.rejectsKey(500, "invalid api key"));
    }

    @Test
    void endpointsNeverPrintTheirKey() {
        var endpoint = provider("gemini", "gemini", "super-secret", List.of("gemini"), true);
        assertFalse(endpoint.toString().contains("super-secret"));
        var engineSide = credentials(() -> credentials("r", endpoint), List.of());
        assertFalse(engineSide.resolve("gemini-x").orElseThrow().toString().contains("super-secret"));
    }

    private URI startProvider(List<String> seenKeys, AtomicReference<String> seenModel) throws Exception {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            String authorization = exchange.getRequestHeaders().getFirst("Authorization");
            seenKeys.add(authorization);
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            var matcher = java.util.regex.Pattern.compile("\"model\":\"([^\"]+)\"").matcher(body);
            if (matcher.find()) seenModel.set(matcher.group(1));
            boolean valid = "Bearer new-key".equals(authorization);
            byte[] response = (valid
                    ? "{\"choices\":[{\"message\":{\"content\":\"{\\\"answer\\\":\\\"ok\\\"}\"}}]}"
                    : "{\"error\":{\"message\":\"invalid x-api-key\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(valid ? 200 : 401, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
    }

    private ProviderCredentials credentials(ProviderCredentials.EngineSource source, List<ProviderEndpoint> env) {
        return new ProviderCredentials(source, env, Duration.ofSeconds(60), clock::get);
    }

    private static AiCredentials credentials(String revision, AiCredentials.Provider... providers) {
        return new AiCredentials(revision, List.of(providers));
    }

    private static AiCredentials credentials(String revision, ProviderEndpoint endpoint) {
        return new AiCredentials(revision, List.of(new AiCredentials.Provider(endpoint.id(), endpoint.type(),
                endpoint.baseUrl().toString(), endpoint.apiKey(), endpoint.modelPatterns(), endpoint.defaultModel(),
                30_000L, endpoint.fallback())));
    }

    private static ProviderEndpoint provider(String id, String type, String key, List<String> patterns,
            boolean fallback) {
        return new ProviderEndpoint(id, type, URI.create("https://" + id + ".example/v1"), key, patterns, null,
                fallback, ProviderEndpoint.Source.ENGINE);
    }

    private static AiCredentials.Provider provider(String id, String type, String key, List<String> patterns,
            boolean fallback, String baseUrl) {
        return new AiCredentials.Provider(id, type, baseUrl, key, patterns, null, 30_000L, fallback);
    }

    private static List<ProviderEndpoint> environment() {
        return ProviderCredentials.fromEnvironment(new WorkerConfig(URI.create("http://engine.invalid"), "", null,
                "", "", URI.create("https://gemini.example/v1beta"), "env-gemini-key",
                URI.create("https://llm.example/v1"), "env-openai-key", "gemini-3.6-flash", "w",
                Duration.ofSeconds(1), Duration.ofSeconds(30), 1, Set.of()));
    }

    private static WorkerConfig config() {
        return new WorkerConfig(URI.create("http://engine.invalid"), "", null, "", "", null, "", null, "",
                "gemini-3.6-flash", "w", Duration.ofSeconds(1), Duration.ofSeconds(30), 1, Set.of());
    }

    private static AgentWorkDescriptor work(String model) {
        return new AgentWorkDescriptor("abada.agent/v1", model, "Answer", Map.of(), "result",
                Map.of("type", "object"), List.of(), 0.0, 0.0, 100, 5_000L, 1, 100L);
    }
}
