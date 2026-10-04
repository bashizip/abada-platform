package io.abada.agent;

import io.abada.worker.AgentAttemptMetadata;
import io.abada.worker.AgentWorkDescriptor;
import io.abada.worker.LockedExternalTask;
import io.abada.worker.RequestOptions;
import io.abada.worker.WorkerProtocolException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Concurrency and lock-heartbeat behaviour of the agent worker loop (T3). */
class AgentWorkerRunnerTest {

    private static final Duration LOCK = Duration.ofMillis(1_200);
    private static final long MODEL_LATENCY_MS = 1_500;

    @Test
    void slowTasksRunConcurrentlyAndKeepTheirLocksAlive() throws Exception {
        FakeEngine engine = new FakeEngine(4, false);
        AtomicInteger modelCalls = new AtomicInteger();
        var runner = new AgentWorkerMain.Runner(engine, work -> slowGateway(modelCalls), config(4));

        long started = System.nanoTime();
        assertEquals(4, runner.pollOnce());
        assertTrue(runner.awaitIdle(Duration.ofSeconds(10)));
        long elapsedMs = Duration.ofNanos(System.nanoTime() - started).toMillis();
        runner.close();

        assertEquals(4, modelCalls.get(), "exactly one model call per task");
        assertEquals(4, engine.completed.size(), "every completion arrived while its lock was held");
        assertTrue(engine.lockViolations.isEmpty(), "no task reported after its lock expired");
        assertTrue(engine.extendCalls.get() >= 4, "every running task sent at least one heartbeat");
        assertTrue(elapsedMs < 2 * MODEL_LATENCY_MS, "tasks ran concurrently, took " + elapsedMs + " ms");
    }

    @Test
    void noHeartbeatIsSentWhileTheResultIsBeingReported() throws Exception {
        FakeEngine engine = new FakeEngine(4, false);
        // A slow completion call overlaps the next heartbeat tick unless the
        // worker stops its heartbeat before reporting.
        engine.completeLatencyMs = 500;
        var runner = new AgentWorkerMain.Runner(engine, work -> slowGateway(new AtomicInteger()), config(4));

        assertEquals(4, runner.pollOnce());
        assertTrue(runner.awaitIdle(Duration.ofSeconds(10)));
        runner.close();

        assertEquals(4, engine.completed.size());
        assertTrue(engine.heartbeatsAfterReport.isEmpty(),
                "heartbeats raced the completion for " + engine.heartbeatsAfterReport);
    }

    @Test
    void aConcurrentModificationOnCompleteIsRetriedOnceWithoutAnotherModelCall() throws Exception {
        FakeEngine engine = new FakeEngine(1, false);
        engine.completeConflicts.set(1);
        AtomicInteger modelCalls = new AtomicInteger();
        var runner = new AgentWorkerMain.Runner(engine, work -> slowGateway(modelCalls), config(1));

        assertEquals(1, runner.pollOnce());
        assertTrue(runner.awaitIdle(Duration.ofSeconds(10)));
        runner.close();

        assertEquals(1, modelCalls.get(), "the retry reuses the result");
        assertEquals(List.of("task-0"), engine.completed);
        assertEquals(2, engine.completeAttempts.get());
        assertTrue(engine.failed.isEmpty(), "a conflict must not discard the result as a failure");
    }

    @Test
    void workerIdIsUniquePerReplicaUnlessConfigured() {
        assertEquals("abada-agent-worker-3f2a9c1b", WorkerConfig.workerId(Map.of("HOSTNAME", "3f2a9c1b")));
        assertEquals("billing-worker",
                WorkerConfig.workerId(Map.of("ABADA_AGENT_WORKER_ID", "billing-worker", "HOSTNAME", "3f2a9c1b")));
        String generated = WorkerConfig.workerId(Map.of());
        assertTrue(generated.startsWith("abada-agent-worker-") && !generated.equals(WorkerConfig.workerId(Map.of())),
                "without a hostname each process generates its own id");
    }

    @Test
    void fetchesOnlyAsManyTasksAsThereAreFreeSlots() throws Exception {
        FakeEngine engine = new FakeEngine(6, false);
        var runner = new AgentWorkerMain.Runner(engine, work -> slowGateway(new AtomicInteger()), config(2));

        assertEquals(2, runner.pollOnce());
        assertEquals(0, runner.pollOnce(), "no free slot while two tasks are running");
        assertEquals(List.of(2), engine.requestedBatchSizes);
        assertTrue(runner.awaitIdle(Duration.ofSeconds(10)));
        runner.close();
    }

