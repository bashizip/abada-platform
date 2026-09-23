package io.abada.agent;

import io.abada.worker.AbadaWorkerClient;
import io.abada.worker.AgentAttemptMetadata;
import io.abada.worker.AgentWorkDescriptor;
import io.abada.worker.LockedExternalTask;
import io.abada.worker.RequestOptions;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * First-party worker for APL {@code agent} tasks over worker protocol v1.
 *
 * <p>Each locked task runs on its own virtual thread, bounded by
 * {@code ABADA_AGENT_MAX_TASKS}. The worker fetches only as many tasks as it
 * has free slots, and keeps every running task's lock alive with a heartbeat
 * ({@code extendLock} every third of the lock duration) so a slow model call
 * never lets the lock expire and cause a duplicate dispatch.
 */
public final class AgentWorkerMain {
    private static final System.Logger LOG = System.getLogger(AgentWorkerMain.class.getName());
    static final String AGENT_TOPIC = "abada:agent";

    private AgentWorkerMain() {}

    public static void main(String[] args) throws Exception {
        WorkerConfig config = WorkerConfig.fromEnvironment();
        Supplier<String> tokens = config.tokenUrl() == null
                ? () -> config.engineToken()
                : new ClientCredentialsTokenSupplier(config);
        AbadaWorkerClient client = new AbadaWorkerClient(config.engineUrl(), tokens);
        AgentGatewayFactory gateways = new AgentGatewayFactory(config);
        List<String> topics = topics(config);
        client.registerCapabilities(topics, List.copyOf(config.allowedModels()));
        LOG.log(System.Logger.Level.INFO,
                "agent_worker_started worker_id={0} topics={1} models={2} max_tasks={3} lock_ms={4}",
                config.workerId(), String.join(",", topics),
                config.allowedModels().isEmpty() ? "(all)" : String.join(",", config.allowedModels()),
                config.maxTasks(), config.lockDuration().toMillis());

        Runner runner = new Runner(Engine.over(client, config, topics), gateways::gatewayFor, config);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> runner.close(), "agent-worker-shutdown"));
        runner.runUntilInterrupted();
    }

    static List<String> topics(WorkerConfig config) {
        LinkedHashSet<String> configuredTopics = new LinkedHashSet<>();
        configuredTopics.add(AGENT_TOPIC);
        configuredTopics.addAll(config.localAckTopics());
        return List.copyOf(configuredTopics);
    }

    /** The engine operations the worker needs; an adapter over the SDK client in production. */
    interface Engine {
        List<LockedExternalTask> fetchAndLock(int maxTasks);

        void complete(LockedExternalTask task, Map<String, Object> variables, AgentAttemptMetadata agent,
                RequestOptions options);

        void fail(LockedExternalTask task, String message, String details, int retries, Duration retryTimeout,
                AgentAttemptMetadata agent, RequestOptions options);

        void extendLock(LockedExternalTask task, Duration lockDuration);

        static Engine over(AbadaWorkerClient client, WorkerConfig config, List<String> topics) {
            return new Engine() {
                @Override
                public List<LockedExternalTask> fetchAndLock(int maxTasks) {
                    return client.fetchAndLock(config.workerId(), topics, config.lockDuration(), maxTasks,
                            RequestOptions.defaults());
                }

                @Override
                public void complete(LockedExternalTask task, Map<String, Object> variables,
                        AgentAttemptMetadata agent, RequestOptions options) {
                    client.complete(task.id(), config.workerId(), variables, agent, options);
                }

                @Override
                public void fail(LockedExternalTask task, String message, String details, int retries,
                        Duration retryTimeout, AgentAttemptMetadata agent, RequestOptions options) {
                    client.fail(task.id(), config.workerId(), message, details, retries, retryTimeout, agent,
                            options);
                }

                @Override
                public void extendLock(LockedExternalTask task, Duration lockDuration) {
                    client.extendLock(task.id(), config.workerId(), lockDuration,
                            new RequestOptions(null, task.traceParent(), null));
                }
            };
        }
    }

    /** Concurrent fetch/process loop with per-task lock heartbeats. */
    static final class Runner implements AutoCloseable {
        private final Engine engine;
        private final Function<AgentWorkDescriptor, AgentGateway> gateways;
        private final WorkerConfig config;
        private final Semaphore slots;
        private final ExecutorService tasks = Executors.newVirtualThreadPerTaskExecutor();
        private final ScheduledExecutorService heartbeats =
                Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().daemon().name("agent-heartbeat").factory());
        private final AtomicBoolean running = new AtomicBoolean(true);
        final AtomicLong completed = new AtomicLong();
        final AtomicLong failed = new AtomicLong();
        final AtomicLong abandoned = new AtomicLong();

        Runner(Engine engine, Function<AgentWorkDescriptor, AgentGateway> gateways, WorkerConfig config) {
            this.engine = engine;
            this.gateways = gateways;
            this.config = config;
            this.slots = new Semaphore(config.maxTasks());
        }

        void runUntilInterrupted() {
            while (running.get() && !Thread.currentThread().isInterrupted()) {
                try {
                    if (pollOnce() == 0) Thread.sleep(config.pollInterval().toMillis());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                } catch (Exception exception) {
                    LOG.log(System.Logger.Level.WARNING, "agent_fetch_failed message={0} retrying_in_ms={1}",
                            safeMessage(exception), config.pollInterval().toMillis());
                    try {
                        Thread.sleep(config.pollInterval().toMillis());
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        }

        /**
         * Fetches at most as many tasks as there are free slots and starts
         * them. Returns the number of tasks started (0 when no slot was free
         * or nothing was available).
         */
        int pollOnce() {
            int free = slots.drainPermits();
            if (free == 0) return 0;
            List<LockedExternalTask> locked;
            try {
                locked = engine.fetchAndLock(free);
            } catch (RuntimeException exception) {
                slots.release(free);
                throw exception;
            }
            slots.release(Math.max(0, free - locked.size()));
            for (LockedExternalTask task : locked) {
                tasks.submit(() -> {
                    try {
                        runWithHeartbeat(task);
                    } finally {
                        slots.release();
                    }
                });
            }
            return locked.size();
        }

        private void runWithHeartbeat(LockedExternalTask task) {
            AtomicBoolean lockLost = new AtomicBoolean(false);
            long interval = Math.max(1, config.lockDuration().toMillis() / 3);
            ScheduledFuture<?>[] beat = new ScheduledFuture<?>[1];
            beat[0] = heartbeats.scheduleAtFixedRate(() -> {
                if (lockLost.get()) return;
                try {
                    engine.extendLock(task, config.lockDuration());
                } catch (RuntimeException exception) {
                    lockLost.set(true);
                    LOG.log(System.Logger.Level.WARNING,
                            "agent_lock_lost task_id={0} activity_id={1} message={2}",
                            task.id(), task.activityId(), safeMessage(exception));
                    if (beat[0] != null) beat[0].cancel(false);
                }
            }, interval, interval, TimeUnit.MILLISECONDS);
            try {
                if (config.localAckTopics().contains(task.topicName())) {
                    if (!lockLost.get()) acknowledgeLocally(task);
                } else {
                    process(task, lockLost);
                }
            } finally {
                beat[0].cancel(false);
            }
        }

        private void acknowledgeLocally(LockedExternalTask task) {
            engine.complete(task, localAcknowledgement(task), null,
                    new RequestOptions("local-ack-" + task.id(), task.traceParent(), null));
            LOG.log(System.Logger.Level.INFO,
                    "local_demo_task_acknowledged task_id={0} topic={1} instance_id={2}",
                    task.id(), task.topicName(), task.processInstanceId());
        }

        private void process(LockedExternalTask task, AtomicBoolean lockLost) {
            AgentWorkDescriptor work = task.agentWork() == null ? null
                    : withBoundedTimeout(task.agentWork(), config.maxTimeout());
            int configuredAttempts = work == null || work.maxAttempts() == null ? 3 : work.maxAttempts();
            int currentRetries = task.retries() == null ? configuredAttempts : task.retries();
            int attempt = Math.max(1, configuredAttempts - Math.min(currentRetries, configuredAttempts) + 1);
            try {
                if (work == null || !"abada.agent/v1".equals(work.profileVersion())) {
                    throw new IllegalArgumentException("Missing or unsupported abada.agent/v1 descriptor");
                }
                Set<String> requestedTools = work.tools() == null ? Set.of() : Set.copyOf(work.tools());
                if (!config.allowedTools().containsAll(requestedTools)) {
                    throw new IllegalArgumentException("Agent requests tools outside the configured allow-list");
                }
                String model = resolveModel(config, work);
                AgentGateway gateway = gateways.apply(work);
                long startedNanos = System.nanoTime();
                AgentGateway.AgentResult result = gateway.execute(work, task.variables());
                long durationMs = TimeUnit.NANOSECONDS.toMillis(Math.max(0, System.nanoTime() - startedNanos));
                if (lockLost.get()) {
                    abandon(task, "complete");
                    return;
                }
                String resultVariable = blankToDefault(work.resultVariable(), task.activityId() + "_result");
                engine.complete(task, Map.of(resultVariable, result.value()),
                        new AgentAttemptMetadata(model, gateway.provider(), attempt, durationMs,
                                List.copyOf(requestedTools), resultVariable, promptHash(work.prompt()), null,
                                result.confidence()),
                        taskOptions(task.id(), attempt, "complete", task.traceParent()));
                long done = completed.incrementAndGet();
                LOG.log(System.Logger.Level.INFO,
                        "agent_task_completed task_id={0} activity_id={1} model={2} attempt={3} completed_total={4} failed_total={5}",
                        task.id(), task.activityId(), model, attempt, done, failed.get());
            } catch (Exception exception) {
                if (lockLost.get()) {
                    abandon(task, "failure");
                    return;
                }
                int remaining = Math.max(0, Math.min(currentRetries, configuredAttempts) - 1);
                long backoff = work == null || work.retryBackoffMs() == null ? 2_000L : work.retryBackoffMs();
                String model = work == null ? config.defaultModel() : resolveModel(config, work);
                String provider = work == null ? "unknown" : gateways.apply(work).provider();
                Double achieved = exception instanceof AgentGateway.ConfidenceBelowThresholdException below
                        ? below.confidence() : null;
                try {
                    engine.fail(task, safeMessage(exception), exception.getClass().getSimpleName(), remaining,
                            Duration.ofMillis(backoff),
                            new AgentAttemptMetadata(model, provider, attempt, null, List.of(), null, null,
                                    exception.getClass().getSimpleName(), achieved),
                            taskOptions(task.id(), attempt, "failure", task.traceParent()));
                } catch (RuntimeException reportFailure) {
                    LOG.log(System.Logger.Level.WARNING, "agent_failure_report_failed task_id={0} message={1}",
                            task.id(), safeMessage(reportFailure));
                }
                long total = failed.incrementAndGet();
                LOG.log(System.Logger.Level.WARNING,
                        "agent_task_failed task_id={0} activity_id={1} model={2} attempt={3} retries_remaining={4} completed_total={5} failed_total={6}",
                        task.id(), task.activityId(), model, attempt, remaining, completed.get(), total);
            }
        }

        private void abandon(LockedExternalTask task, String operation) {
            abandoned.incrementAndGet();
            LOG.log(System.Logger.Level.WARNING,
                    "agent_task_abandoned task_id={0} activity_id={1} operation={2} reason=lock_lost",
                    task.id(), task.activityId(), operation);
        }

        /** Stops fetching and waits up to 30 seconds for in-flight tasks. */
        @Override
        public void close() {
            if (!running.getAndSet(false)) return;
            tasks.shutdown();
            try {
                if (!tasks.awaitTermination(30, TimeUnit.SECONDS)) tasks.shutdownNow();
            } catch (InterruptedException interrupted) {
                tasks.shutdownNow();
                Thread.currentThread().interrupt();
            }
            heartbeats.shutdownNow();
        }

        boolean awaitIdle(Duration timeout) throws InterruptedException {
            if (!slots.tryAcquire(config.maxTasks(), timeout.toMillis(), TimeUnit.MILLISECONDS)) return false;
            slots.release(config.maxTasks());
            return true;
        }
    }

    /** Clamps a descriptor's model-call timeout to the worker maximum. */
    static AgentWorkDescriptor withBoundedTimeout(AgentWorkDescriptor work, Duration maximum) {
        long max = maximum.toMillis();
        if (work.timeoutMs() != null && work.timeoutMs() <= max) return work;
        long bounded = work.timeoutMs() == null ? Math.min(60_000L, max) : max;
        return new AgentWorkDescriptor(work.profileVersion(), work.model(), work.prompt(), work.inputs(),
                work.resultVariable(), work.outputSchema(), work.tools(), work.confidenceThreshold(),
                work.temperature(), work.maxTokens(), bounded, work.maxAttempts(), work.retryBackoffMs());
    }

    static Map<String, Object> localAcknowledgement(LockedExternalTask task) {
        return Map.of("systemAck", Map.of(
                "adapter", "Local demo adapter",
                "topic", task.topicName(),
                "processInstanceId", task.processInstanceId(),
                "status", "ACKNOWLEDGED"));
    }

    private static String safeMessage(Exception exception) {
        String value = exception.getMessage();
        if (value == null || value.isBlank()) return "Agent execution failed";
        return value.length() > 300 ? value.substring(0, 300) : value;
    }

    private static RequestOptions taskOptions(String taskId, int attempt, String operation, String traceParent) {
        return new RequestOptions("agent-" + taskId + "-attempt-" + attempt + "-" + operation, traceParent, null);
    }

    private static String blankToDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    static String promptHash(String prompt) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((prompt == null ? "" : prompt).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest).substring(0, 16);
        } catch (java.security.NoSuchAlgorithmException exception) {
            return "";
        }
    }

    private static String resolveModel(WorkerConfig config, AgentWorkDescriptor work) {
        return blankToDefault(work.model(), config.defaultModel());
    }
}
