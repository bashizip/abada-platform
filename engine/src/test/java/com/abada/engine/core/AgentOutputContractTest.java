package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.dto.ExternalTaskBpmnErrorRequest;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.InputStream;
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
 * Engine-side agent output contract, outcome routing and default-deny inputs
 * (M1 tasks T4-T7) under the PostgreSQL authority.
 */
@Testcontainers
class AgentOutputContractTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("abada_agent_contract")
                    .withUsername("abada")
                    .withPassword("abada");

    private static final Map<String, Object> LEAD = Map.of(
            "lead", Map.of("companySize", 5_000, "email", "ceo@example.com"),
            "secretNotes", "board is unhappy");

    @Test
    void sendsOnlyDeclaredInputsAndAcceptsAValidConfidentResult() {
        try (ConfigurableApplicationContext context = startApplication()) {
            Fixture f = start(context, "/apl/agent-contract.apl.yaml", "agent_contract");

            assertThat(f.task.variables()).containsOnlyKeys("lead.companySize");
            assertThat(f.task.variables()).containsEntry("lead.companySize", 5_000);

            f.commands.complete(f.task.id(), "worker-1",
                    Map.of("lead_priority", Map.of("priority", "HIGH", "_confidence", 93)), null);

            var instance = f.engine.getProcessInstanceById(f.instanceId);
            assertThat(instance.getActiveTokens()).containsExactly("crm");
            assertThat(instance.getVariables())
                    .containsEntry("lead_priority", Map.of("priority", "HIGH"))
                    .containsEntry("classify_outcome", "OK");
            assertThat(outcomeOf(context, f.task.id())).isEqualTo("OK");
        }
    }

    @Test
    void lowConfidenceRoutesToTheHumanReviewAndKeepsTheRecommendation() {
        try (ConfigurableApplicationContext context = startApplication()) {
            Fixture f = start(context, "/apl/agent-contract.apl.yaml", "agent_contract");

            f.commands.complete(f.task.id(), "worker-1",
                    Map.of("lead_priority", Map.of("priority", "LOW", "_confidence", 40)), null);

            var instance = f.engine.getProcessInstanceById(f.instanceId);
            assertThat(instance.getActiveTokens()).containsExactly("review");
            assertThat(instance.getVariables())
                    .containsEntry("lead_priority", Map.of("priority", "LOW"))
                    .containsEntry("classify_outcome", "LOW_CONFIDENCE");
            assertThat(f.engine.getTaskManager().getVisibleTasksForUser("dana", List.of("sales-director")))
                    .anySatisfy(task -> assertThat(task.getProcessInstanceId()).isEqualTo(f.instanceId));
        }
    }

    @Test
    void schemaInvalidOutputRoutesToReviewWithoutEnteringTheResultVariable() {
        try (ConfigurableApplicationContext context = startApplication()) {
            Fixture f = start(context, "/apl/agent-contract.apl.yaml", "agent_contract");

            f.commands.complete(f.task.id(), "worker-1",
                    Map.of("lead_priority", "I think this one is urgent!"), null);

            var instance = f.engine.getProcessInstanceById(f.instanceId);
            assertThat(instance.getActiveTokens()).containsExactly("review");
            assertThat(instance.getVariables())
                    .doesNotContainKey("lead_priority")
                    .containsEntry("classify_outcome", "INVALID_OUTPUT")
                    .containsEntry("classify_raw_output", "I think this one is urgent!");
            assertThat(historyTypes(context, f.instanceId)).contains("EXTERNAL_TASK_COMPLETED");
        }
    }

    @Test
    void aBusinessErrorRoutesByCodeAndAnUnroutedCodeStillFailsTheInstance() {
        try (ConfigurableApplicationContext context = startApplication()) {
            Fixture routed = start(context, "/apl/agent-contract.apl.yaml", "agent_contract");
            routed.commands.handleBpmnError(routed.task.id(),
                    new ExternalTaskBpmnErrorRequest("worker-1", "CANNOT_DECIDE", "ambiguous lead", Map.of()));
            var routedInstance = routed.engine.getProcessInstanceById(routed.instanceId);
            assertThat(routedInstance.getActiveTokens()).containsExactly("review");
            assertThat(routedInstance.getVariables())
                    .containsEntry("classify_outcome", "ERROR")
                    .containsEntry("classify_error_code", "CANNOT_DECIDE");

            String second = routed.engine.startProcess("agent_contract", "alice", LEAD).getId();
            LockedExternalTask task = routed.commands.fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:agent"), 60_000L)).getFirst();
            routed.commands.handleBpmnError(task.id(),
                    new ExternalTaskBpmnErrorRequest("worker-1", "UNKNOWN", "no route", Map.of()));
            assertThat(routed.engine.getProcessInstanceById(second).getStatus()).isEqualTo(ProcessStatus.FAILED);
        }
    }

    @Test
    void anUnroutedRejectionIsAFailedAttemptAndBecomesAnIncident() {
        try (ConfigurableApplicationContext context = startApplication()) {
            Fixture f = start(context, "/apl/agent-contract-unrouted.apl.yaml", "agent_contract_unrouted");

            f.commands.complete(f.task.id(), "worker-1",
                    Map.of("lead_priority", Map.of("priority", "HIGH")), null);

            ExternalTaskEntity afterFirst = taskState(context, f.task.id());
            assertThat(afterFirst.getStatus()).isEqualTo(ExternalTaskEntity.Status.OPEN);
            assertThat(afterFirst.getRetries()).isEqualTo(1);
            assertThat(afterFirst.getAgentOutcome()).isEqualTo("LOW_CONFIDENCE");
            assertThat(afterFirst.getExceptionMessage()).contains("no '_confidence' reported");
            assertThat(f.engine.getProcessInstanceById(f.instanceId).getActiveTokens()).containsExactly("classify");
            assertThat(historyTypes(context, f.instanceId)).contains("EXTERNAL_TASK_OUTPUT_REJECTED");

            LockedExternalTask retry = f.commands.fetchAndLock(
                    new FetchAndLockRequest("worker-2", List.of("abada:agent"), 60_000L)).getFirst();
            f.commands.complete(retry.id(), "worker-2",
                    Map.of("lead_priority", Map.of("priority", "SOON", "_confidence", 99)), null);

            ExternalTaskEntity afterSecond = taskState(context, f.task.id());
            assertThat(afterSecond.getStatus()).isEqualTo(ExternalTaskEntity.Status.FAILED);
            assertThat(afterSecond.getRetries()).isZero();
            assertThat(afterSecond.getAgentOutcome()).isEqualTo("INVALID_OUTPUT");
            assertThat(f.engine.getProcessInstanceById(f.instanceId).getVariables()).doesNotContainKey("lead_priority");
        }
    }

    private record Fixture(AbadaEngine engine, ExternalTaskCommandService commands, String instanceId,
                           LockedExternalTask task) {}

    private Fixture start(ConfigurableApplicationContext context, String resource, String key) {
        context.getBean(DatabaseTestHelper.class).cleanup();
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        try (InputStream stream = getClass().getResourceAsStream(resource)) {
            assertThat(stream).as(resource).isNotNull();
            engine.deploy(stream);
        } catch (Exception exception) {
            throw new AssertionError("Could not deploy " + resource, exception);
        }
        String instanceId = engine.startProcess(key, "alice", LEAD).getId();
        ExternalTaskCommandService commands = context.getBean(ExternalTaskCommandService.class);
        LockedExternalTask task = commands.fetchAndLock(
                new FetchAndLockRequest("worker-1", List.of("abada:agent"), 60_000L)).getFirst();
        return new Fixture(engine, commands, instanceId, task);
    }

    private ExternalTaskEntity taskState(ConfigurableApplicationContext context, String taskId) {
        return context.getBean(ExternalTaskRepository.class).findById(taskId).orElseThrow();
    }

    private String outcomeOf(ConfigurableApplicationContext context, String taskId) {
        return taskState(context, taskId).getAgentOutcome();
    }

    private List<String> historyTypes(ConfigurableApplicationContext context, String instanceId) {
        return context.getBean(ActivityHistoryRepository.class)
                .findByProcessInstanceIdOrderByOccurredAtAsc(instanceId).stream()
                .map(ActivityHistoryEntity::getEventType).toList();
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
