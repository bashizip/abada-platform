package io.abada.agent;

import io.abada.worker.AgentAttemptMetadata;
import io.abada.worker.AgentWorkDescriptor;
import io.abada.worker.LockedExternalTask;
import io.abada.worker.RequestOptions;
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
                WorkerConfig.DEFAULT_MAX_TIMEOUT);
    }

    private static AgentWorkDescriptor descriptor(Long timeoutMs) {
        return new AgentWorkDescriptor("abada.agent/v1", "test-model", "Summarize", Map.of(), "summary",
                Map.of(), List.of(), null, 0.2, 256, timeoutMs, 3, 1_000L);
    }

    /** In-memory engine that enforces lock expiry the way the real engine does. */
    private static final class FakeEngine implements AgentWorkerMain.Engine {
        private final Deque<LockedExternalTask> available = new ArrayDeque<>();
        private final Map<String, Instant> lockExpiry = new ConcurrentHashMap<>();
        private final boolean heartbeatFails;
        final List<String> completed = Collections.synchronizedList(new ArrayList<>());
        final List<String> failed = Collections.synchronizedList(new ArrayList<>());
        final List<String> lockViolations = Collections.synchronizedList(new ArrayList<>());
        final List<Integer> requestedBatchSizes = Collections.synchronizedList(new ArrayList<>());
        final AtomicInteger extendCalls = new AtomicInteger();

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
            requireLock(task);
            completed.add(task.id());
        }

        @Override
        public void fail(LockedExternalTask task, String message, String details, int retries,
                Duration retryTimeout, AgentAttemptMetadata agent, RequestOptions options) {
            requireLock(task);
            failed.add(task.id());
        }

        @Override
        public void extendLock(LockedExternalTask task, Duration lockDuration) {
            extendCalls.incrementAndGet();
            if (heartbeatFails) throw new IllegalStateException("lock owned by another worker");
            requireLock(task);
            lockExpiry.put(task.id(), Instant.now().plus(lockDuration));
        }

        private void requireLock(LockedExternalTask task) {
            if (Instant.now().isAfter(lockExpiry.get(task.id()))) {
                lockViolations.add(task.id());
                throw new IllegalStateException("lock expired for " + task.id());
            }
        }
    }
}
