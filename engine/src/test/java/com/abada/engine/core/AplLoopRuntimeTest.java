package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.CockpitController;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.IncidentDTO;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Bounded loops under the PostgreSQL authority: the rework loop (draft → review
 * → rejected → draft again) repeats at most three times, survives an engine
 * restart mid-loop, and on exhaustion routes to on_exhausted or opens an
 * incident. Waits inside a loop (message, timer) are re-armed every pass.
 */
@Testcontainers
class AplLoopRuntimeTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_loops").withUsername("abada").withPassword("abada");

    @Test
    void reworkLoopRepeatsUntilApprovedAndSurvivesARestartMidLoop() {
        String id;
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployResource(engine, "/apl/rework-loop.apl.yaml");
            id = engine.startProcess("rework_loop", "alice", Map.of()).getId();

            draftAndReview(context, id, false);
            assertThat(engine.getProcessInstanceById(id).getVariables()).containsEntry("draft_iteration", 2);
        }

        // The engine is killed between the second draft being requested and done.
        try (ConfigurableApplicationContext context = startApplication()) {
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            assertThat(engine.getProcessInstanceById(id).getActiveTokens()).containsExactly("draft");

            draftAndReview(context, id, true);

            ProcessInstance done = engine.getProcessInstanceById(id);
            assertThat(done.isCompleted()).isTrue();
            assertThat(done.getVariables()).containsEntry("draft_iteration", 2).containsEntry("approved", true);
        }
    }

    @Test
    void theThirdRejectionRoutesToOnExhausted() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployResource(engine, "/apl/rework-loop.apl.yaml");
            String id = engine.startProcess("rework_loop", "alice", Map.of()).getId();

            for (int pass = 1; pass <= 3; pass++) {
                assertThat(engine.getProcessInstanceById(id).getVariables()).containsEntry("draft_iteration", pass);
                draftAndReview(context, id, false);
            }

            ProcessInstance escalated = engine.getProcessInstanceById(id);
            assertThat(escalated.getActiveTokens()).containsExactly("escalate");
            assertThat(escalated.getVariables()).containsEntry("draft_iteration", 3);
            assertThat(context.getBean(CockpitController.class).getIncidents(id)).isEmpty();
        }
    }

    @Test
    void anExhaustedLoopWithoutRouteOpensAnIncidentThatCancellingResolves() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploySource(engine, """
                    version: abada.io/v1
                    metadata: { key: rework_incident, name: Rework incident }
                    flow:
                      entry: request
                      nodes:
                        - { id: request, type: webhook, next: draft }
                        - id: draft
                          type: engine-task
                          service: rework-draft
                          loop: { max_iterations: 2 }
                          next: review
                        - { id: review, type: human-input, assignees: [reviewers], next: decide }
                        - id: decide
                          type: condition
                          rules:
                            - if: "${approved == true}"
                              then: done
                            - else: draft
                        - { id: done, type: end }
                    """);
            String id = engine.startProcess("rework_incident", "alice", Map.of()).getId();
            draftAndReview(context, id, false);
            draftAndReview(context, id, false);

            ProcessInstance stuck = engine.getProcessInstanceById(id);
            assertThat(stuck.isCompleted()).isFalse();
            assertThat(stuck.getTokens()).anySatisfy(token -> {
                assertThat(token.state()).isEqualTo(ProcessToken.State.INCIDENT);
                assertThat(token.activityId()).isEqualTo("draft");
            });
            List<IncidentDTO> incidents = context.getBean(CockpitController.class).getIncidents(id);
            assertThat(incidents).singleElement().satisfies(incident -> {
                assertThat(incident.type()).isEqualTo("LOOP_EXHAUSTED");
                assertThat(incident.activityId()).isEqualTo("draft");
                assertThat(incident.resolvedAt()).isNull();
                assertThat(incident.message()).contains("max_iterations 2");
            });

            engine.cancelProcessInstance(id, "operator stopped the rework");

            assertThat(context.getBean(CockpitController.class).getIncidents(id)).singleElement()
                    .satisfies(incident -> {
                        assertThat(incident.resolvedAt()).isNotNull();
                        assertThat(incident.resolution()).isEqualTo("INSTANCE_CANCELLED");
                    });
        }
    }

    @Test
    void aMessageWaitInsideALoopIsSubscribedAgainOnEveryPass() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            EventManager events = context.getBean(EventManager.class);
            deploySource(engine, """
                    version: abada.io/v1
                    metadata: { key: ping_loop, name: Ping loop }
                    flow:
                      entry: start
                      nodes:
                        - { id: start, type: webhook, next: wait }
                        - id: wait
                          type: message-catch
                          message: Ping
                          loop: { max_iterations: 5 }
                          next: again
                        - id: again
                          type: condition
                          rules:
                            - if: "${wait_iteration < 3}"
                              then: wait
                            - else: done
                        - { id: done, type: end }
                    """);
            String id = engine.startProcess("ping_loop", "alice", Map.of("correlationKey", "p-1")).getId();

            for (int ping = 1; ping <= 3; ping++) {
                assertThat(engine.getProcessInstanceById(id).isCompleted()).as("before ping " + ping).isFalse();
                events.correlateMessage("Ping", "p-1", Map.of());
            }

            assertThat(engine.getProcessInstanceById(id).isCompleted()).isTrue();
        }
    }

    @Test
    void aTimerThatLoopsBackToItselfIsScheduledAgain() throws Exception {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            JobScheduler jobs = context.getBean(JobScheduler.class);
            deploySource(engine, """
                    version: abada.io/v1
                    metadata: { key: tick_loop, name: Tick loop }
                    flow:
                      entry: start
                      nodes:
                        - { id: start, type: webhook, next: tick }
                        - id: tick
                          type: timer
                          duration: PT0S
                          loop: { max_iterations: 2, on_exhausted: done }
                          next: tick
                        - { id: done, type: end }
                    """);
            String id = engine.startProcess("tick_loop", "alice", Map.of()).getId();

            for (int tick = 1; tick <= 2; tick++) {
                assertThat(engine.getProcessInstanceById(id).getActiveTokens()).as("tick " + tick)
                        .containsExactly("tick");
                Thread.sleep(50);
                jobs.executeDueJobs();
            }

            ProcessInstance done = engine.getProcessInstanceById(id);
            assertThat(done.isCompleted()).isTrue();
            assertThat(done.getVariables()).containsEntry("tick_iteration", 2);
        }
    }

    /** Completes the draft work item, then the review with the given decision. */
    private static void draftAndReview(ConfigurableApplicationContext context, String id, boolean approved) {
        ExternalTaskCommandService workers = context.getBean(ExternalTaskCommandService.class);
        var draft = workers.fetchAndLock(new FetchAndLockRequest("drafter", List.of("rework-draft"), 60_000L));
        assertThat(draft).singleElement().satisfies(task -> assertThat(task.processInstanceId()).isEqualTo(id));
        workers.complete(draft.getFirst().id(), "drafter", Map.of());

        var review = context.getBean(TaskRepository.class).findAll().stream()
                .filter(task -> task.getProcessInstanceId().equals(id) && task.getEndDate() == null
                        && task.getTaskDefinitionKey().equals("review"))
                .findFirst().orElseThrow();
        context.getBean(AbadaEngine.class).completeTask(review.getId(), "bob", List.of("reviewers"),
                Map.of("approved", approved));
    }

    private static void deployResource(AbadaEngine engine, String resource) {
        try (InputStream stream = AplLoopRuntimeTest.class.getResourceAsStream(resource)) {
            engine.deploy(stream);
        } catch (java.io.IOException exception) {
            throw new AssertionError(exception);
        }
    }

    private static void deploySource(AbadaEngine engine, String source) {
        engine.deploy(new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)));
    }

    private static ConfigurableApplicationContext startApplication() {
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(context,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=3",
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
