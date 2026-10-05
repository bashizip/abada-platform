package io.abada.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.abada.worker.AgentAttemptMetadata;
import io.abada.worker.AgentLimits;
import io.abada.worker.AgentStep;
import io.abada.worker.AgentWorkDescriptor;
import io.abada.worker.LockedExternalTask;
import io.abada.worker.ModelPrice;
import io.abada.worker.RequestOptions;
import io.abada.worker.ToolBinding;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The worker end to end over HTTP: the real runner, the OpenAI-compatible
 * gateway against a scripted LLM, the official MCP client against a stub CRM
 * server, and an engine that keeps the step journal. The CRM crashes after
 * applying the write; the next lease resumes from the journal, re-sends the
 * write with its key (it takes effect once) and pays for no model turn twice.
 */
class AgentToolLoopEndToEndTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private StubMcpServer crm;
    private HttpServer llm;
    private final AtomicInteger llmCalls = new AtomicInteger();
    private final List<String> script = List.of(
            toolCall("c1", "crm__get_customer", "{\"id\":7}"),
            toolCall("c2", "crm__create_ticket", "{\"subject\":\"refund for Ada\"}"),
            "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"{\\\"verdict\\\":\\\"refund\\\",\\\"ticket\\\":\\\"T-1\\\"}\"}}],"
                    + "\"usage\":{\"prompt_tokens\":120,\"completion_tokens\":30}}");

    @BeforeEach
    void start() throws Exception {
        crm = new StubMcpServer();
        llm = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        llm.createContext("/v1/chat/completions", exchange -> {
            try (exchange) {
                exchange.getRequestBody().readAllBytes();
                int index = llmCalls.getAndIncrement();
                byte[] body = script.get(Math.min(index, script.size() - 1)).getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
            }
        });
        llm.start();
    }

    @AfterEach
    void stop() {
        crm.close();
        llm.stop(0);
    }

    @Test
    void aCrashMidWriteResumesFromTheJournalAndTheWriteTakesEffectOnce() throws Exception {
        JournalingEngine engine = new JournalingEngine(work());
        crm.applyThenFailNextWrite = true;

        try (AgentWorkerMain.Runner first = runner(engine)) {      // the CRM fails after applying the write
            first.pollOnce();
        }
        assertTrue(engine.deferred, "a tool server failure during a write defers the attempt");
        assertEquals(2, llmCalls.get());
        assertEquals("STARTED", engine.steps.getLast().state());

        try (AgentWorkerMain.Runner second = runner(engine)) {     // a restarted worker picks the task up again
            second.pollOnce();
        }
        assertNotNull(engine.completed, "the task completed");
        assertEquals(Map.of("verdict", "refund", "ticket", "T-1"), engine.completed.get("triage_result"));
        assertEquals(1, crm.effectiveWrites.size(), "one write, under one key");
        assertEquals(List.of(1), List.copyOf(crm.effectiveWrites.values()));
        assertEquals(2, crm.callsTo("create_ticket").size(), "re-sent once, with the same key");
        assertEquals(crm.callsTo("create_ticket").get(0).get("headerKey"), crm.callsTo("create_ticket").get(1).get("headerKey"));
        assertEquals(3, llmCalls.get(), "no model turn paid for twice");
        assertEquals(List.of("crm/get_customer", "crm/create_ticket"), engine.metadata.tools().stream()
                .filter(tool -> tool.contains("/")).toList());
    }

    private AgentWorkerMain.Runner runner(JournalingEngine engine) {
        WorkerConfig config = new WorkerConfig(URI.create("http://engine.invalid"), "token", null, "", "",
                URI.create("http://llm.invalid/v1"), "key", URI.create("http://127.0.0.1:" + llm.getAddress().getPort() + "/v1"),
                "key", "model-a", "test-worker", Set.of(), Duration.ofMillis(50), Duration.ofSeconds(60), 1,
                Set.of("crm"), Set.of(), WorkerConfig.DEFAULT_MAX_TIMEOUT, WorkerConfig.StructuredOutput.JSON_OBJECT);
        ProviderEndpoint endpoint = new ProviderEndpoint("openai", "openai-compatible", config.openAiBaseUrl(), "key",
                List.of("*"), "model-a", true, ProviderEndpoint.Source.WORKER_ENVIRONMENT);
        return new AgentWorkerMain.Runner(engine, work -> new OpenAiCompatibleGateway(config, endpoint), config,
                SecretRedactor.patternsOnly(), new AgentLoop.Settings(65_536, Duration.ofSeconds(5)), null);
    }

    private AgentWorkDescriptor work() {
        List<ToolBinding> bindings = List.of(
                new ToolBinding("crm", "get_customer", "read", null, List.of(), crm.url().toString(), "streamable-http",
                        null, "r1", 1L, null),
                new ToolBinding("crm", "create_ticket", "write", "key", List.of(), crm.url().toString(),
                        "streamable-http", null, "r1", 1L,
                        AgentLoop.sha256(AgentLoop.canonical(StubMcpServer.TICKET_SCHEMA))));
        return new AgentWorkDescriptor("abada.agent/v1", "model-a", "Triage the refund for ${case}", Map.of(),
                "triage_result", Map.of("type", "object"), List.of("crm/get_customer", "crm/create_ticket"), null, 0.2,
                512, 30_000L, 3, 1_000L, List.of(), Map.of(), bindings, Map.<String, ModelPrice>of(),
                new AgentLimits(8, 50_000L, null));
    }

    private static String toolCall(String id, String name, String arguments) {
        try {
            return JSON.writeValueAsString(Map.of("choices", List.of(Map.of("message", Map.of("role", "assistant",
                            "tool_calls", List.of(Map.of("id", id, "type", "function",
                                    "function", Map.of("name", name, "arguments", arguments)))))),
                    "usage", Map.of("prompt_tokens", 100, "completion_tokens", 20)));
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    /** An engine that keeps the step journal: keys per started write, steps returned on the next lease. */
    static final class JournalingEngine implements AgentWorkerMain.Engine {
        final AgentWorkDescriptor work;
        final List<AgentStep> steps = new ArrayList<>();
        boolean available = true;
        boolean deferred;
        Map<String, Object> completed;
        AgentAttemptMetadata metadata;

        JournalingEngine(AgentWorkDescriptor work) {
            this.work = work;
        }

        @Override
        public synchronized List<LockedExternalTask> fetchAndLock(int maxTasks) {
            if (!available) return List.of();
            available = false;
            return List.of(new LockedExternalTask("task-1", "abada:agent", Map.of("case", "c-1"), "pi-1", "triage", 3,
                    null, null, "1", work, "proj", 1, List.copyOf(steps), List.of()));
        }

        @Override
        public synchronized AgentStep recordStep(LockedExternalTask task, int attempt, int sequence, String kind,
                String state, String toolRef, Object request, Object result, String errorType, String model,
                Integer promptTokens, Integer completionTokens) {
            AgentStep existing = steps.stream().filter(step -> step.sequence() == sequence).findFirst().orElse(null);
            String key = existing != null ? existing.idempotencyKey()
                    : "TOOL_CALL".equals(kind) && "STARTED".equals(state) && "crm/create_ticket".equals(toolRef)
                            ? "key-" + sequence : null;
            AgentStep step = new AgentStep(attempt, sequence, kind, state, toolRef,
                    toolRef == null ? null : toolRef.endsWith("create_ticket") ? "write" : "read", key, "d", null,
                    JSON.valueToTree(request), result == null ? null : JSON.valueToTree(result), errorType, model,
                    promptTokens, completionTokens, null);
            if (existing != null) steps.set(steps.indexOf(existing), step);
            else steps.add(step);
            return step;
        }

        @Override
        public synchronized void complete(LockedExternalTask task, Map<String, Object> variables,
                AgentAttemptMetadata agent, RequestOptions options) {
            completed = variables;
            metadata = agent;
        }

        @Override
        public synchronized void fail(LockedExternalTask task, String message, String details, int retries,
                Duration retryTimeout, AgentAttemptMetadata agent, boolean deferred, RequestOptions options) {
            this.deferred = deferred;
            available = true;
        }

        @Override
        public void extendLock(LockedExternalTask task, Duration lockDuration) {
        }
    }
}
