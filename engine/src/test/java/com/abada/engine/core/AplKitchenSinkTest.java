package com.abada.engine.core;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.persistence.entity.JobEntity;
import com.abada.engine.persistence.repository.JobRepository;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
import com.abada.engine.util.DatabaseTestHelper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.InputStream;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The kitchen-sink gate: the APL document
 * {@code engine/src/test/resources/apl/kitchen-sink.apl.yaml} maps
 * {@code docs/features/kitchen-sink-process.md} 1:1 (webhook → Set Variables →
 * parallel fork → script ║ event-gateway (FastTrackMessage or 1h timer) →
 * parallel join → inclusive C/D fork → Task C/D gates → inclusive join →
 * external {@code kitchen-sink-topic} task → end) and proves every claimed
 * runtime feature end to end under the PostgreSQL authority: the in-transaction
 * script, the competing-event race (message wins / timer fallback), both
 * inclusive routes, external worker completion and restart recovery.
 */
@Testcontainers
class AplKitchenSinkTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("abada_kitchen_sink")
                    .withUsername("abada")
                    .withPassword("abada");

    @Test
    void scriptRunsInTransactionAndMessageWinsTheRaceThroughWorkerCompletion() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            EventManager eventManager = context.getBean(EventManager.class);
            ExternalTaskCommandService externalTasks = context.getBean(ExternalTaskCommandService.class);
            TaskManager taskManager = context.getBean(TaskManager.class);

            deploy(engine, "/apl/kitchen-sink.apl.yaml");
            String correlationKey = UUID.randomUUID().toString();
            var instance = engine.startProcess("kitchen_sink_process", "alice",
                    Map.of("correlationKey", correlationKey, "path", "C"));

            // 1. Set Variables approval gate pauses the instance.
            var initialTask = taskManager.getTasksForProcessInstance(instance.getId()).getFirst();
            assertThat(initialTask.getTaskDefinitionKey()).isEqualTo("initialTask");
            engine.completeTask(initialTask.getId(), "test-user", List.of("test-user"),
                    Map.of("correlationKey", correlationKey, "path", "C"));

            // 2. Parallel fork: Path A script ran in-transaction; Path B waits
            // on both competing catch children of the event gateway.
            var afterFork = engine.getProcessInstanceById(instance.getId());
            assertThat(afterFork.isCompleted()).isFalse();
            assertThat(afterFork.getVariable("delegateExecuted")).isEqualTo(true);
            assertThat(afterFork.getActiveTokens()).containsExactlyInAnyOrder("eventRace_e0", "eventRace_e1");

            // 3. The message wins the race: the losing one-hour timer job is
            // cancelled and the parallel join releases the inclusive fork.
            eventManager.correlateMessage("FastTrackMessage", correlationKey, Map.of("paymentStatus", "PAID"));
            var afterRace = engine.getProcessInstanceById(instance.getId());
            assertThat(afterRace.getActiveTokens()).containsExactly("taskC");
            assertThat(inTx(context, () -> context.getBean(JobRepository.class)
                    .findByProcessInstanceIdAndEventIdInAndStatusIn(instance.getId(), List.of("eventRace_e1"),
                            List.of(JobEntity.Status.AVAILABLE, JobEntity.Status.LEASED)))).isEmpty();

            // 4. Inclusive C route: Task C completes into the inclusive join.
            var taskC = taskManager.getTasksForProcessInstance(instance.getId()).getFirst();
            assertThat(taskC.getTaskDefinitionKey()).isEqualTo("taskC");
            engine.completeTask(taskC.getId(), "test-user", List.of("test-user"), Map.of());

            // 5. External automation: a durable kitchen-sink-topic job waits
            // for a worker and completion ends the process.
            var jobs = externalTasks.fetchAndLock(new FetchAndLockRequest(
                    "worker-kitchen-sink", List.of("kitchen-sink-topic"), 10_000L));
            assertThat(jobs).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("externalStep"));
            externalTasks.complete(jobs.getFirst().id(), Map.of("externalTaskDone", true));

            var completed = engine.getProcessInstanceById(instance.getId());
            assertThat(completed.isCompleted()).isTrue();
            assertThat(completed.getVariables())
                    .containsEntry("delegateExecuted", true)
                    .containsEntry("paymentStatus", "PAID")
                    .containsEntry("externalTaskDone", true);
        }
    }

    @Test
    void timerFallbackWinsTheRaceAndRoutesInclusivePathD() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            JobScheduler jobScheduler = context.getBean(JobScheduler.class);
            JobRepository jobs = context.getBean(JobRepository.class);
            ExternalTaskCommandService externalTasks = context.getBean(ExternalTaskCommandService.class);
            TaskManager taskManager = context.getBean(TaskManager.class);

            deploy(engine, "/apl/kitchen-sink.apl.yaml");
            var instance = engine.startProcess("kitchen_sink_process", "bob",
                    Map.of("correlationKey", "timer-key", "path", "D"));
            var initialTask = taskManager.getTasksForProcessInstance(instance.getId()).getFirst();
            engine.completeTask(initialTask.getId(), "test-user", List.of("test-user"),
                    Map.of("correlationKey", "timer-key", "path", "D"));

            // No message arrives: the one-hour timer fires and wins the race.
            JobEntity timerJob = inTx(context, () -> jobs.findByProcessInstanceIdAndEventIdInAndStatusIn(
                    instance.getId(), List.of("eventRace_e1"),
                    List.of(JobEntity.Status.AVAILABLE, JobEntity.Status.LEASED)).getFirst());
            inTx(context, () -> {
                timerJob.setExecutionTimestamp(Instant.now().minusSeconds(5));
                return jobs.save(timerJob);
            });
            jobScheduler.executeDueJobs();

            // The inclusive gateway routed to Task D; the losing message
            // subscription was consumed atomically.
            var afterTimer = engine.getProcessInstanceById(instance.getId());
            assertThat(afterTimer.getActiveTokens()).containsExactly("taskD");
            var taskD = taskManager.getTasksForProcessInstance(instance.getId()).getFirst();
            assertThat(taskD.getTaskDefinitionKey()).isEqualTo("taskD");
            engine.completeTask(taskD.getId(), "test-user", List.of("test-user"), Map.of());

            var jobs2 = externalTasks.fetchAndLock(new FetchAndLockRequest(
                    "worker-kitchen-sink", List.of("kitchen-sink-topic"), 10_000L));
            assertThat(jobs2).singleElement();
            externalTasks.complete(jobs2.getFirst().id(), Map.of("externalTaskDone", true));
            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isTrue();
        }
    }

    @Test
    void recoversTheKitchenSinkRaceAcrossRestart() {
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            TaskManager taskManager = first.getBean(TaskManager.class);
            deploy(engine, "/apl/kitchen-sink.apl.yaml");

            instanceId = engine.startProcess("kitchen_sink_process", "carol",
                    Map.of("correlationKey", "restart-key", "path", "C")).getId();
            var initialTask = taskManager.getTasksForProcessInstance(instanceId).getFirst();
            engine.completeTask(initialTask.getId(), "test-user", List.of("test-user"),
                    Map.of("correlationKey", "restart-key", "path", "C"));
            assertThat(engine.getProcessInstanceById(instanceId).getActiveTokens())
                    .containsExactlyInAnyOrder("eventRace_e0", "eventRace_e1");
        }

        try (ConfigurableApplicationContext restarted = startApplication()) {
            assertThat(restarted.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("kitchen_sink_process")).isPresent();
            AbadaEngine engine = restarted.getBean(AbadaEngine.class);
            EventManager eventManager = restarted.getBean(EventManager.class);
            ExternalTaskCommandService externalTasks = restarted.getBean(ExternalTaskCommandService.class);
            TaskManager taskManager = restarted.getBean(TaskManager.class);

            // The pending race survived the restart: both wait states durable.
            var instance = engine.getProcessInstanceById(instanceId);
            assertThat(instance.isCompleted()).isFalse();
            assertThat(instance.getActiveTokens()).containsExactlyInAnyOrder("eventRace_e0", "eventRace_e1");

            // A post-restart message wins, then the flow runs to completion.
            eventManager.correlateMessage("FastTrackMessage", "restart-key", Map.of());
            assertThat(engine.getProcessInstanceById(instanceId).getActiveTokens()).containsExactly("taskC");
            var taskC = taskManager.getTasksForProcessInstance(instanceId).getFirst();
            assertThat(taskC.getTaskDefinitionKey()).isEqualTo("taskC");
            engine.completeTask(taskC.getId(), "test-user", List.of("test-user"), Map.of());

            var jobs = externalTasks.fetchAndLock(new FetchAndLockRequest(
                    "worker-kitchen-sink", List.of("kitchen-sink-topic"), 10_000L));
            assertThat(jobs).singleElement();
            externalTasks.complete(jobs.getFirst().id(), Map.of("externalTaskDone", true));
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();
        }
    }

    private <T> T inTx(ConfigurableApplicationContext context, Supplier<T> call) {
        return context.getBean(TransactionTemplate.class).execute(status -> call.get());
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
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
    }
}
