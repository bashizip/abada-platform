package io.abada.agent;

import io.abada.worker.AbadaWorkerClient;
import io.abada.worker.AgentAttemptMetadata;
import io.abada.worker.AgentWorkDescriptor;
import io.abada.worker.LockedExternalTask;
import io.abada.worker.RequestOptions;
import io.abada.worker.WorkerProtocolException;
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
import java.util.concurrent.locks.ReentrantLock;
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
        List<String> topics = topics(config);
        // The engine and identity provider may still be starting (Docker
        // starts every container at once after a host reboot).
        new StartupRetry(config.startupRetryBudget()).run("register_capabilities",
                () -> client.registerCapabilities(topics, List.copyOf(config.allowedModels())));
        // Provider keys come from the engine (Studio settings over engine
        // environment); the worker's own ABADA_AGENT_LLM_* / ABADA_AGENT_OPENAI_*
        // variables are a deprecated fallback.
        ProviderCredentials credentials = new ProviderCredentials(client::aiCredentials,
                ProviderCredentials.fromEnvironment(config), config.credentialsTtl(), System::currentTimeMillis);
        credentials.logSource();
        AgentGatewayFactory gateways = new AgentGatewayFactory(config, credentials);
        SecretRedactor redactor = new SecretRedactor(() -> {
            java.util.List<String> secrets = new java.util.ArrayList<>(credentials.knownKeys());
            secrets.add(config.engineToken());
            secrets.add(config.oidcClientSecret());
            return secrets;
        });
        LOG.log(System.Logger.Level.INFO,
                "agent_worker_started worker_id={0} topics={1} models={2} max_tasks={3} lock_ms={4}",
                config.workerId(), String.join(",", topics),
                config.allowedModels().isEmpty() ? "(all)" : String.join(",", config.allowedModels()),
                config.maxTasks(), config.lockDuration().toMillis());

        Runner runner = new Runner(Engine.over(client, config, topics), gateways::gatewayFor, config, redactor);
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
                AgentAttemptMetadata agent, boolean deferred, RequestOptions options);

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
                        Duration retryTimeout, AgentAttemptMetadata agent, boolean deferred, RequestOptions options) {
                    client.fail(task.id(), config.workerId(), message, details, retries, retryTimeout, agent,
                            deferred, options);
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
        private final SecretRedactor redactor;
        private final Semaphore slots;
        private final ExecutorService tasks = Executors.newVirtualThreadPerTaskExecutor();
        private final ScheduledExecutorService heartbeats =
                Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().daemon().name("agent-heartbeat").factory());
        private final AtomicBoolean running = new AtomicBoolean(true);
        final AtomicLong completed = new AtomicLong();
        final AtomicLong failed = new AtomicLong();
        final AtomicLong abandoned = new AtomicLong();

        Runner(Engine engine, Function<AgentWorkDescriptor, AgentGateway> gateways, WorkerConfig config) {
            this(engine, gateways, config, SecretRedactor.patternsOnly());
        }

        Runner(Engine engine, Function<AgentWorkDescriptor, AgentGateway> gateways, WorkerConfig config,
                SecretRedactor redactor) {
            this.redactor = redactor;
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
            Heartbeat heartbeat = new Heartbeat(task);
            try {
                if (config.localAckTopics().contains(task.topicName())) {
                    heartbeat.stop();
                    if (!heartbeat.lockLost()) acknowledgeLocally(task);
                } else {
                    process(task, heartbeat);
                }
            } finally {
                heartbeat.stop();
            }
        }

        /**
         * Extends the task lock every third of the lock duration until
         * stopped. {@link #stop()} waits for an in-flight extension, so the
         * worker never reports a result while its own heartbeat is writing
         * the same task.
         */
        private final class Heartbeat {
            private final LockedExternalTask task;
            private final ReentrantLock guard = new ReentrantLock();
            private final AtomicBoolean lockLost = new AtomicBoolean(false);
            private final ScheduledFuture<?> beat;
            private boolean stopped;

            Heartbeat(LockedExternalTask task) {
                this.task = task;
                long interval = Math.max(1, config.lockDuration().toMillis() / 3);
                this.beat = heartbeats.scheduleAtFixedRate(this::extend, interval, interval, TimeUnit.MILLISECONDS);
            }

            private void extend() {
                guard.lock();
                try {
                    if (stopped || lockLost.get()) return;
                    engine.extendLock(task, config.lockDuration());
                } catch (RuntimeException exception) {
                    lockLost.set(true);
                    LOG.log(System.Logger.Level.WARNING,
                            "agent_lock_lost task_id={0} activity_id={1} message={2}",
                            task.id(), task.activityId(), safeMessage(exception));
                } finally {
                    guard.unlock();
                }
            }

            void stop() {
                guard.lock();
                try {
                    stopped = true;
                } finally {
                    guard.unlock();
                }
                beat.cancel(false);
            }

            boolean lockLost() {
                return lockLost.get();
            }
        }

        private void acknowledgeLocally(LockedExternalTask task) {
            engine.complete(task, localAcknowledgement(task), null,
                    new RequestOptions("local-ack-" + task.id(), task.traceParent(), null));
            LOG.log(System.Logger.Level.INFO,
                    "local_demo_task_acknowledged task_id={0} topic={1} instance_id={2}",
                    task.id(), task.topicName(), task.processInstanceId());
        }

        private void process(LockedExternalTask task, Heartbeat heartbeat) {
            AgentWorkDescriptor work = task.agentWork() == null ? null
                    : withBoundedTimeout(task.agentWork(), config.maxTimeout());
            int configuredAttempts = work == null || work.maxAttempts() == null ? 3 : work.maxAttempts();
            int currentRetries = task.retries() == null ? configuredAttempts : task.retries();
            int attempt = Math.max(1, configuredAttempts - Math.min(currentRetries, configuredAttempts) + 1);
            String requestedModel = work == null ? config.defaultModel() : resolveModel(config, work);
            String model = requestedModel;
            String provider = "unknown";
            Set<String> requestedTools = work == null || work.tools() == null ? Set.of() : Set.copyOf(work.tools());
            try {
                if (work == null || !"abada.agent/v1".equals(work.profileVersion())) {
                    throw new IllegalArgumentException("Missing or unsupported abada.agent/v1 descriptor");
                }
                if (!config.allowedTools().containsAll(requestedTools)) {
                    throw new IllegalArgumentException("Agent requests tools outside the configured allow-list");
                }
                // The declared model first, then each fallback, but only while the
                // model before could not run the attempt at all (rate limit, quota,
                // outage). Any other outcome, including output the engine will
                // reject, ends the chain: a fallback never "shops" for an answer.
                AgentGateway.AgentResult result = null;
                AgentGateway.AgentUnavailableException unavailable = null;
                Duration retryAfter = null;
                long durationMs = 0;
                for (String candidate : modelChain(work, requestedModel)) {
                    AgentWorkDescriptor attemptWork = candidate.equals(requestedModel) ? work : work.withModel(candidate);
                    AgentGateway gateway = gateways.apply(attemptWork);
                    model = candidate;
                    provider = gateway.provider();
                    long startedNanos = System.nanoTime();
                    try {
                        result = gateway.execute(attemptWork, task.variables());
                        durationMs = TimeUnit.NANOSECONDS.toMillis(Math.max(0, System.nanoTime() - startedNanos));
                        break;
                    } catch (AgentGateway.AgentUnavailableException modelUnavailable) {
                        unavailable = modelUnavailable;
                        if (modelUnavailable.retryAfter() != null && (retryAfter == null
                                || modelUnavailable.retryAfter().compareTo(retryAfter) > 0)) {
                            retryAfter = modelUnavailable.retryAfter();
                        }
                        LOG.log(System.Logger.Level.WARNING,
                                "agent_model_unavailable task_id={0} activity_id={1} model={2} error_type={3}",
                                task.id(), task.activityId(), candidate, modelUnavailable.getClass().getSimpleName());
                    }
                }
                if (result == null) throw new Deferral(unavailable, retryAfter);
                heartbeat.stop();
                if (heartbeat.lockLost()) {
                    abandon(task, "complete");
                    return;
                }
                String resultVariable = blankToDefault(work.resultVariable(), task.activityId() + "_result");
                Map<String, Object> variables = Map.of(resultVariable, result.value());
                AgentAttemptMetadata metadata = new AgentAttemptMetadata(model, provider, attempt, durationMs,
                        List.copyOf(requestedTools), resultVariable, promptHash(work.prompt()), null,
                        result.confidence(), result.promptTokens(), result.completionTokens(),
                        model.equals(requestedModel) ? null : requestedModel);
                RequestOptions options = taskOptions(task, attempt, "complete");
                try {
                    engine.complete(task, variables, metadata, options);
                } catch (WorkerProtocolException conflict) {
                    // 409: the task row changed between the engine's access
                    // check and the command. The lock is still ours, so
                    // retry once instead of discarding a paid-for result.
                    if (conflict.status() != 409) throw conflict;
                    LOG.log(System.Logger.Level.INFO,
                            "agent_complete_retried task_id={0} activity_id={1} reason=concurrent_modification",
                            task.id(), task.activityId());
                    engine.complete(task, variables, metadata, options);
                }
                long done = completed.incrementAndGet();
                LOG.log(System.Logger.Level.INFO,
                        "agent_task_completed task_id={0} activity_id={1} model={2} attempt={3} completed_total={4} failed_total={5}",
                        task.id(), task.activityId(), model, attempt, done, failed.get());
            } catch (Exception thrown) {
                heartbeat.stop();
                if (heartbeat.lockLost()) {
                    abandon(task, "failure");
                    return;
                }
                boolean deferred = thrown instanceof Deferral;
                Exception exception = deferred ? ((Deferral) thrown).unavailable : thrown;
                // A deferral keeps the attempt budget: the model never ran.
                int remaining = deferred ? Math.min(currentRetries, configuredAttempts)
                        : Math.max(0, Math.min(currentRetries, configuredAttempts) - 1);
                long backoff = work == null || work.retryBackoffMs() == null ? 2_000L : work.retryBackoffMs();
                Duration retryTimeout = deferred && ((Deferral) thrown).retryAfter != null
                        ? ((Deferral) thrown).retryAfter : Duration.ofMillis(backoff);
                Double achieved = exception instanceof AgentGateway.ConfidenceBelowThresholdException below
                        ? below.confidence() : null;
                try {
                    // The full, redacted stack trace is stored on the task and shown
                    // to operators in Studio's error details.
                    engine.fail(task, redactor.redact(safeMessage(exception)), redactor.stackTrace(exception),
                            remaining, retryTimeout,
                            new AgentAttemptMetadata(model, provider, attempt, null, List.of(), null, null,
                                    exception.getClass().getSimpleName(), achieved, null, null,
                                    model.equals(requestedModel) ? null : requestedModel),
                            deferred, taskOptions(task, attempt, deferred ? "deferral" : "failure"));
                } catch (RuntimeException reportFailure) {
                    LOG.log(System.Logger.Level.WARNING, "agent_failure_report_failed task_id={0} message={1}",
                            task.id(), safeMessage(reportFailure));
                }
                long total = failed.incrementAndGet();
                LOG.log(System.Logger.Level.WARNING,
                        "agent_task_failed task_id={0} activity_id={1} model={2} attempt={3} retries_remaining={4} deferred={5} completed_total={6} failed_total={7}",
                        task.id(), task.activityId(), model, attempt, remaining, deferred, completed.get(), total);
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
                work.temperature(), work.maxTokens(), bounded, work.maxAttempts(), work.retryBackoffMs(),
                work.fallbackModels());
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

    /**
     * Idempotency key of a report. It names the lease (its expiry), not only the
     * attempt: a deferral keeps the attempt number, so two deferrals of the same
     * attempt must still be two distinct requests.
     */
    static RequestOptions taskOptions(LockedExternalTask task, int attempt, String operation) {
        String lease = task.lockExpirationTime() == null ? "attempt-" + attempt
                : "lease-" + task.lockExpirationTime().toEpochMilli();
        return new RequestOptions("agent-" + task.id() + "-" + lease + "-" + operation, task.traceParent(), null);
    }

    /** The declared model, then each declared fallback once, in order. */
    static List<String> modelChain(AgentWorkDescriptor work, String requestedModel) {
        java.util.LinkedHashSet<String> chain = new java.util.LinkedHashSet<>();
        chain.add(requestedModel);
        if (work.fallbackModels() != null) {
            work.fallbackModels().stream().filter(candidate -> candidate != null && !candidate.isBlank())
                    .forEach(chain::add);
        }
        return List.copyOf(chain);
    }

    /** Every model in the chain was unavailable: report a deferral, not a failed attempt. */
    private static final class Deferral extends Exception {
        private final Exception unavailable;
        private final Duration retryAfter;

        Deferral(Exception cause, Duration retryAfter) {
            super(cause.getMessage(), cause, false, false);
            this.unavailable = cause;
            this.retryAfter = retryAfter;
        }
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
