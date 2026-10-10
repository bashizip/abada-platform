package com.abada.engine.core.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.expression.ExpressionEvaluationException;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.project.ProjectConstants;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * E13 under the PostgreSQL authority: an agent chooses among the routes its
 * node declares; the engine takes the route, refuses an undeclared one, lets
 * a route's {@code when} veto it, keeps low confidence on its own route, and
 * bounds a route back to the agent with the loop.
 */
@Testcontainers
class AplRoutingRuntimeTest {
    private static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_routes").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;

    @BeforeAll
    static void start() throws Exception {
        context = startApplication();
        engine().deploy(PROJECT, new ByteArrayInputStream(
                Files.readAllBytes(Path.of("src/test/resources/apl/routing-agent.apl.yaml"))));
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void eachDeclaredRouteReachesItsStepAndIsRecorded() {
        String refund = start(Map.of("amount", 120.0));
        complete(lock(refund), "refund", 92);
        ProcessInstance refunded = engine().getProcessInstanceById(refund);
        assertThat(refunded.getStatus()).isEqualTo(ProcessStatus.COMPLETED);
        assertThat(refunded.getVariables()).containsEntry("triage_route", "refund")
                .containsEntry("triage_outcome", "OK");
        assertThat(visited(refund)).contains("refund").doesNotContain("manual");
        assertThat(history(refund, "ROUTE_TAKEN")).singleElement().asString()
                .contains("\"route\":\"refund\"", "\"routedTo\":\"refund\"", "\"confidence\":92");

        String escalate = start(Map.of("amount", 120.0));
        complete(lock(escalate), "escalate", 88);
        assertThat(visited(escalate)).contains("manual");
        assertThat(engine().getProcessInstanceById(escalate).getVariables()).containsEntry("triage_route", "escalate");
    }

    @Test
    void anUndeclaredOrVetoedRouteIsInvalidOutput() {
        String undeclared = start(Map.of("amount", 120.0));
        complete(lock(undeclared), "close_account", 95);
        ProcessInstance invalid = engine().getProcessInstanceById(undeclared);
        assertThat(invalid.getVariables()).containsEntry("triage_outcome", "INVALID_OUTPUT")
                .doesNotContainKey("triage_route");
        assertThat(visited(undeclared)).contains("manual");
        assertThat(history(undeclared, "ROUTE_TAKEN")).isEmpty();

        // refund's when allows at most 500: the engine vetoes the agent's choice.
        String vetoed = start(Map.of("amount", 900.0));
        complete(lock(vetoed), "refund", 95);
        assertThat(engine().getProcessInstanceById(vetoed).getVariables())
                .containsEntry("triage_outcome", "INVALID_OUTPUT").doesNotContainKey("triage_route");
        assertThat(visited(vetoed)).contains("manual").doesNotContain("refund");
        assertThat(history(vetoed, "EXTERNAL_TASK_COMPLETED")).singleElement().asString()
                .contains("vetoed by its when");
    }

    @Test
    void aWhenThatCannotBeEvaluatedFailsTheCompletionLoudly() {
        String missing = start(Map.of());                       // no amount: refund's when cannot decide
        LockedExternalTask task = lock(missing);
        assertThatThrownBy(() -> complete(task, "refund", 95)).isInstanceOf(ExpressionEvaluationException.class)
                .hasMessageContaining("triage");
        ExternalTaskEntity row = context.getBean(ExternalTaskRepository.class).findById(task.id()).orElseThrow();
        assertThat(row.getStatus()).isEqualTo(ExternalTaskEntity.Status.LOCKED);
        assertThat(engine().getProcessInstanceById(missing).getActiveTokens()).containsExactly("triage");
        // Another route without a when still goes through.
        complete(task, "escalate", 95);
        assertThat(visited(missing)).contains("manual");
    }

    @Test
    void lowConfidenceKeepsItsOwnRoute() {
        String low = start(Map.of("amount", 120.0));
        complete(lock(low), "refund", 40);
        ProcessInstance instance = engine().getProcessInstanceById(low);
        assertThat(instance.getVariables()).containsEntry("triage_outcome", "LOW_CONFIDENCE")
                .doesNotContainKey("triage_route");
        assertThat(visited(low)).contains("manual").doesNotContain("refund");
    }

    @Test
    void aRouteBackToTheAgentIsBoundedByItsLoopAndSurvivesARestart() {
        String looping = start(Map.of("amount", 120.0));
        complete(lock(looping), "clarify", 90);
        answerTheCustomer(looping);

        context.close();                                         // restart between two passes
        context = startApplication();

        complete(lock(looping), "clarify", 90);
        answerTheCustomer(looping);
        // The bound is two passes: the third entry takes on_exhausted instead of another agent run.
        assertThat(engine().getProcessInstanceById(looping).getStatus()).isEqualTo(ProcessStatus.COMPLETED);
        assertThat(visited(looping)).containsExactly("ask_customer", "ask_customer");
        assertThat(history(looping, "LOOP_EXHAUSTED")).singleElement().asString().contains("manual");
        assertThat(history(looping, "ROUTE_TAKEN")).hasSize(2);
        assertThat(lockAll()).noneMatch(task -> task.processInstanceId().equals(looping));
    }

    // ---------------------------------------------------------------- helpers

    private static AbadaEngine engine() {
        return context.getBean(AbadaEngine.class);
    }

    private static String start(Map<String, Object> variables) {
        Map<String, Object> all = new HashMap<>(variables);
        all.put("request_text", "Where is my refund for order 7?");
        return engine().startProcess(PROJECT, "routing_agent", "alice", all).getId();
    }

    private static LockedExternalTask lock(String instanceId) {
        return lockAll().stream().filter(task -> task.processInstanceId().equals(instanceId)).findFirst()
                .orElseThrow(() -> new AssertionError("no agent task locked for " + instanceId));
    }

    private static List<LockedExternalTask> lockAll() {
        return context.getBean(ExternalTaskCommandService.class).fetchAndLock(
                new FetchAndLockRequest("w", List.of("abada:agent"), 60_000L, 20));
    }

    private static void complete(LockedExternalTask task, String route, int confidence) {
        context.getBean(ExternalTaskCommandService.class).complete(task.id(), "w", Map.of("triage_result",
                Map.of("route", route, "summary", "routed", "_confidence", confidence)));
    }

    private static void answerTheCustomer(String instanceId) {
        String taskId = context.getBean(TaskRepository.class).findAll().stream()
                .filter(task -> task.getProcessInstanceId().equals(instanceId))
                .filter(task -> task.getStatus() == TaskStatus.AVAILABLE).findFirst().orElseThrow().getId();
        engine().completeTask(taskId, "sam", List.of("support"), Map.of());
    }

    /** Where the agent's boundaries sent the token (end events record no history of their own). */
    private static List<String> visited(String instanceId) {
        return history(instanceId, "BOUNDARY_TAKEN").stream()
                .map(details -> details.replaceAll(".*\"routedTo\":\"([^\"]+)\".*", "$1")).toList();
    }

    private static List<String> history(String instanceId, String eventType) {
        return context.getBean(JdbcTemplate.class).queryForList("select details_json from activity_history where"
                + " process_instance_id = ? and event_type = ?", String.class, instanceId, eventType);
    }

    private static ConfigurableApplicationContext startApplication() {
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(initialized -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(initialized,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=6",
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