    @Test
    void aLostLockAbandonsTheTaskWithoutReportingIt() throws Exception {
        FakeEngine engine = new FakeEngine(1, true);
        var runner = new AgentWorkerMain.Runner(engine, work -> slowGateway(new AtomicInteger()), config(1));

        assertEquals(1, runner.pollOnce());
        assertTrue(runner.awaitIdle(Duration.ofSeconds(10)));
        runner.close();

        assertTrue(engine.completed.isEmpty(), "a task whose heartbeat failed must not be completed");
        assertTrue(engine.failed.isEmpty(), "nor reported as failed");
        assertEquals(1, runner.abandoned.get());
    }

    @Test
    void descriptorTimeoutsAreClampedToTheWorkerMaximum() {
        AgentWorkDescriptor longCall = descriptor(3_600_000L);
        assertEquals(120_000L, AgentWorkerMain.withBoundedTimeout(longCall, Duration.ofMinutes(2)).timeoutMs());
        AgentWorkDescriptor shortCall = descriptor(5_000L);
        assertEquals(5_000L, AgentWorkerMain.withBoundedTimeout(shortCall, Duration.ofMinutes(2)).timeoutMs());
        AgentWorkDescriptor unset = descriptor(null);
        assertEquals(60_000L, AgentWorkerMain.withBoundedTimeout(unset, Duration.ofMinutes(2)).timeoutMs());
    }

    @Test
    void aFailedAttemptReportsTheRedactedStackTraceWithItsCause() throws Exception {
        FakeEngine engine = new FakeEngine(1, false);
        String key = "sk-live-provider-key-0042";
        AgentGateway failing = new AgentGateway() {
            @Override
            public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) {
                throw new AgentGateway.AgentUnreachableException("anthropic API is unreachable with key " + key,
                        new java.net.ConnectException("Connection refused; Authorization: Bearer " + key));
            }

            @Override
            public String provider() {
                return "anthropic";
            }
        };
        var runner = new AgentWorkerMain.Runner(engine, work -> failing, config(1),
                new SecretRedactor(() -> List.of(key)));

        assertEquals(1, runner.pollOnce());
        assertTrue(runner.awaitIdle(Duration.ofSeconds(10)));
        runner.close();

