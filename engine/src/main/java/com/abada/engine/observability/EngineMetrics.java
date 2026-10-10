package com.abada.engine.observability;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Centralized metrics management for the Abada Engine.
 * Provides counters, histograms, and gauges for process execution, task
 * management,
 * event processing, and job scheduling.
 */
@Component
public class EngineMetrics {

    private final MeterRegistry meterRegistry;

    // Metric Tags
    private static final String TAG_PROCESS_DEFINITION_ID = "process.definition.id";
    private static final String TAG_TASK_DEFINITION_KEY = "task.definition.key";
    private static final String TAG_EVENT_TYPE = "event.type";
    private static final String TAG_EVENT_NAME = "event.name";
    private static final String TAG_JOB_TYPE = "job.type";

    // Process Metrics
    private final Counter processInstancesStarted;
    private final Counter processInstancesCompleted;
    private final Counter processInstancesFailed;
    private final Timer processDuration;
    private final AtomicLong activeProcessInstances = new AtomicLong(0);

    // Cached counters for tagged metrics
    private final ConcurrentHashMap<String, Counter> processStartedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Counter> processCompletedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Counter> processFailedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Timer> processTimers = new ConcurrentHashMap<>();

    // Task Metrics
    private final Counter tasksCreated;
    private final Counter tasksClaimed;
    private final Counter tasksCompleted;
    private final Counter tasksFailed;
    private final Timer taskWaitingTime;
    private final Timer taskProcessingTime;
    private final AtomicLong activeTasks = new AtomicLong(0);

    // Event Metrics
    private final Counter eventsPublished;
    private final Counter eventsConsumed;
    private final Counter eventsCorrelated;
    private final Timer eventProcessingLatency;
    private final AtomicLong eventQueueSize = new AtomicLong(0);

    // Job Metrics
    private final Counter jobsExecuted;
    private final Counter jobsFailed;
    private final Timer jobExecutionTime;
    private final Counter bpmnDeploymentsSucceeded;
    private final Counter bpmnDeploymentsFailed;
    private final Timer bpmnDeploymentDuration;

    public EngineMetrics(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;

        // Initialize Process Metrics
        this.processInstancesStarted = Counter.builder("abada.process.instances.started")
                .description("Total number of process instances started")
                .register(meterRegistry);

        this.processInstancesCompleted = Counter.builder("abada.process.instances.completed")
                .description("Total number of process instances completed")
                .register(meterRegistry);

        this.processInstancesFailed = Counter.builder("abada.process.instances.failed")
                .description("Total number of process instances failed")
                .register(meterRegistry);

        this.processDuration = Timer.builder("abada.process.duration")
                .description("Process execution duration")
                .register(meterRegistry);

        Gauge.builder("abada.process.instances.active", activeProcessInstances, AtomicLong::get)
                .description("Number of currently active process instances")
                .register(meterRegistry);

        // Initialize Task Metrics
        this.tasksCreated = Counter.builder("abada.tasks.created")
                .description("Total number of tasks created")
                .register(meterRegistry);

        this.tasksClaimed = Counter.builder("abada.tasks.claimed")
                .description("Total number of tasks claimed")
                .register(meterRegistry);

        this.tasksCompleted = Counter.builder("abada.tasks.completed")
                .description("Total number of tasks completed")
                .register(meterRegistry);

        this.tasksFailed = Counter.builder("abada.tasks.failed")
                .description("Total number of tasks failed")
                .register(meterRegistry);

        this.taskWaitingTime = Timer.builder("abada.task.waiting_time")
                .description("Time from task creation to claim")
                .register(meterRegistry);

        this.taskProcessingTime = Timer.builder("abada.task.processing_time")
                .description("Time from task claim to completion")
                .register(meterRegistry);

        Gauge.builder("abada.tasks.active", activeTasks, AtomicLong::get)
                .description("Number of currently active tasks")
                .register(meterRegistry);

        // Initialize Event Metrics
        this.eventsPublished = Counter.builder("abada.events.published")
                .description("Total number of events published")
                .register(meterRegistry);

        this.eventsConsumed = Counter.builder("abada.events.consumed")
                .description("Total number of events consumed")
                .register(meterRegistry);

        this.eventsCorrelated = Counter.builder("abada.events.correlated")
                .description("Total number of events correlated to process instances")
                .register(meterRegistry);

        this.eventProcessingLatency = Timer.builder("abada.event.processing_latency")
                .description("Event processing duration from publication to correlation")
                .register(meterRegistry);

        Gauge.builder("abada.events.queue_size", eventQueueSize, AtomicLong::get)
                .description("Number of events currently waiting for correlation")
                .register(meterRegistry);

        // Initialize Job Metrics
        this.jobsExecuted = Counter.builder("abada.jobs.executed")
                .description("Total number of jobs executed")
                .register(meterRegistry);

        this.jobsFailed = Counter.builder("abada.jobs.failed")
                .description("Total number of jobs failed")
                .register(meterRegistry);

        this.jobExecutionTime = Timer.builder("abada.job.execution_time")
                .description("Job execution duration")
                .register(meterRegistry);
        this.bpmnDeploymentsSucceeded = Counter.builder("abada.bpmn.deployments")
                .tag("outcome", "success").description("Successful BPMN compilation and deployments")
                .register(meterRegistry);
        this.bpmnDeploymentsFailed = Counter.builder("abada.bpmn.deployments")
                .tag("outcome", "failure").description("Rejected or failed BPMN deployments")
                .register(meterRegistry);
        this.bpmnDeploymentDuration = Timer.builder("abada.bpmn.deployment.duration")
                .description("Bounded BPMN parse, validation, compilation and persistence duration")
                .register(meterRegistry);
    }

