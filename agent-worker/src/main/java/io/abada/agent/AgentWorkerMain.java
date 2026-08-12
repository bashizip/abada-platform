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
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

/** First-party worker for APL {@code agent} tasks over worker protocol v1. */
public final class AgentWorkerMain {
    private static final System.Logger LOG = System.getLogger(AgentWorkerMain.class.getName());
    private static final AtomicLong COMPLETED = new AtomicLong();
    private static final AtomicLong FAILED = new AtomicLong();

    private AgentWorkerMain() {}

    public static void main(String[] args) throws Exception {
        WorkerConfig config = WorkerConfig.fromEnvironment();
        Supplier<String> tokens = config.tokenUrl() == null
                ? () -> config.engineToken()
                : new ClientCredentialsTokenSupplier(config);
        AbadaWorkerClient engine = new AbadaWorkerClient(config.engineUrl(), tokens);
        AgentGatewayFactory gateways = new AgentGatewayFactory(config);
        LOG.log(System.Logger.Level.INFO,
                "agent_worker_started worker_id={0} project_id={1} topic=abada:agent",
                config.workerId(), config.projectId().isBlank() ? "(global)" : config.projectId());
        while (!Thread.currentThread().isInterrupted()) {
            try {
                List<LockedExternalTask> tasks = engine.fetchAndLock(config.projectId(), config.workerId(),
                        List.of("abada:agent"),
                        config.lockDuration(), config.maxTasks(), RequestOptions.defaults());
                for (LockedExternalTask task : tasks) process(engine, gateways, config, task);
                if (tasks.isEmpty()) Thread.sleep(config.pollInterval().toMillis());
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            } catch (Exception exception) {
                LOG.log(System.Logger.Level.WARNING,
                        "agent_fetch_failed message={0} retrying_in_ms={1}",
                        safeMessage(exception), config.pollInterval().toMillis());
                try {
                    Thread.sleep(config.pollInterval().toMillis());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    private static void process(AbadaWorkerClient engine, AgentGatewayFactory gateways,
                                WorkerConfig config, LockedExternalTask task) {
        AgentWorkDescriptor work = task.agentWork();
        int configuredAttempts = work == null || work.maxAttempts() == null ? 3 : work.maxAttempts();
        int currentRetries = task.retries() == null ? configuredAttempts : task.retries();
        int attempt = Math.max(1, configuredAttempts - Math.min(currentRetries, configuredAttempts) + 1);
        RequestOptions options = new RequestOptions("agent-" + task.id() + "-attempt-" + attempt,
                task.traceParent(), null);
        try {
            if (work == null || !"abada.agent/v1".equals(work.profileVersion())) {
                throw new IllegalArgumentException("Missing or unsupported abada.agent/v1 descriptor");
            }
            Set<String> requestedTools = work.tools() == null ? Set.of() : Set.copyOf(work.tools());
            if (!config.allowedTools().containsAll(requestedTools)) {
                throw new IllegalArgumentException("Agent requests tools outside the configured allow-list");
            }
            String model = resolveModel(config, work);
            AgentGateway gateway = gateways.gatewayFor(work);
            long startedNanos = System.nanoTime();
            AgentGateway.AgentResult result = gateway.execute(work, task.variables());
            long durationMs = java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(
                    Math.max(0, System.nanoTime() - startedNanos));
            String resultVariable = blankToDefault(work.resultVariable(), task.activityId() + "_result");
            engine.complete(task.id(), config.workerId(), Map.of(resultVariable, result.value()),
                    new AgentAttemptMetadata(model, gateway.provider(), attempt, durationMs,
                            List.copyOf(requestedTools), resultVariable, promptHash(work.prompt()), null,
                            result.confidence()),
                    options);
            long completed = COMPLETED.incrementAndGet();
            LOG.log(System.Logger.Level.INFO,
                    "agent_task_completed task_id={0} activity_id={1} model={2} attempt={3} completed_total={4} failed_total={5}",
                    task.id(), task.activityId(), model, attempt, completed, FAILED.get());
        } catch (Exception exception) {
            int remaining = Math.max(0, Math.min(currentRetries, configuredAttempts) - 1);
            long backoff = work == null || work.retryBackoffMs() == null ? 2_000L : work.retryBackoffMs();
            String model = work == null ? config.defaultModel() : resolveModel(config, work);
            String provider = work == null ? "unknown" : gateways.gatewayFor(work).provider();
            Double achieved = exception instanceof AgentGateway.ConfidenceBelowThresholdException
                    ? ((AgentGateway.ConfidenceBelowThresholdException) exception).confidence() : null;
            engine.fail(task.id(), config.workerId(), safeMessage(exception), exception.getClass().getSimpleName(),
                    remaining, Duration.ofMillis(backoff),
                    new AgentAttemptMetadata(model, provider, attempt, null, List.of(), null, null,
                            exception.getClass().getSimpleName(), achieved),
                    options);
            long failed = FAILED.incrementAndGet();
            LOG.log(System.Logger.Level.WARNING,
                    "agent_task_failed task_id={0} activity_id={1} model={2} attempt={3} retries_remaining={4} completed_total={5} failed_total={6}",
                    task.id(), task.activityId(), model, attempt, remaining, COMPLETED.get(), failed);
        }
    }

    private static String safeMessage(Exception exception) {
        String value = exception.getMessage();
        if (value == null || value.isBlank()) return "Agent execution failed";
        return value.length() > 300 ? value.substring(0, 300) : value;
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