        String details = engine.failureDetails.get(0);
        assertTrue(details.startsWith("io.abada.agent.AgentGateway$AgentUnreachableException"), details);
        assertTrue(details.contains("Caused by: java.net.ConnectException"), details);
        assertTrue(details.contains("\tat "), "stack frames are included");
        assertTrue(!details.contains(key) && !engine.failureMessages.get(0).contains(key), "the key is redacted");
    }

    private static AgentGateway slowGateway(AtomicInteger calls) {
        return new AgentGateway() {
            @Override
            public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) throws Exception {
                calls.incrementAndGet();
                Thread.sleep(MODEL_LATENCY_MS);
                return new AgentResult("done", null);
            }

            @Override
            public String provider() {
                return "fake";
            }
        };
    }

    private static WorkerConfig config(int maxTasks) {
        return new WorkerConfig(URI.create("http://engine.invalid"), "token", null, "", "",
                URI.create("http://llm.invalid/v1"), "key", URI.create("http://llm.invalid/v1"), "key",
                "test-model", "test-worker", Set.of(), Duration.ofMillis(50), LOCK, maxTasks, Set.of(), Set.of(),
                WorkerConfig.DEFAULT_MAX_TIMEOUT, WorkerConfig.StructuredOutput.JSON_OBJECT);
    }

    private static AgentWorkDescriptor descriptor(Long timeoutMs) {
        return new AgentWorkDescriptor("abada.agent/v1", "test-model", "Summarize", Map.of(), "summary",
                Map.of(), List.of(), null, 0.2, 256, timeoutMs, 3, 1_000L);
    }

    record Failure(int retries, Duration retryTimeout, AgentAttemptMetadata agent, boolean deferred,
            String idempotencyKey) {}

    @Test
    void aRateLimitedModelFallsBackToTheNextDeclaredModel() throws Exception {
        FakeEngine engine = new FakeEngine(List.of(task("task-0", fallbackDescriptor())));
        List<String> called = Collections.synchronizedList(new ArrayList<>());
        var runner = new AgentWorkerMain.Runner(engine, work -> scripted(work.model(), called, Map.of(
                "model-a", new AgentGateway.AgentQuotaExceededException("rate limited", Duration.ofSeconds(30)))),
                config(1));

        assertEquals(1, runner.pollOnce());
        assertTrue(runner.awaitIdle(Duration.ofSeconds(10)));
        runner.close();

        assertEquals(List.of("model-a", "model-b"), called, "the fallback is tried only after the first is unavailable");
        assertEquals(1, engine.completed.size());
        AgentAttemptMetadata metadata = engine.completions.get(0);
        assertEquals("model-b", metadata.model(), "metadata names the model that produced the result");
        assertEquals("model-a", metadata.requestedModel(), "and the declared model it replaced");
    }

    @Test
    void whenEveryModelIsUnavailableTheAttemptIsDeferredNotSpent() throws Exception {
        FakeEngine engine = new FakeEngine(List.of(task("task-0", fallbackDescriptor())));
        List<String> called = Collections.synchronizedList(new ArrayList<>());
        var runner = new AgentWorkerMain.Runner(engine, work -> scripted(work.model(), called, Map.of(
                "model-a", new AgentGateway.AgentQuotaExceededException("rate limited", Duration.ofSeconds(30)),
                "model-b", new AgentGateway.AgentUnavailableException("HTTP 503", Duration.ofSeconds(45)),
                "model-c", new AgentGateway.AgentUnreachableException("timeout",
                        new java.net.http.HttpTimeoutException("timed out")))), config(1));

        assertEquals(1, runner.pollOnce());
        assertTrue(runner.awaitIdle(Duration.ofSeconds(10)));
        runner.close();

        assertEquals(List.of("model-a", "model-b", "model-c"), called);
        Failure failure = engine.failures.get(0);
        assertTrue(failure.deferred(), "reported as a deferral");
        assertEquals(3, failure.retries(), "the attempt budget is kept");
        assertEquals(Duration.ofSeconds(45), failure.retryTimeout(), "the longest Retry-After is honoured");
        assertTrue(failure.idempotencyKey().endsWith("-deferral"), failure.idempotencyKey());
    }

    @Test
    void anErrorThatIsNotAvailabilityNeverTriesAFallback() throws Exception {
        FakeEngine engine = new FakeEngine(List.of(task("task-0", fallbackDescriptor())));
        List<String> called = Collections.synchronizedList(new ArrayList<>());
        var runner = new AgentWorkerMain.Runner(engine, work -> scripted(work.model(), called, Map.of(
                "model-a", new AgentGateway.AgentExecutionException("returned no assistant content"))), config(1));

        assertEquals(1, runner.pollOnce());
        assertTrue(runner.awaitIdle(Duration.ofSeconds(10)));
        runner.close();

        assertEquals(List.of("model-a"), called, "a failed call is a failed attempt, not a reason to switch model");
        Failure failure = engine.failures.get(0);
        assertTrue(!failure.deferred());
        assertEquals(2, failure.retries(), "one attempt is spent");
    }

    @Test
    void reportsOfTwoLeasesOfTheSameAttemptHaveDistinctIdempotencyKeys() {
        LockedExternalTask first = new LockedExternalTask("task-9", AgentWorkerMain.AGENT_TOPIC, Map.of(), "pi",
                "draft", 3, Instant.ofEpochMilli(1_000), null, "1", descriptor(1_000L), "project");
        LockedExternalTask second = new LockedExternalTask("task-9", AgentWorkerMain.AGENT_TOPIC, Map.of(), "pi",
                "draft", 3, Instant.ofEpochMilli(2_000), null, "1", descriptor(1_000L), "project");
        String a = AgentWorkerMain.taskOptions(first, 1, "deferral").idempotencyKey();
        String b = AgentWorkerMain.taskOptions(second, 1, "deferral").idempotencyKey();
        assertTrue(!a.equals(b), a + " vs " + b);
        assertEquals(a, AgentWorkerMain.taskOptions(first, 1, "deferral").idempotencyKey(),
                "a resent report of the same lease is deduplicated");
    }

    private static AgentWorkDescriptor fallbackDescriptor() {
        return new AgentWorkDescriptor("abada.agent/v1", "model-a", "Summarize", Map.of(), "summary",
                Map.of(), List.of(), null, 0.2, 256, 1_000L, 3, 1_000L, List.of("model-b", "model-c"));
    }

    private static LockedExternalTask task(String id, AgentWorkDescriptor work) {
        return new LockedExternalTask(id, AgentWorkerMain.AGENT_TOPIC, Map.of(), "pi-" + id, "summarize", 3,
                null, null, "1", work, "project");
    }

    /** A gateway that throws the scripted exception for its model, else answers. */
    private static AgentGateway scripted(String model, List<String> called, Map<String, RuntimeException> errors) {
        return new AgentGateway() {
            @Override
            public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) {
                called.add(work.model());
                RuntimeException error = errors.get(work.model());
                if (error != null) throw error;
                return new AgentResult("done from " + work.model(), null);
            }

            @Override
            public String provider() {
                return "fake-" + model;
            }
        };
    }

    /** In-memory engine that enforces lock expiry the way the real engine does. */
    private static final class FakeEngine implements AgentWorkerMain.Engine {
        private final Deque<LockedExternalTask> available = new ArrayDeque<>();
        private final Map<String, Instant> lockExpiry = new ConcurrentHashMap<>();
        private final boolean heartbeatFails;
        final List<String> completed = Collections.synchronizedList(new ArrayList<>());
        final List<String> failed = Collections.synchronizedList(new ArrayList<>());
        final List<String> failureMessages = Collections.synchronizedList(new ArrayList<>());
        final List<String> failureDetails = Collections.synchronizedList(new ArrayList<>());
        final List<Failure> failures = Collections.synchronizedList(new ArrayList<>());
        final List<AgentAttemptMetadata> completions = Collections.synchronizedList(new ArrayList<>());
        final List<String> lockViolations = Collections.synchronizedList(new ArrayList<>());
        final List<Integer> requestedBatchSizes = Collections.synchronizedList(new ArrayList<>());
        final AtomicInteger extendCalls = new AtomicInteger();
        final Set<String> reporting = ConcurrentHashMap.newKeySet();
        final List<String> heartbeatsAfterReport = Collections.synchronizedList(new ArrayList<>());
        final AtomicInteger completeConflicts = new AtomicInteger();
        final AtomicInteger completeAttempts = new AtomicInteger();
        volatile long completeLatencyMs;

        FakeEngine(List<LockedExternalTask> tasks) {
            this.heartbeatFails = false;
            available.addAll(tasks);
        }

        FakeEngine(int tasks, boolean heartbeatFails) {
            this.heartbeatFails = heartbeatFails;
            for (int i = 0; i < tasks; i++) {
                available.add(new LockedExternalTask("task-" + i, AgentWorkerMain.AGENT_TOPIC, Map.of(),
                        "pi-" + i, "summarize", 3, null, null, "1", descriptor(60_000L), "project"));
            }
        }

        @Override
        public synchronized List<LockedExternalTask> fetchAndLock(int maxTasks) {
            requestedBatchSizes.add(maxTasks);
            List<LockedExternalTask> locked = new ArrayList<>();
            while (locked.size() < maxTasks && !available.isEmpty()) {
                LockedExternalTask task = available.poll();
                lockExpiry.put(task.id(), Instant.now().plus(LOCK));
                locked.add(task);
            }
            return locked;
        }

        @Override
        public void complete(LockedExternalTask task, Map<String, Object> variables, AgentAttemptMetadata agent,
                RequestOptions options) {
            reporting.add(task.id());
            completeAttempts.incrementAndGet();
            requireLock(task);
            if (completeConflicts.getAndUpdate(n -> Math.max(0, n - 1)) > 0) {
                throw new WorkerProtocolException(409, "CONCURRENT_MODIFICATION", "Runtime state changed concurrently");
            }
            sleepQuietly(completeLatencyMs);
            completions.add(agent);
            completed.add(task.id());
        }

        @Override
        public void fail(LockedExternalTask task, String message, String details, int retries,
                Duration retryTimeout, AgentAttemptMetadata agent, boolean deferred, RequestOptions options) {
            reporting.add(task.id());
            requireLock(task);
            failureMessages.add(message);
            failureDetails.add(details);
            failures.add(new Failure(retries, retryTimeout, agent, deferred, options.idempotencyKey()));
            failed.add(task.id());
        }

        @Override
        public void extendLock(LockedExternalTask task, Duration lockDuration) {
            extendCalls.incrementAndGet();
            if (reporting.contains(task.id())) heartbeatsAfterReport.add(task.id());
            if (heartbeatFails) throw new IllegalStateException("lock owned by another worker");
            requireLock(task);
            lockExpiry.put(task.id(), Instant.now().plus(lockDuration));
        }

        private static void sleepQuietly(long millis) {
            if (millis <= 0) return;
            try {
                Thread.sleep(millis);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }

        private void requireLock(LockedExternalTask task) {
            if (Instant.now().isAfter(lockExpiry.get(task.id()))) {
                lockViolations.add(task.id());
                throw new IllegalStateException("lock expired for " + task.id());
            }
        }
    }
}