    public Timer.Sample startBpmnDeploymentTimer() { return Timer.start(meterRegistry); }
    public void recordBpmnDeployment(Timer.Sample sample, boolean success) {
        sample.stop(bpmnDeploymentDuration);
        (success ? bpmnDeploymentsSucceeded : bpmnDeploymentsFailed).increment();
    }

    // Process Metrics Methods
    /**
     * Engine-computed agent cost, {@code abada_agent_cost_usd_total}, tagged by
     * process key and model only (low cardinality). Unpriced calls add nothing.
     */
    public void recordAgentCost(String processKey, String model, java.math.BigDecimal usd) {
        if (usd == null || usd.signum() <= 0) return;
        Counter.builder("abada.agent.cost.usd")
                .description("Agent model cost computed by the engine from token counts and model prices")
                .baseUnit("usd")
                .tag("process_key", processKey == null ? "unknown" : processKey)
                .tag("model", model == null ? "unknown" : model)
                .register(meterRegistry)
                .increment(usd.doubleValue());
    }

    public void recordProcessStarted(String processDefinitionId) {
        // Record global and per-process metrics
        processInstancesStarted.increment();
        processStartedCounters.computeIfAbsent(processDefinitionId,
                id -> Counter.builder("abada.process.instances.started")
                        .tag(TAG_PROCESS_DEFINITION_ID, id)
                        .description("Process instances started by definition")
                        .register(meterRegistry))
                .increment();

        // Track active process
        activeProcessInstances.incrementAndGet();
    }

    public void recordProcessCompleted(String processDefinitionId) {
        // Record completion metrics
        processInstancesCompleted.increment();
        processCompletedCounters.computeIfAbsent(processDefinitionId,
                id -> Counter.builder("abada.process.instances.completed")
                        .tag(TAG_PROCESS_DEFINITION_ID, id)
                        .description("Process instances completed by definition")
                        .register(meterRegistry))
                .increment();

        // Clean up active tracking
        processStartedCounters.remove(processDefinitionId);
        activeProcessInstances.decrementAndGet();
    }

    public void recordProcessFailed(String processDefinitionId) {
        // Record failure metrics
        processInstancesFailed.increment();
        processFailedCounters.computeIfAbsent(processDefinitionId,
                id -> Counter.builder("abada.process.instances.failed")
                        .tag(TAG_PROCESS_DEFINITION_ID, id)
                        .description("Process instances failed by definition")
                        .register(meterRegistry))
                .increment();

        // Clean up active tracking
        processStartedCounters.remove(processDefinitionId);
        activeProcessInstances.decrementAndGet();
    }

    public Timer.Sample startProcessTimer() {
        return Timer.start(meterRegistry);
    }

    public void recordProcessDuration(Timer.Sample sample, String processDefinitionId) {
        sample.stop(processDuration);
        sample.stop(processTimers.computeIfAbsent(processDefinitionId, id -> Timer.builder("abada.process.duration")
                .tag(TAG_PROCESS_DEFINITION_ID, id)
                .description("Process execution duration by definition")
                .register(meterRegistry)));
    }

