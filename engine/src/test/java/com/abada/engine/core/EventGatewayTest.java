package com.abada.engine.core;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.persistence.entity.EventSubscriptionEntity;
import com.abada.engine.persistence.entity.JobEntity;
import com.abada.engine.persistence.repository.EventSubscriptionRepository;
import com.abada.engine.persistence.repository.JobRepository;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
import com.abada.engine.util.DatabaseTestHelper;
import com.abada.engine.util.BpmnTestUtils;
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
 * Competing-event semantics of the event-based gateway under the PostgreSQL
 * authority: the event gateway forks one wait state per catch child, the first
 * child to fire advances the instance, and every sibling wait state (message /
 * signal subscription, timer job, sibling token) is cancelled atomically in the
 * same transaction so a late loser can never produce a duplicate transition.
 * Pending races survive restart. Proven for both the native APL
 * {@code event-gateway} node and canonical BPMN {@code eventBasedGateway}.
 */
@Testcontainers
class EventGatewayTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("abada_event_gateway")
                    .withUsername("abada")
                    .withPassword("abada");

    @Test
    void aplEventGatewayMessageWinsRaceAndCancelsSiblingTimer() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            EventManager eventManager = context.getBean(EventManager.class);
            JobScheduler jobScheduler = context.getBean(JobScheduler.class);
            JobRepository jobs = context.getBean(JobRepository.class);

            deploy(engine, "/apl/event-gateway.apl.yaml");
            String correlationKey = UUID.randomUUID().toString();
            var instance = engine.startProcess("event_gateway_race", "alice",
                    Map.of("correlationKey", correlationKey));

            // Both competing children are durable wait states.
            var waiting = engine.getProcessInstanceById(instance.getId());
            assertThat(waiting.isCompleted()).isFalse();
            assertThat(waiting.getActiveTokens()).containsExactlyInAnyOrder("race_e0", "race_e1");

            // The message fires first: the instance advances and the sibling
            // timer job is cancelled in the same transaction.
            eventManager.correlateMessage("FastTrackMessage", correlationKey, Map.of("paymentStatus", "PAID"));
            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isTrue();

            List<JobEntity> timerJobs = inTx(context, () -> jobs.findByProcessInstanceIdAndEventIdInAndStatusIn(
                    instance.getId(), List.of("race_e1"),
                    List.of(JobEntity.Status.AVAILABLE, JobEntity.Status.LEASED, JobEntity.Status.CANCELLED)));
            assertThat(timerJobs).singleElement().satisfies(job ->
                    assertThat(job.getStatus()).isEqualTo(JobEntity.Status.CANCELLED));

            // The cancelled job can never advance the instance a second time.
            JobEntity due = timerJobs.getFirst();
            inTx(context, () -> {
                due.setExecutionTimestamp(Instant.now().minusSeconds(5));
                return jobs.save(due);
            });
            jobScheduler.executeDueJobs();
            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isTrue();
        }
    }

    @Test
    void aplEventGatewayTimerWinsRaceAndConsumesSiblingSubscription() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            EventManager eventManager = context.getBean(EventManager.class);
            JobScheduler jobScheduler = context.getBean(JobScheduler.class);
            JobRepository jobs = context.getBean(JobRepository.class);
            EventSubscriptionRepository subscriptions = context.getBean(EventSubscriptionRepository.class);

            deploy(engine, "/apl/event-gateway.apl.yaml");
            String correlationKey = UUID.randomUUID().toString();
            var instance = engine.startProcess("event_gateway_race", "bob",
                    Map.of("correlationKey", correlationKey));
            assertThat(engine.getProcessInstanceById(instance.getId()).getActiveTokens())
                    .containsExactlyInAnyOrder("race_e0", "race_e1");

            // The timer fires first: the sibling message subscription is
            // consumed atomically with the advancement.
            JobEntity timerJob = inTx(context, () -> jobs.findByProcessInstanceIdAndEventIdInAndStatusIn(
                    instance.getId(), List.of("race_e1"),
                    List.of(JobEntity.Status.AVAILABLE, JobEntity.Status.LEASED)).getFirst());
            inTx(context, () -> {
                timerJob.setExecutionTimestamp(Instant.now().minusSeconds(5));
                return jobs.save(timerJob);
            });
            jobScheduler.executeDueJobs();

            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isTrue();
            assertThat(inTx(context, () -> subscriptions.findByProcessInstanceIdAndActivityIdInAndConsumedAtIsNull(
                    instance.getId(), List.of("race_e0")))).isEmpty();

            // A late message finds no waiting subscription and is a no-op.
            eventManager.correlateMessage("FastTrackMessage", correlationKey, Map.of());
            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isTrue();
        }
    }

    @Test
    void aplEventGatewaySignalCompetesWithTimer() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            EventManager eventManager = context.getBean(EventManager.class);
            JobRepository jobs = context.getBean(JobRepository.class);

            String apl = "version: abada.io/v1\n"
                    + "metadata:\n"
                    + "  name: Signal Race\n"
                    + "flow:\n"
                    + "  entry: apply\n"
                    + "  nodes:\n"
                    + "    - id: apply\n"
                    + "      type: webhook\n"
                    + "      next: race\n"
                    + "    - id: race\n"
                    + "      type: event-gateway\n"
                    + "      events:\n"
                    + "        - type: signal\n"
                    + "          signal: proceed\n"
                    + "          next: done\n"
                    + "        - type: timer\n"
                    + "          duration: PT1S\n"
                    + "          next: done\n"
                    + "    - id: done\n"
                    + "      type: end\n";
            engine.deploy(new java.io.ByteArrayInputStream(apl.getBytes(java.nio.charset.StandardCharsets.UTF_8)));

            var instance = engine.startProcess("signal_race", "carol", Map.of());
            assertThat(engine.getProcessInstanceById(instance.getId()).getActiveTokens())
                    .containsExactlyInAnyOrder("race_e0", "race_e1");

            eventManager.broadcastSignal("proceed", Map.of("go", true));
            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isTrue();
            assertThat(inTx(context, () -> jobs.findByProcessInstanceIdAndEventIdInAndStatusIn(
                    instance.getId(), List.of("race_e1"),
                    List.of(JobEntity.Status.AVAILABLE, JobEntity.Status.LEASED)))).isEmpty();
        }
    }

    @Test
    void aplEventGatewayPendingRaceSurvivesRestart() {
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/apl/event-gateway.apl.yaml");
            instanceId = engine.startProcess("event_gateway_race", "dave",
                    Map.of("correlationKey", "restart-key")).getId();
            assertThat(engine.getProcessInstanceById(instanceId).getActiveTokens())
                    .containsExactlyInAnyOrder("race_e0", "race_e1");
        }

        try (ConfigurableApplicationContext restarted = startApplication()) {
            AbadaEngine engine = restarted.getBean(AbadaEngine.class);
            EventManager eventManager = restarted.getBean(EventManager.class);
            JobRepository jobs = restarted.getBean(JobRepository.class);
            assertThat(restarted.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("event_gateway_race")).isPresent();

            // The pending race is still open after restart: both wait states
            // were durable (subscription + timer job).
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isFalse();
            assertThat(engine.getProcessInstanceById(instanceId).getActiveTokens())
                    .containsExactlyInAnyOrder("race_e0", "race_e1");
            assertThat(inTx(restarted, () -> jobs.findByProcessInstanceIdAndEventIdInAndStatusIn(
                    instanceId, List.of("race_e1"),
                    List.of(JobEntity.Status.AVAILABLE, JobEntity.Status.LEASED)))).singleElement();

            eventManager.correlateMessage("FastTrackMessage", "restart-key", Map.of());
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();
            assertThat(inTx(restarted, () -> jobs.findByProcessInstanceIdAndEventIdInAndStatusIn(
                    instanceId, List.of("race_e1"),
                    List.of(JobEntity.Status.AVAILABLE, JobEntity.Status.LEASED)))).isEmpty();
        }
    }

    @Test
    void bpmnEventBasedGatewayCompetingEventsAreSupported() throws Exception {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            EventManager eventManager = context.getBean(EventManager.class);
            JobRepository jobs = context.getBean(JobRepository.class);
            TaskManager taskManager = context.getBean(TaskManager.class);

            try (InputStream stream = BpmnTestUtils.loadBpmnStream("event-gateway-test.bpmn")) {
                engine.deploy(stream);
            }
            var instance = engine.startProcess("EventGatewayProcess");
            String correlationKey = UUID.randomUUID().toString();
            engine.completeTask(taskManager.getTasksForProcessInstance(instance.getId()).get(0).getId(),
                    "test-user", List.of(), Map.of("correlationKey", correlationKey));

            var waiting = engine.getProcessInstanceById(instance.getId());
            assertThat(waiting.getActiveTokens())
                    .containsExactlyInAnyOrder("CatchEvent_OrderPaid", "CatchEvent_Timeout");

            eventManager.correlateMessage("FastTrackMessage", correlationKey, Map.of("paymentStatus", "PAID"));
            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isTrue();
            assertThat(inTx(context, () -> jobs.findByProcessInstanceIdAndEventIdInAndStatusIn(
                    instance.getId(), List.of("CatchEvent_Timeout"),
                    List.of(JobEntity.Status.AVAILABLE, JobEntity.Status.LEASED)))).isEmpty();
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
