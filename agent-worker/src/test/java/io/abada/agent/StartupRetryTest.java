package io.abada.agent;

import com.sun.net.httpserver.HttpServer;
import io.abada.worker.AbadaWorkerClient;
import io.abada.worker.WorkerProtocolException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StartupRetryTest {
    private final AtomicLong clock = new AtomicLong();
    private final List<Long> sleeps = new ArrayList<>();
    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
    }

    @Test
    void retriesTransientFailuresThenSucceeds() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        List<RuntimeException> failures = List.of(
                new WorkerProtocolException(0, "NETWORK_ERROR", null),
                new TokenRequestException("OIDC token endpoint unreachable", 0, true, null),
                new WorkerProtocolException(503, "HTTP_ERROR", "Service Unavailable"));

        retry(Duration.ofMinutes(5)).run("register_capabilities", () -> {
            int call = calls.getAndIncrement();
            if (call < failures.size()) throw failures.get(call);
        });

        assertEquals(4, calls.get());
        assertEquals(3, sleeps.size());
        assertTrue(sleeps.get(0) >= 500 && sleeps.get(0) <= 1_000, "first delay " + sleeps.get(0));
        assertTrue(sleeps.get(1) >= 1_000 && sleeps.get(1) <= 2_000, "second delay " + sleeps.get(1));
        assertTrue(sleeps.get(2) >= 2_000 && sleeps.get(2) <= 4_000, "third delay " + sleeps.get(2));
    }

    @Test
    void givesUpWithTheLastFailureOnceTheBudgetIsSpent() {
        AtomicInteger calls = new AtomicInteger();
        WorkerProtocolException refused = new WorkerProtocolException(0, "NETWORK_ERROR", "Connection refused");

        WorkerProtocolException thrown = assertThrows(WorkerProtocolException.class,
                () -> retry(Duration.ofSeconds(60)).run("register_capabilities", () -> {
                    calls.incrementAndGet();
                    throw refused;
                }));

        assertSame(refused, thrown);
        assertEquals(60_000, sleeps.stream().mapToLong(Long::longValue).sum(),
                "sleeps fill the budget exactly, the last one clipped to what remains");
        assertTrue(sleeps.stream().allMatch(delay -> delay <= StartupRetry.MAX_DELAY.toMillis()));
        assertEquals(sleeps.size() + 1, calls.get());
    }

    @Test
    void zeroBudgetFailsOnTheFirstTransientFailure() {
        AtomicInteger calls = new AtomicInteger();

        assertThrows(WorkerProtocolException.class, () -> retry(Duration.ZERO).run("register_capabilities", () -> {
            calls.incrementAndGet();
            throw new WorkerProtocolException(503, "HTTP_ERROR", "Service Unavailable");
        }));

        assertEquals(1, calls.get());
        assertTrue(sleeps.isEmpty());
    }

    @Test
    void doesNotRetryRejectedCredentialsOrInvalidCapabilities() {
        List<RuntimeException> permanent = List.of(
                new WorkerProtocolException(401, "UNAUTHORIZED", "Unauthorized"),
                new WorkerProtocolException(403, "FORBIDDEN", "Forbidden"),
                new WorkerProtocolException(400, "INVALID_CAPABILITIES", "Unknown topic"),
                new TokenRequestException("OIDC token endpoint returned HTTP 401", 401, false, null),
                new TokenRequestException("OIDC token endpoint returned HTTP 403", 403, false, null),
                new WorkerProtocolException(0, "INTERRUPTED", "Worker request was interrupted"),
                new IllegalArgumentException("bad configuration"));
        for (RuntimeException failure : permanent) {
            AtomicInteger calls = new AtomicInteger();
            RuntimeException thrown = assertThrows(RuntimeException.class,
                    () -> retry(Duration.ofMinutes(5)).run("register_capabilities", () -> {
                        calls.incrementAndGet();
                        throw failure;
                    }));
            assertSame(failure, thrown);
            assertEquals(1, calls.get(), failure.getMessage());
        }
        assertTrue(sleeps.isEmpty());
    }

    @Test
    void delaysGrowExponentiallyWithJitterAndAreCapped() {
        StartupRetry lowest = new StartupRetry(Duration.ofMinutes(5), clock::get, duration -> {}, () -> 0.0);
        StartupRetry highest = new StartupRetry(Duration.ofMinutes(5), clock::get, duration -> {}, () -> 0.999_999);

        assertEquals(500, lowest.delayMillis(1));
        assertEquals(4_000, lowest.delayMillis(4));
        assertEquals(15_000, lowest.delayMillis(10));
        assertEquals(15_000, lowest.delayMillis(1_000));
        assertEquals(999, highest.delayMillis(1));
        assertEquals(29_999, highest.delayMillis(1_000));
    }

    @Test
    void registrationRetriesAnUnreachableIdentityProviderAndAStartingEngine() throws Exception {
        AtomicInteger tokenCalls = new AtomicInteger();
        AtomicInteger engineCalls = new AtomicInteger();
        List<String> authorizations = new ArrayList<>();
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/token", exchange -> {
            boolean ready = tokenCalls.incrementAndGet() > 1;
            respond(exchange, ready ? 200 : 503,
                    ready ? "{\"access_token\":\"worker-token\",\"expires_in\":300}" : "{}");
        });
        server.createContext("/api/v1/workers/me", exchange -> {
            authorizations.add(exchange.getRequestHeaders().getFirst("Authorization"));
            boolean ready = engineCalls.incrementAndGet() > 1;
            respond(exchange, ready ? 200 : 502, "{}");
        });
        server.start();
        URI base = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        AbadaWorkerClient client = new AbadaWorkerClient(base.resolve("/api"),
                new ClientCredentialsTokenSupplier(oidcConfig(base.resolve("/token"))));

        retry(Duration.ofMinutes(5)).run("register_capabilities",
                () -> client.registerCapabilities(List.of("abada:agent"), List.of()));

        assertEquals(2, tokenCalls.get());
        assertEquals(2, engineCalls.get());
        assertEquals(List.of("Bearer worker-token", "Bearer worker-token"), authorizations);
        assertEquals(2, sleeps.size());
    }

    @Test
    void tokenFailuresAreClassifiedByCause() throws Exception {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/rejected", exchange -> respond(exchange, 401, "{\"error\":\"invalid_client\"}"));
        server.createContext("/overloaded", exchange -> respond(exchange, 429, "{}"));
        server.start();
        URI base = URI.create("http://127.0.0.1:" + server.getAddress().getPort());

        TokenRequestException rejected = assertThrows(TokenRequestException.class,
                () -> new ClientCredentialsTokenSupplier(oidcConfig(base.resolve("/rejected"))).get());
        TokenRequestException overloaded = assertThrows(TokenRequestException.class,
                () -> new ClientCredentialsTokenSupplier(oidcConfig(base.resolve("/overloaded"))).get());
        TokenRequestException unreachable = assertThrows(TokenRequestException.class,
                () -> new ClientCredentialsTokenSupplier(oidcConfig(
                        URI.create("http://127.0.0.1:" + unusedPort() + "/token"))).get());

        assertEquals(401, rejected.status());
        assertFalse(rejected.transientFailure());
        assertTrue(overloaded.transientFailure());
        assertEquals(0, unreachable.status());
        assertTrue(unreachable.transientFailure());
        for (TokenRequestException failure : List.of(rejected, overloaded, unreachable)) {
            assertFalse(failure.getMessage().contains("client-secret"), "the secret never reaches a message");
        }
    }

    @Test
    void startupRetryBudgetIsConfigurableAndBounded() {
        assertEquals(WorkerConfig.DEFAULT_STARTUP_RETRY_BUDGET, WorkerConfig.startupRetryBudget(Map.of()));
        assertEquals(Duration.ZERO, WorkerConfig.startupRetryBudget(Map.of("ABADA_AGENT_STARTUP_RETRY_MS", "0")));
        assertEquals(Duration.ofSeconds(90),
                WorkerConfig.startupRetryBudget(Map.of("ABADA_AGENT_STARTUP_RETRY_MS", "90000")));
        assertThrows(IllegalArgumentException.class,
                () -> WorkerConfig.startupRetryBudget(Map.of("ABADA_AGENT_STARTUP_RETRY_MS", "-1")));
        assertThrows(IllegalArgumentException.class,
                () -> WorkerConfig.startupRetryBudget(Map.of("ABADA_AGENT_STARTUP_RETRY_MS", "3600001")));
    }

    private StartupRetry retry(Duration budget) {
        return new StartupRetry(budget, clock::get, duration -> {
            sleeps.add(duration.toMillis());
            clock.addAndGet(duration.toMillis());
        }, () -> 0.5);
    }

    private static WorkerConfig oidcConfig(URI tokenUrl) {
        return new WorkerConfig(URI.create("http://engine.invalid"), "", tokenUrl, "abada-agent-worker",
                "client-secret", URI.create("http://llm.invalid"), "", URI.create("http://llm.invalid"), "",
                "test-model", "worker-1", Duration.ofSeconds(1), Duration.ofSeconds(30), 1, Set.of());
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, int status, String body)
            throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private static int unusedPort() throws java.io.IOException {
        try (ServerSocket socket = new ServerSocket(0, 0, InetAddress.getLoopbackAddress())) {
            return socket.getLocalPort();
        }
    }
}