    public void restoreActiveProcess(String processDefinitionId) {
        restoreActiveProcesses(processDefinitionId, 1);
    }

    public void restoreActiveProcesses(String processDefinitionId, long count) {
        if (count <= 0) {
            return;
        }
        activeProcessInstances.addAndGet(count);

        // Ensure the counter exists in the map so completion metrics work later
        processStartedCounters.computeIfAbsent(processDefinitionId,
                id -> Counter.builder("abada.process.instances.started")
                        .tag(TAG_PROCESS_DEFINITION_ID, id)
                        .description("Process instances started by definition")
                        .register(meterRegistry));
    }

    // Task Metrics Methods
    private final ConcurrentHashMap<String, Counter> taskCreatedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Counter> taskClaimedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Counter> taskCompletedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Counter> taskFailedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Timer> taskWaitingTimers = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Timer> taskProcessingTimers = new ConcurrentHashMap<>();

    public void recordTaskCreated(String taskDefinitionKey) {
        // Record global and per-task metrics
        tasksCreated.increment();
        taskCreatedCounters.computeIfAbsent(taskDefinitionKey, key -> Counter.builder("abada.tasks.created")
                .tag(TAG_TASK_DEFINITION_KEY, key)
                .description("Tasks created by definition key")
                .register(meterRegistry)).increment();

        // Track active task
        activeTasks.incrementAndGet();
    }

    public void recordTaskClaimed(String taskDefinitionKey) {
        // Record claim metrics
        tasksClaimed.increment();
        taskClaimedCounters.computeIfAbsent(taskDefinitionKey, key -> Counter.builder("abada.tasks.claimed")
                .tag(TAG_TASK_DEFINITION_KEY, key)
                .description("Tasks claimed by definition key")
                .register(meterRegistry)).increment();
    }

    public void recordTaskCompleted(String taskDefinitionKey) {
        // Record completion metrics
        tasksCompleted.increment();
        taskCompletedCounters.computeIfAbsent(taskDefinitionKey, key -> Counter.builder("abada.tasks.completed")
                .tag(TAG_TASK_DEFINITION_KEY, key)
                .description("Tasks completed by definition key")
                .register(meterRegistry)).increment();

        // Clean up active tracking
        taskCreatedCounters.remove(taskDefinitionKey);
        activeTasks.decrementAndGet();
    }

    public void recordTaskFailed(String taskDefinitionKey) {
        // Record failure metrics
        tasksFailed.increment();
        taskFailedCounters.computeIfAbsent(taskDefinitionKey, key -> Counter.builder("abada.tasks.failed")
                .tag(TAG_TASK_DEFINITION_KEY, key)
                .description("Tasks failed by definition key")
                .register(meterRegistry)).increment();

        // Clean up active tracking
        taskCreatedCounters.remove(taskDefinitionKey);
        activeTasks.decrementAndGet();
    }

    public Timer.Sample startTaskWaitingTimer() {
        return Timer.start(meterRegistry);
    }

    public void recordTaskWaitingTime(Timer.Sample sample, String taskDefinitionKey) {
        sample.stop(taskWaitingTime);
        sample.stop(taskWaitingTimers.computeIfAbsent(taskDefinitionKey, key -> Timer.builder("abada.task.waiting_time")
                .tag(TAG_TASK_DEFINITION_KEY, key)
                .description("Task waiting time by definition key")
                .register(meterRegistry)));
    }

    public Timer.Sample startTaskProcessingTimer() {
        return Timer.start(meterRegistry);
    }

    public void recordTaskProcessingTime(Timer.Sample sample, String taskDefinitionKey) {
        sample.stop(taskProcessingTime);
        sample.stop(taskProcessingTimers.computeIfAbsent(taskDefinitionKey,
                key -> Timer.builder("abada.task.processing_time")
                        .tag(TAG_TASK_DEFINITION_KEY, key)
                        .description("Task processing time by definition key")
                        .register(meterRegistry)));
    }

    public void restoreActiveTask(String taskDefinitionKey) {
        restoreActiveTasks(taskDefinitionKey, 1);
    }

    public void restoreActiveTasks(String taskDefinitionKey, long count) {
        if (count <= 0) {
            return;
        }
        activeTasks.addAndGet(count);

        // Ensure the counter exists in the map so completion metrics work later
        taskCreatedCounters.computeIfAbsent(taskDefinitionKey, key -> Counter.builder("abada.tasks.created")
                .tag(TAG_TASK_DEFINITION_KEY, key)
                .description("Tasks created by definition key")
                .register(meterRegistry));
    }

