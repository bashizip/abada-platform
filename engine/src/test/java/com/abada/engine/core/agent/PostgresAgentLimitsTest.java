package com.abada.engine.core.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.ApiException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.dto.AgentStepRequest;
import com.abada.engine.dto.ExternalTaskFailureDto;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.llm.ModelPriceService;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.IncidentEntity;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.IncidentRepository;
import com.abada.engine.project.ProjectConstants;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * E8 engine side: a model call past the node's limits is refused before it
 * happens, and a coded failure is final and routed by its code.
 */
@Testcontainers
class PostgresAgentLimitsTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;
    private static final String MODEL = "gemini-3.6-flash";

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_limits").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;

    @BeforeAll
    static void start() {
        context = new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(initialized -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(initialized,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=4",
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
        context.getBean(ModelPriceService.class).add(MODEL, null, new BigDecimal("1"), new BigDecimal("1"),
                Instant.now().minusSeconds(60));
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void aModelCallPastMaxTurnsIsRefusedBeforeItHappens() {
        LockedExternalTask task = startAndLock("turns_case", "max_turns: 2", "");
        assertThat(task.agentWork().limits().maxTurns()).isEqualTo(2);
        modelCall(task, 1, MODEL, 1, 1);
        modelCall(task, 2, MODEL, 1, 1);
        assertRefused(task, 3, MODEL, "TURN_LIMIT");
    }

    @Test
    void tokensAndBudgetCapTheWholeTask() {
        LockedExternalTask tokens = startAndLock("tokens_case", "max_tokens_total: 100", "");
        modelCall(tokens, 1, MODEL, 60, 50);
        assertRefused(tokens, 2, MODEL, "TOKEN_LIMIT");

        LockedExternalTask budget = startAndLock("budget_case", "budget_usd: 0.0001", "");
        modelCall(budget, 1, MODEL, 100, 0);       // $0.0001 at $1 per million tokens
        assertRefused(budget, 2, MODEL, "BUDGET");
        LockedExternalTask unpriced = startAndLock("unpriced_case", "budget_usd: 1", "");
        assertRefused(unpriced, 1, "no-price-model", "BUDGET_UNPRICED");
    }

    @Test
    void aCodedFailureIsFinalAndTakesTheRouteCatchingItsCode() {
        LockedExternalTask routed = startAndLock("coded_routed", "",
                "on_error:\n        - { code: AGENT_BUDGET_EXHAUSTED, then: over_budget }\n");
        fail(routed, "AGENT_BUDGET_EXHAUSTED");
        ProcessInstance instance = context.getBean(AbadaEngine.class).getProcessInstanceById(routed.processInstanceId());
        // Routed to the over_budget end, so the instance completed through it.
        assertThat(instance.getStatus()).isEqualTo(com.abada.engine.core.model.ProcessStatus.COMPLETED);
        assertThat(instance.getVariables()).containsEntry("triage_error_code", "AGENT_BUDGET_EXHAUSTED");

        LockedExternalTask stopped = startAndLock("coded_stopped", "", "");
        fail(stopped, "TOOL_CONTRACT_MISMATCH");
        ExternalTaskEntity row = context.getBean(ExternalTaskRepository.class).findById(stopped.id()).orElseThrow();
        assertThat(row.getStatus()).isEqualTo(ExternalTaskEntity.Status.FAILED);
        assertThat(row.getRetries()).isZero();
        assertThat(context.getBean(IncidentRepository.class)
                .findByProcessInstanceIdAndResolvedAtIsNull(stopped.processInstanceId()))
                .singleElement().satisfies(incident -> {
                    assertThat(incident.getType()).isEqualTo(IncidentEntity.Type.WORK_FAILED.name());
                    assertThat(incident.getMessage()).contains("TOOL_CONTRACT_MISMATCH");
                });
    }

    private static void fail(LockedExternalTask task, String code) {
        context.getBean(ExternalTaskCommandService.class).handleFailure(task.id(), new ExternalTaskFailureDto("w",
                "stopped: " + code, "", 3, 0L, null, null, code));
    }

    private static void modelCall(LockedExternalTask task, int sequence, String model, int prompt, int completion) {
        context.getBean(AgentStepService.class).record(task.id(), step(sequence, model, "COMPLETED", prompt,
                completion));
    }

    private static void assertRefused(LockedExternalTask task, int sequence, String model, String reason) {
        assertThatThrownBy(() -> context.getBean(AgentStepService.class).record(task.id(),
                step(sequence, model, "STARTED", null, null)))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.details()).containsEntry("reason", reason));
    }

    private static AgentStepRequest step(int sequence, String model, String state, Integer prompt, Integer completion) {
        try {
            return new AgentStepRequest("w", 1, sequence, "MODEL_CALL", state, null,
                    JSON.readTree("{\"turn\":" + sequence + "}"),
                    "COMPLETED".equals(state) ? JSON.readTree("{\"content\":\"ok\"}") : null, null, model, "p1",
                    prompt, completion);
        } catch (Exception exception) {
            throw new AssertionError(exception);
        }
    }

    private static LockedExternalTask startAndLock(String key, String limits, String onError) {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        engine.deploy(PROJECT, new ByteArrayInputStream(("""
                version: abada.io/v1
                metadata: { key: %s, name: %s }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: triage }
                    - id: triage
                      type: agent
                      model: gemini-3.6-flash
                      prompt: Triage
                      %s
                      %s
                      next: done
                    - { id: over_budget, type: end }
                    - { id: done, type: end }
                """.formatted(key, key, limits, onError)).getBytes(StandardCharsets.UTF_8)));
        String instance = engine.startProcess(PROJECT, key, "alice", Map.of()).getId();
        return context.getBean(ExternalTaskCommandService.class)
                .fetchAndLock(new FetchAndLockRequest("w", List.of("abada:agent"), 60_000L, 20)).stream()
                .filter(locked -> locked.processInstanceId().equals(instance)).findFirst().orElseThrow();
    }
}
