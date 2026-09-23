package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.AgentAttemptMetadata;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.dto.ExtendLockRequest;
import com.abada.engine.dto.ExternalTaskFailureDto;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.orm.jpa.EntityManagerHolder;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Durable restart/retry/cancellation evidence for the {@code abada:agent}
 * external worker under the PostgreSQL authority. A leased agent task is
 * ordinary durable work: worker death is served by lease expiry plus
 * SKIP LOCKED re-acquisition, retries keep the task in the pool, and
 * suspension/cancellation reject late completion atomically so the BPMN state
 * machine never advances outside engine commands.
 */
@Testcontainers
class AgentWorkerResilienceTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("abada_agent_resilience")
                    .withUsername("abada")
                    .withPassword("abada");

    @Test
    void expiredLeaseAfterWorkerDeathIsRecoveredWithoutDuplicateTransition() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");
            String instanceId = startToAgentTask(engine);

            ExternalTaskCommandService commands = context.getBean(ExternalTaskCommandService.class);
            var firstLock = commands.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:agent"), 1L));
            assertThat(firstLock).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("notify"));
            String taskId = firstLock.getFirst().id();

            // The worker dies before the microsecond lease elapses without
            // completing: the task stays LOCKED and the instance does not move.
            sleep(200);
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isFalse();
            assertThat(taskState(context, taskId).getStatus()).isEqualTo(ExternalTaskEntity.Status.LOCKED);

            // Lease expiry makes the task re-acquirable by another worker.
            var recovered = commands.fetchAndLock(new FetchAndLockRequest(
                    "worker-2", List.of("abada:agent"), 10_000L));
            assertThat(recovered).singleElement().satisfies(job -> {
                assertThat(job.id()).isEqualTo(taskId);
                assertThat(job.retries()).isEqualTo(4);
            });

            // The surviving worker completes exactly one transition.
            commands.complete(taskId, "worker-2", Map.of("notify_result", Map.of("handled", true, "_confidence", 91)),
                    new AgentAttemptMetadata("gemini-3.6-flash", "google-gemini", 2, 2_345L,
                            List.of("crm.read"), "notify_result", "abc123", null, 91.0));
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();

            // A late completion by the dead worker cannot duplicate the
            // transition: the consumed task is terminal and history keeps one
            // completion event.
            commands.complete(taskId, "worker-1", Map.of("notify_result", Map.of("handled", true, "_confidence", 91)));
            assertThat(completedHistoryCount(context, instanceId)).isEqualTo(1);
            assertThat(taskState(context, taskId).getStatus()).isEqualTo(ExternalTaskEntity.Status.COMPLETED);
        }
    }

    @Test
    void heartbeatCommittedDuringCompletionRequestDoesNotRejectTheResult() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");
            String instanceId = startToAgentTask(engine);

            ExternalTaskCommandService commands = context.getBean(ExternalTaskCommandService.class);
            String taskId = commands.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:agent"), 60_000L)).getFirst().id();

            // Reproduce one HTTP request under open-in-view: the controller's
            // worker access check reads the task into the request-scoped
            // EntityManager, then a heartbeat from another request commits a
            // newer version before the completion command runs.
            EntityManagerFactory factory = context.getBean(EntityManagerFactory.class);
            EntityManager requestScoped = factory.createEntityManager();
            TransactionSynchronizationManager.bindResource(factory, new EntityManagerHolder(requestScoped));
            try {
                context.getBean(ExternalTaskRepository.class).findById(taskId).orElseThrow();
                CompletableFuture.runAsync(() -> commands.extendLock(taskId,
                        new ExtendLockRequest("worker-1", 60_000L))).join();

                commands.complete(taskId, "worker-1",
                        Map.of("notify_result", Map.of("handled", true, "_confidence", 91)));
            } finally {
                TransactionSynchronizationManager.unbindResource(factory);
                requestScoped.close();
            }

            assertThat(taskState(context, taskId).getStatus()).isEqualTo(ExternalTaskEntity.Status.COMPLETED);
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();
            assertThat(completedHistoryCount(context, instanceId)).isEqualTo(1);
        }
    }

    @Test
    void transientFailureWithRetriesLeftReturnsTaskToPoolWithReportedMetadata() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");
            String instanceId = startToAgentTask(engine);

            ExternalTaskCommandService commands = context.getBean(ExternalTaskCommandService.class);
            var locked = commands.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:agent"), 10_000L));
            String taskId = locked.getFirst().id();

            // A bounded transient failure keeps the task in the pool (OPEN) and
            // persists the attempt metadata, while the retry budget drops.
            commands.handleFailure(taskId, new ExternalTaskFailureDto(
                    "worker-1", "LLM gateway returned HTTP 429", "RateLimitException", 3, null,
                    new AgentAttemptMetadata("gpt-5-mini", "openai-compatible", 1, null,
                            List.of(), null, null, "RateLimitException", null)));

            var retried = commands.fetchAndLock(new FetchAndLockRequest(
                    "worker-2", List.of("abada:agent"), 10_000L));
            assertThat(retried).singleElement().satisfies(job -> {
                assertThat(job.id()).isEqualTo(taskId);
                assertThat(job.retries()).isEqualTo(3);
            });
            ExternalTaskEntity task = taskState(context, taskId);
            assertThat(task.getExceptionMessage()).contains("HTTP 429");
            assertThat(task.getAgentMetadataJson()).contains("\"errorType\":\"RateLimitException\"");

            commands.complete(taskId, "worker-2", Map.of("notify_result", Map.of("handled", true, "_confidence", 91)));
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();
            assertThat(completedHistoryCount(context, instanceId)).isEqualTo(1);
        }
    }

    @Test
    void suspensionRejectsLateAgentCompletionAtomicallyAndResumeAllowsIt() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");
            String instanceId = startToAgentTask(engine);

            ExternalTaskCommandService commands = context.getBean(ExternalTaskCommandService.class);
            var locked = commands.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:agent"), 10_000L));
            String taskId = locked.getFirst().id();

            engine.suspendProcessInstance(instanceId, true);

            // The worker finishes late while the instance is suspended: the
            // completion command rolls back atomically — no task state change,
            // no variables, no history, no advancement.
            assertThatThrownBy(() -> commands.complete(taskId, "worker-1", Map.of("notify_result", Map.of("handled", true, "_confidence", 91))))
                    .isInstanceOf(ProcessEngineException.class)
                    .hasMessageContaining("suspended");
            assertThat(taskState(context, taskId).getStatus()).isEqualTo(ExternalTaskEntity.Status.LOCKED);
            assertThat(taskState(context, taskId).getWorkerId()).isEqualTo("worker-1");
            assertThat(taskState(context, taskId).getLockExpirationTime()).isNotNull();
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isFalse();
            assertThat(completedHistoryCount(context, instanceId)).isZero();

            // Deterministic late completion: resume re-admits the same worker
            // completion command, and it advances exactly once.
            engine.suspendProcessInstance(instanceId, false);
            commands.complete(taskId, "worker-1", Map.of("notify_result", Map.of("handled", true, "_confidence", 91)));
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();
            assertThat(completedHistoryCount(context, instanceId)).isEqualTo(1);
        }
    }

    @Test
    void cancellationRejectsLateAgentCompletionAndKeepsTerminalState() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");
            String instanceId = startToAgentTask(engine);

            ExternalTaskCommandService commands = context.getBean(ExternalTaskCommandService.class);
            var locked = commands.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:agent"), 10_000L));
            String taskId = locked.getFirst().id();

            engine.cancelProcessInstance(instanceId, "lead rejected upstream");

            assertThatThrownBy(() -> commands.complete(taskId, "worker-1", Map.of("notify_result", Map.of("handled", true, "_confidence", 91))))
                    .isInstanceOf(ProcessEngineException.class)
                    .hasMessageContaining("terminal state");
            assertThat(taskState(context, taskId).getStatus()).isEqualTo(ExternalTaskEntity.Status.LOCKED);
            assertThat(engine.getProcessInstanceById(instanceId).getStatus()).isEqualTo(ProcessStatus.CANCELLED);
            assertThat(completedHistoryCount(context, instanceId)).isZero();

            // Even after the lease passes to a new worker, a completion can
            // never resurrect the cancelled instance: rejection stays atomic
            // and idempotent, and the terminal state is preserved.
            expireLease(context, taskId);
            var reclaimed = commands.fetchAndLock(new FetchAndLockRequest(
                    "worker-2", List.of("abada:agent"), 10_000L));
            assertThat(reclaimed).singleElement();
            assertThatThrownBy(() -> commands.complete(reclaimed.getFirst().id(), "worker-2",
                    Map.of("notify_result", Map.of("handled", true, "_confidence", 91))))
                    .isInstanceOf(ProcessEngineException.class)
                    .hasMessageContaining("terminal state");
            assertThat(engine.getProcessInstanceById(instanceId).getStatus()).isEqualTo(ProcessStatus.CANCELLED);
            assertThat(completedHistoryCount(context, instanceId)).isZero();
        }
    }

    @Test
    void unexpiredLeaseSurvivesEngineRestartWithoutDuplicateDispatch() {
        String taskId;
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");
            instanceId = startToAgentTask(engine);

            var locked = first.getBean(ExternalTaskCommandService.class).fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:agent"), 3_600_000L));
            taskId = locked.getFirst().id();
        }

        try (ConfigurableApplicationContext restarted = startApplication()) {
            ExternalTaskCommandService commands = restarted.getBean(ExternalTaskCommandService.class);

            // The lease is still valid, so no other worker may dispatch the
            // task after the restart — no duplicate in-flight work.
            assertThat(commands.fetchAndLock(new FetchAndLockRequest(
                    "worker-2", List.of("abada:agent"), 10_000L))).isEmpty();

            // The original worker, still holding its live lease, completes the
            // leased task exactly once.
            commands.complete(taskId, "worker-1", Map.of("notify_result", Map.of("handled", true, "_confidence", 91)));
            AbadaEngine engine = restarted.getBean(AbadaEngine.class);
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();
            assertThat(completedHistoryCount(restarted, instanceId)).isEqualTo(1);
            assertThat(restarted.getBean(ExternalTaskRepository.class).findById(taskId))
                    .get()
                    .extracting(ExternalTaskEntity::getStatus)
                    .isEqualTo(ExternalTaskEntity.Status.COMPLETED);
        }
    }

    @Test
    void leaseExpiryAfterRestartReleasesLeasedWorkToAnotherWorker() {
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");
            instanceId = startToAgentTask(engine);

            // Lock with a microsecond lease: the worker dies with the context
            // and the lease elapses while the engine is down.
            assertThat(first.getBean(ExternalTaskCommandService.class).fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:agent"), 1L)))
                    .singleElement();
        }

        try (ConfigurableApplicationContext restarted = startApplication()) {
            ExternalTaskCommandService commands = restarted.getBean(ExternalTaskCommandService.class);
            var recovered = commands.fetchAndLock(new FetchAndLockRequest(
                    "worker-2", List.of("abada:agent"), 10_000L));
            assertThat(recovered).singleElement();

            commands.complete(recovered.getFirst().id(), "worker-2", Map.of("notify_result", Map.of("handled", true, "_confidence", 91)));
            AbadaEngine engine = restarted.getBean(AbadaEngine.class);
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();
            assertThat(completedHistoryCount(restarted, instanceId)).isEqualTo(1);
        }
    }

    private String startToAgentTask(AbadaEngine engine) {
        String instanceId = engine.startProcess("candidate_review", "alice", Map.of("score", 88)).getId();
        var pending = engine.getTaskManager().getVisibleTasksForUser("carol", List.of("recruiters"));
        var gateTask = pending.stream()
                .filter(task -> task.getProcessInstanceId().equals(instanceId))
                .findFirst().orElseThrow();
        engine.completeTask(gateTask.getId(), "carol", List.of("recruiters"), Map.of("approved", true));
        return instanceId;
    }

    private ExternalTaskEntity taskState(ConfigurableApplicationContext context, String taskId) {
        return context.getBean(ExternalTaskRepository.class).findById(taskId).orElseThrow();
    }

    /** Simulates the passage of time for an unexpired lease without sleeping. */
    private void expireLease(ConfigurableApplicationContext context, String taskId) {
        ExternalTaskRepository repository = context.getBean(ExternalTaskRepository.class);
        ExternalTaskEntity task = taskState(context, taskId);
        task.setLockExpirationTime(java.time.Instant.now().minusSeconds(1));
        repository.save(task);
    }

    private long completedHistoryCount(ConfigurableApplicationContext context, String instanceId) {
        List<ActivityHistoryEntity> history = context.getBean(ActivityHistoryRepository.class)
                .findByProcessInstanceIdOrderByOccurredAtAsc(instanceId);
        return history.stream()
                .filter(event -> "EXTERNAL_TASK_COMPLETED".equals(event.getEventType()))
                .count();
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError("interrupted", interrupted);
        }
    }

    private void deploy(AbadaEngine engine, String resource) {
        try (InputStream stream = getClass().getResourceAsStream(resource)) {
            assertThat(stream).as(resource).isNotNull();
            engine.deploy(stream);
        } catch (Exception exception) {
            throw new AssertionError("Could not deploy " + resource, exception);
        }
    }

    private ConfigurableApplicationContext startApplication() {
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(
                        context,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=3",
                        "spring.datasource.hikari.minimum-idle=1",
                        "spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect",
                        "spring.jpa.hibernate.ddl-auto=validate",
                        "spring.jpa.open-in-view=false",
                        "spring.flyway.enabled=true",
                        "spring.task.scheduling.enabled=false",
                        "abada.outbox.dispatcher.enabled=false",
                        "abada.security.mode=disabled",
                        "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                        "abada.insight.llm.api-key=test-key",
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
    }
}