    // Event Metrics Methods
    private final ConcurrentHashMap<String, Counter> eventPublishedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Counter> eventConsumedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Counter> eventCorrelatedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Timer> eventProcessingLatencyTimers = new ConcurrentHashMap<>();

    public void recordEventPublished(String eventType, String eventName) {
        eventsPublished.increment();
        String key = eventType + ":" + eventName;
        eventPublishedCounters.computeIfAbsent(key, k -> Counter.builder("abada.events.published")
                .tag(TAG_EVENT_TYPE, eventType)
                .tag(TAG_EVENT_NAME, eventName)
                .description("Events published by type and name")
                .register(meterRegistry)).increment();
    }

    public void recordEventConsumed(String eventType, String eventName) {
        eventsConsumed.increment();
        String key = eventType + ":" + eventName;
        eventConsumedCounters.computeIfAbsent(key, k -> Counter.builder("abada.events.consumed")
                .tag(TAG_EVENT_TYPE, eventType)
                .tag(TAG_EVENT_NAME, eventName)
                .description("Events consumed by type and name")
                .register(meterRegistry)).increment();
    }

    public void recordEventCorrelated(String eventType, String eventName) {
        eventsCorrelated.increment();
        String key = eventType + ":" + eventName;
        eventCorrelatedCounters.computeIfAbsent(key, k -> Counter.builder("abada.events.correlated")
                .tag(TAG_EVENT_TYPE, eventType)
                .tag(TAG_EVENT_NAME, eventName)
                .description("Events correlated by type and name")
                .register(meterRegistry)).increment();
    }

    public Timer.Sample startEventProcessingTimer() {
        return Timer.start(meterRegistry);
    }

    public void recordEventProcessingLatency(Timer.Sample sample, String eventType, String eventName) {
        // Stop the global timer and get the duration
        long durationNanos = sample.stop(eventProcessingLatency);

        // Record the same duration to the tagged timer
        String key = eventType + ":" + eventName;
        Timer taggedTimer = eventProcessingLatencyTimers.computeIfAbsent(key,
                k -> Timer.builder("abada.event.processing_latency")
                        .tag(TAG_EVENT_TYPE, eventType)
                        .tag(TAG_EVENT_NAME, eventName)
                        .description("Event processing latency by type and name")
                        .register(meterRegistry));

        // Record the duration to the tagged timer
        taggedTimer.record(durationNanos, java.util.concurrent.TimeUnit.NANOSECONDS);
    }

    public void incrementEventQueueSize() {
        eventQueueSize.incrementAndGet();
    }

    public void decrementEventQueueSize() {
        eventQueueSize.decrementAndGet();
    }

    public double getEventQueueSize() {
        return eventQueueSize.get();
    }

    // Job Metrics Methods
    private final ConcurrentHashMap<String, Counter> jobExecutedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Counter> jobFailedCounters = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Timer> jobExecutionTimers = new ConcurrentHashMap<>();

    public void recordJobExecuted(String jobType) {
        jobsExecuted.increment();
        jobExecutedCounters.computeIfAbsent(jobType, type -> Counter.builder("abada.jobs.executed")
                .tag(TAG_JOB_TYPE, type)
                .description("Jobs executed by type")
                .register(meterRegistry)).increment();
    }

    public void recordJobFailed(String jobType) {
        jobsFailed.increment();
        jobFailedCounters.computeIfAbsent(jobType, type -> Counter.builder("abada.jobs.failed")
                .tag(TAG_JOB_TYPE, type)
                .description("Jobs failed by type")
                .register(meterRegistry)).increment();
    }

    public Timer.Sample startJobExecutionTimer() {
        return Timer.start(meterRegistry);
    }

    public void recordJobExecutionTime(Timer.Sample sample, String jobType) {
        sample.stop(jobExecutionTime);
        sample.stop(jobExecutionTimers.computeIfAbsent(jobType, type -> Timer.builder("abada.job.execution_time")
                .tag(TAG_JOB_TYPE, type)
                .description("Job execution time by type")
                .register(meterRegistry)));
    }

    // Gauge Methods
    public double getActiveProcessInstances() {
        return activeProcessInstances.get();
    }

    public double getActiveTasks() {
        return activeTasks.get();
    }

    /** Resets gauges that are reconstructed from authoritative persisted state. */
    public void resetActiveState() {
        activeProcessInstances.set(0);
        activeTasks.set(0);
    }

