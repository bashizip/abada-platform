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
}
