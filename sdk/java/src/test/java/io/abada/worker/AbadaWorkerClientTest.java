package io.abada.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AbadaWorkerClientTest {
    HttpServer server;
    AtomicReference<HttpExchange> exchange = new AtomicReference<>();
    AtomicReference<String> requestBody = new AtomicReference<>();
    AbadaWorkerClient client;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/external-tasks", request -> {
            exchange.set(request);
            requestBody.set(new String(request.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "[]".getBytes(StandardCharsets.UTF_8);
            request.getResponseHeaders().add("Content-Type", "application/json");
            request.getResponseHeaders().add("X-Abada-Worker-Protocol-Version", "1");
            request.sendResponseHeaders(200, response.length);
            request.getResponseBody().write(response);
            request.close();
        });
        server.start();
        client = new AbadaWorkerClient(URI.create("http://localhost:" + server.getAddress().getPort() + "/api"),
                () -> "token");
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Test
    void sendsVersionedFetchAuthenticationIdempotencyAndTraceHeaders() {
        client.fetchAndLock("worker-1", List.of("payments"), Duration.ofSeconds(30), 4,
                new RequestOptions("request-1", "00-abc-def-01", "vendor=value"));
        assertEquals("/api/v1/external-tasks/fetch-and-lock", exchange.get().getRequestURI().getPath());
        assertEquals("Bearer token", exchange.get().getRequestHeaders().getFirst("Authorization"));
        assertEquals("request-1", exchange.get().getRequestHeaders().getFirst("Idempotency-Key"));
        assertEquals("00-abc-def-01", exchange.get().getRequestHeaders().getFirst("traceparent"));
        assertTrue(requestBody.get().contains("\"maxTasks\":4"));
        assertTrue(requestBody.get().contains("\"workerId\":\"worker-1\""));
    }

    @Test
    void sendsCanonicalCompletionBody() {
        client.complete("task 1", "worker-1", Map.of("approved", true), RequestOptions.defaults());
        assertTrue(exchange.get().getRequestURI().getRawPath().endsWith("/task%201/complete"));
        assertTrue(requestBody.get().contains("\"workerId\":\"worker-1\""));
        assertTrue(requestBody.get().contains("\"approved\":true"));
    }

    @Test
    void sendsAgentAttemptMetadataOnCompletionAndFailure() {
        AgentAttemptMetadata metadata = new AgentAttemptMetadata("gemini-3.6-flash", "google-gemini", 2,
                1_500L, List.of("crm.read"), "summary", "abc123", null, 92.0);
        client.complete("task-1", "worker-1", Map.of("summary", "done"), metadata, RequestOptions.defaults());
        assertTrue(requestBody.get().contains("\"agent\""));
        assertTrue(requestBody.get().contains("\"model\":\"gemini-3.6-flash\""));
        assertTrue(requestBody.get().contains("\"provider\":\"google-gemini\""));
        assertTrue(requestBody.get().contains("\"attempt\":2"));
        assertTrue(requestBody.get().contains("\"confidence\":92.0"));

        AgentAttemptMetadata failure = new AgentAttemptMetadata("gpt-5-mini", "openai-compatible", 1,
                null, List.of(), null, null, "RateLimitException", null);
        client.fail("task-2", "worker-1", "rate limited", "RateLimitException", 2, Duration.ofSeconds(2),
                failure, RequestOptions.defaults());
        assertTrue(requestBody.get().contains("\"agent\""));
        assertTrue(requestBody.get().contains("\"errorType\":\"RateLimitException\""));
        assertTrue(requestBody.get().contains("\"retries\":2"));
    }

    @Test
    void exposesTypedEngineErrors() {
        server.removeContext("/api/v1/external-tasks");
        server.createContext("/api/v1/external-tasks", request -> {
            byte[] response = "{\"code\":\"WORKER_LOCK_EXPIRED\",\"message\":\"expired\"}"
                    .getBytes(StandardCharsets.UTF_8);
            request.sendResponseHeaders(409, response.length);
            request.getResponseBody().write(response);
            request.close();
        });
        WorkerProtocolException error = assertThrows(WorkerProtocolException.class,
                () -> client.heartbeat("task", "worker", Duration.ofSeconds(10), RequestOptions.defaults()));
        assertEquals(409, error.status());
        assertEquals("WORKER_LOCK_EXPIRED", error.code());
    }

    @Test
    void decodesOptionalAgentWorkDescriptorWithoutChangingProtocolVersion() {
        server.removeContext("/api/v1/external-tasks");
        server.createContext("/api/v1/external-tasks", request -> {
            byte[] response = ("[{\"id\":\"task-1\",\"topicName\":\"abada:agent\",\"variables\":{},"
                    + "\"protocolVersion\":\"1\",\"agentWork\":{\"profileVersion\":\"abada.agent/v1\","
                    + "\"model\":\"model-a\",\"prompt\":\"work\",\"inputs\":{},"
                    + "\"resultVariable\":\"result\",\"outputSchema\":{},\"tools\":[],"
                    + "\"maxAttempts\":3}}]").getBytes(StandardCharsets.UTF_8);
            request.getResponseHeaders().add("X-Abada-Worker-Protocol-Version", "1");
            request.sendResponseHeaders(200, response.length);
            request.getResponseBody().write(response);
            request.close();
        });
        LockedExternalTask task = client.fetchAndLock("worker", List.of("abada:agent"),
                Duration.ofSeconds(30), 1, RequestOptions.defaults()).getFirst();
        assertEquals("abada.agent/v1", task.agentWork().profileVersion());
        assertEquals("result", task.agentWork().resultVariable());
    }

    @Test
    void decodesFallbackModelsAndIgnoresFieldsANewerEngineAdds() {
        server.removeContext("/api/v1/external-tasks");
        server.createContext("/api/v1/external-tasks", request -> {
            byte[] response = ("[{\"id\":\"task-1\",\"topicName\":\"abada:agent\",\"variables\":{},"
                    + "\"protocolVersion\":\"1\",\"someFutureField\":true,"
                    + "\"agentWork\":{\"profileVersion\":\"abada.agent/v1\",\"model\":\"model-a\","
                    + "\"fallbackModels\":[\"model-b\"],\"anotherFutureField\":1,\"prompt\":\"work\","
                    + "\"inputs\":{},\"resultVariable\":\"result\",\"outputSchema\":{},\"tools\":[]}}]")
                    .getBytes(StandardCharsets.UTF_8);
            request.getResponseHeaders().add("X-Abada-Worker-Protocol-Version", "1");
            request.sendResponseHeaders(200, response.length);
            request.getResponseBody().write(response);
            request.close();
        });
        LockedExternalTask task = client.fetchAndLock("worker", List.of("abada:agent"),
                Duration.ofSeconds(30), 1, RequestOptions.defaults()).getFirst();
        assertEquals(List.of("model-b"), task.agentWork().fallbackModels());
    }

    @Test
    void decodesFrozenToolBindingsAndTightenedPolicies() {
        server.removeContext("/api/v1/external-tasks");
        server.createContext("/api/v1/external-tasks", request -> {
            byte[] response = ("[{\"id\":\"task-1\",\"topicName\":\"abada:agent\",\"variables\":{},"
                    + "\"protocolVersion\":\"1\",\"agentWork\":{\"profileVersion\":\"abada.agent/v1\","
                    + "\"model\":\"model-a\",\"prompt\":\"work\",\"inputs\":{},\"resultVariable\":\"result\","
                    + "\"outputSchema\":{},\"tools\":[\"crm/get_customer\",\"crm/refund\"],"
                    + "\"toolPolicies\":{\"crm/refund\":\"approval_required\"},"
                    + "\"toolBindings\":[{\"server\":\"crm\",\"tool\":\"refund\",\"policy\":\"approval_required\","
                    + "\"idempotency\":\"key\",\"approvers\":[\"finance\"],\"url\":\"https://crm/mcp\","
                    + "\"transport\":\"streamable-http\",\"credential\":\"crm-token\",\"resourceId\":\"r1\","
                    + "\"resourceRevision\":2,\"futureField\":1}],"
                    + "\"prices\":{\"model-a\":{\"inputPerMillion\":1.5,\"outputPerMillion\":6}},"
                    + "\"delegates\":[{\"process\":\"refund_payout\",\"tool\":\"delegate:refund_payout\","
                    + "\"inputSchema\":{\"type\":\"object\"},\"approval\":\"required\","
                    + "\"outputs\":[\"payout_id\"]}]}}]")
                    .getBytes(StandardCharsets.UTF_8);
            request.getResponseHeaders().add("X-Abada-Worker-Protocol-Version", "1");
            request.sendResponseHeaders(200, response.length);
            request.getResponseBody().write(response);
            request.close();
        });
        AgentWorkDescriptor work = client.fetchAndLock("worker", List.of("abada:agent"),
                Duration.ofSeconds(30), 1, RequestOptions.defaults()).getFirst().agentWork();
        assertEquals("approval_required", work.toolPolicies().get("crm/refund"));
        ToolBinding binding = work.toolBindings().getFirst();
        assertEquals("crm/refund", binding.ref());
        assertEquals("key", binding.idempotency());
        assertEquals(List.of("finance"), binding.approvers());
        assertEquals("crm-token", binding.credential());
        assertEquals(2L, binding.resourceRevision());
        assertEquals(0, new java.math.BigDecimal("1.5").compareTo(work.prices().get("model-a").inputPerMillion()));
        AgentDelegate delegate = work.delegates().getFirst();
        assertEquals("delegate:refund_payout", delegate.tool());
        assertTrue(delegate.approvalRequired());
        assertEquals(List.of("payout_id"), delegate.outputs());
    }

    @Test
    void fetchesAToolCredentialForTheLockedTaskAndNeverPrintsTheSecret() {
        AtomicReference<String> uri = new AtomicReference<>();
        server.removeContext("/api/v1/external-tasks");
        server.createContext("/api/v1/external-tasks", request -> {
            uri.set(request.getRequestURI().toString());
            byte[] response = "{\"server\":\"crm\",\"credential\":\"crm-token\",\"secret\":\"s3cr3t\",\"x\":1}"
                    .getBytes(StandardCharsets.UTF_8);
            request.getResponseHeaders().add("Content-Type", "application/json");
            request.sendResponseHeaders(200, response.length);
            request.getResponseBody().write(response);
            request.close();
        });

        ToolCredential credential = client.toolCredential("task 1", "worker-1", "crm");

        assertEquals("/api/v1/external-tasks/task%201/tool-credentials/crm?workerId=worker-1", uri.get());
        assertEquals("s3cr3t", credential.secret());
        assertTrue(!credential.toString().contains("s3cr3t"));
    }

    @Test
    void decodesTheJournalToResumeFrom() {
        server.removeContext("/api/v1/external-tasks");
        server.createContext("/api/v1/external-tasks", request -> {
            byte[] response = ("[{\"id\":\"task-1\",\"topicName\":\"abada:agent\",\"variables\":{},"
                    + "\"protocolVersion\":\"1\",\"attempt\":2,"
                    + "\"steps\":[{\"attempt\":2,\"sequence\":1,\"kind\":\"TOOL_CALL\",\"state\":\"STARTED\","
                    + "\"toolRef\":\"crm/create_ticket\",\"policy\":\"write\",\"idempotencyKey\":\"k1\","
                    + "\"requestDigest\":\"d1\",\"request\":{\"subject\":\"x\"}}],"
                    + "\"priorWrites\":[{\"attempt\":1,\"sequence\":3,\"kind\":\"TOOL_CALL\",\"state\":\"COMPLETED\","
                    + "\"toolRef\":\"crm/notify\",\"requestDigest\":\"d0\",\"result\":{\"sent\":true}}]}]")
                    .getBytes(StandardCharsets.UTF_8);
            request.getResponseHeaders().add("X-Abada-Worker-Protocol-Version", "1");
            request.sendResponseHeaders(200, response.length);
            request.getResponseBody().write(response);
            request.close();
        });
        LockedExternalTask task = client.fetchAndLock("worker", List.of("abada:agent"),
                Duration.ofSeconds(30), 1, RequestOptions.defaults()).getFirst();
        assertEquals(2, task.attempt());
        assertEquals("k1", task.steps().getFirst().idempotencyKey());
        assertEquals("x", task.steps().getFirst().request().path("subject").asText());
        assertTrue(task.priorWrites().getFirst().result().path("sent").asBoolean());
    }

    @Test
    void recordsAStepAndExposesWhyTheEngineRefusedOne() {
        AtomicReference<String> body = new AtomicReference<>();
        AtomicReference<Integer> calls = new AtomicReference<>(0);
        server.removeContext("/api/v1/external-tasks");
        server.createContext("/api/v1/external-tasks", request -> {
            body.set(new String(request.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            calls.set(calls.get() + 1);
            boolean refuse = calls.get() > 1;
            byte[] response = (refuse
                    ? "{\"code\":\"AGENT_STEP_REJECTED\",\"message\":\"needs approval\","
                            + "\"details\":{\"reason\":\"APPROVAL_REQUIRED\"}}"
                    : "{\"attempt\":1,\"sequence\":1,\"kind\":\"TOOL_CALL\",\"state\":\"STARTED\","
                            + "\"toolRef\":\"crm/create_ticket\",\"policy\":\"write\",\"idempotencyKey\":\"k9\","
                            + "\"requestDigest\":\"d\",\"futureField\":1}").getBytes(StandardCharsets.UTF_8);
            request.getResponseHeaders().add("Content-Type", "application/json");
            request.sendResponseHeaders(refuse ? 409 : 200, response.length);
            request.getResponseBody().write(response);
            request.close();
        });

        AgentStep step = client.recordStep("task-1", "worker-1", 1, 1, "TOOL_CALL", "STARTED", "crm/create_ticket",
                Map.of("subject", "x"), null, null, "model-a", "p1", null, null);
        assertEquals("k9", step.idempotencyKey());
        assertTrue(body.get().contains("\"sequence\":1"), body.get());
        assertTrue(!body.get().contains("\"result\""), body.get());

        WorkerProtocolException refused = assertThrows(WorkerProtocolException.class, () -> client.recordStep(
                "task-1", "worker-1", 1, 2, "TOOL_CALL", "STARTED", "crm/refund", Map.of(), null, null, null,
                null, null, null));
        assertEquals(409, refused.status());
        assertEquals("APPROVAL_REQUIRED", refused.reason());
    }

    @Test
    void reportsADeferralSoTheEngineKeepsTheAttemptBudget() {
        client.fail("task-3", "worker-1", "rate limited", "AgentQuotaExceededException", 3,
                Duration.ofSeconds(30), null, true, RequestOptions.defaults());
        assertTrue(requestBody.get().contains("\"deferred\":true"), requestBody.get());
        assertTrue(requestBody.get().contains("\"retries\":3"));

        client.fail("task-4", "worker-1", "boom", "Boom", 1, Duration.ofSeconds(2), RequestOptions.defaults());
        assertTrue(!requestBody.get().contains("deferred"), "an ordinary failure omits the flag");
    }

    @Test
    void fetchesAiCredentialsAndNeverPrintsTheKey() {
        AtomicReference<String> authorization = new AtomicReference<>();
        server.createContext("/api/v1/workers/me/ai-credentials", request -> {
            authorization.set(request.getRequestHeaders().getFirst("Authorization"));
            byte[] response = ("{\"revision\":\"r1\",\"futureField\":true,\"providers\":[{\"id\":\"gemini\","
                    + "\"type\":\"gemini\",\"baseUrl\":\"https://g.example/v1beta/openai\","
                    + "\"apiKey\":\"secret-key\",\"modelPatterns\":[\"gemini\",\"google/\"],"
                    + "\"defaultModel\":\"gemini-3.6-flash\",\"timeoutMs\":30000,\"fallback\":true}]}")
                    .getBytes(StandardCharsets.UTF_8);
            request.getResponseHeaders().add("Content-Type", "application/json");
            request.sendResponseHeaders(200, response.length);
            request.getResponseBody().write(response);
            request.close();
        });

        AiCredentials credentials = client.aiCredentials();

        assertEquals("Bearer token", authorization.get());
        assertEquals("r1", credentials.revision());
        assertEquals("secret-key", credentials.providers().get(0).apiKey());
        assertEquals(List.of("gemini", "google/"), credentials.providers().get(0).modelPatterns());
        assertTrue(credentials.providers().get(0).fallback());
        assertTrue(!credentials.toString().contains("secret-key"));
    }

    @Test
    void anOlderEngineWithoutTheCredentialsEndpointAnswers404() {
        server.createContext("/api/v1/workers/me/ai-credentials", request -> {
            request.sendResponseHeaders(404, -1);
            request.close();
        });

        WorkerProtocolException missing = assertThrows(WorkerProtocolException.class, client::aiCredentials);

        assertEquals(404, missing.status());
    }
}