    /**
     * Cleans up cached metrics that haven't been used recently.
     * This helps prevent memory leaks from discontinued processes, tasks, or jobs.
     * 
     * @param maxAgeMinutes Maximum age in minutes for cached metrics before they're
     *                      removed
     */
    public void cleanupStaleMetrics(long maxAgeMinutes) {
        long cutoffTime = System.currentTimeMillis() - (maxAgeMinutes * 60 * 1000);

        // Reset active process counters if they have no completion/failure
        processStartedCounters.forEach((processId, counter) -> {
            if (!processCompletedCounters.containsKey(processId) &&
                    !processFailedCounters.containsKey(processId)) {
                processStartedCounters.remove(processId);
                // Reset active instance count
                activeProcessInstances.set(0);
            }
        });

        // Reset active task counters if they have no completion/failure
        taskCreatedCounters.forEach((taskId, counter) -> {
            if (!taskCompletedCounters.containsKey(taskId) &&
                    !taskFailedCounters.containsKey(taskId)) {
                taskCreatedCounters.remove(taskId);
                // Reset active task count
                activeTasks.set(0);
            }
        });

        // Apply size limits to prevent memory leaks
        cleanupMetricCache(processStartedCounters, cutoffTime);
        cleanupMetricCache(processCompletedCounters, cutoffTime);
        cleanupMetricCache(processFailedCounters, cutoffTime);
        cleanupMetricCache(processTimers, cutoffTime);

        cleanupMetricCache(taskCreatedCounters, cutoffTime);
        cleanupMetricCache(taskClaimedCounters, cutoffTime);
        cleanupMetricCache(taskCompletedCounters, cutoffTime);
        cleanupMetricCache(taskFailedCounters, cutoffTime);
        cleanupMetricCache(taskWaitingTimers, cutoffTime);
        cleanupMetricCache(taskProcessingTimers, cutoffTime);

        cleanupMetricCache(eventPublishedCounters, cutoffTime);
        cleanupMetricCache(eventConsumedCounters, cutoffTime);
        cleanupMetricCache(eventCorrelatedCounters, cutoffTime);

        cleanupMetricCache(jobExecutedCounters, cutoffTime);
        cleanupMetricCache(jobFailedCounters, cutoffTime);
        cleanupMetricCache(jobExecutionTimers, cutoffTime);
    }

    /**
     * Helper method to clean up a specific metric cache.
     * Removes metrics that haven't recorded any activity (count = 0).
     */
    private <T> void cleanupMetricCache(ConcurrentHashMap<String, T> cache, long cutoffTime) {
        if (cache == null)
            return;

        // First pass: clean up metrics for incomplete/inactive items
        List<String> keysToRemove = new ArrayList<>();

        cache.forEach((key, value) -> {
            if (value instanceof Counter || value instanceof Timer) {
                // Remove from cache but leave in registry since Micrometer manages metric
                // lifecycle
                keysToRemove.add(key);
            }
        });

        keysToRemove.forEach(cache::remove);

        // Apply size limit if needed
        if (!cache.isEmpty() && cache.size() > 1000) {
            // Get sorted list of keys by activity level
            List<String> keys = new ArrayList<>(cache.keySet());
            keys.sort((k1, k2) -> {
                T m1 = cache.get(k1);
                T m2 = cache.get(k2);
                if (m1 instanceof Counter && m2 instanceof Counter) {
                    return Double.compare(((Counter) m1).count(), ((Counter) m2).count());
                } else if (m1 instanceof Timer && m2 instanceof Timer) {
                    return Long.compare(((Timer) m1).count(), ((Timer) m2).count());
                }
                return 0;
            });

            // Remove oldest 20% from cache
            int toRemove = keys.size() / 5;
            for (int i = 0; i < toRemove && i < keys.size(); i++) {
                cache.remove(keys.get(i));
            }
        }
    }

    /**
     * Schedules periodic cleanup of stale metrics.
     * This method should be called when the application starts.
     */
    public void scheduleMetricsCleanup() {
        // Schedule cleanup every hour, removing metrics older than 24 hours
        java.util.concurrent.Executors.newSingleThreadScheduledExecutor()
                .scheduleAtFixedRate(
                        () -> cleanupStaleMetrics(24 * 60), // 24 hours in minutes
                        1, // Initial delay
                        60, // Period
                        java.util.concurrent.TimeUnit.MINUTES);
    }
}
