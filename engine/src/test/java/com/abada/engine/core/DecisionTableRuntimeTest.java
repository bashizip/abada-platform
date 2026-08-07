package com.abada.engine.core;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.ProcessInstanceRepository;
import com.abada.engine.util.DatabaseTestHelper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.InputStream;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Deterministic decision-table runtime under the PostgreSQL authority:
 * deployment, inline execution inside the workflow transaction, history/outbox
 * audit, rollback on a decision that cannot be made, and restart recovery.
 */
@Testcontainers
class DecisionTableRuntimeTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("abada_decision_table")
                    .withUsername("abada")
                    .withPassword("abada");

    @Test
    void appliesDecisionTableInlineAndAuditsIt() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/decision-table-test.bpmn");

            var instance = engine.startProcess("CreditDecisionProcess", "alice",
                    Map.of("applicant", Map.of("creditScore", 780, "annualIncome", 85000)));

            assertThat(instance.isCompleted()).isTrue();
            assertThat(engine.getProcessInstanceById(instance.getId()).getVariables())
                    .containsEntry("riskLevel", "LOW")
                    .containsEntry("autoApprove", true);

            List<ActivityHistoryEntity> history = context.getBean(ActivityHistoryRepository.class)
                    .findByProcessInstanceIdOrderByOccurredAtAsc(instance.getId());
            assertThat(history).extracting(ActivityHistoryEntity::getEventType)
                    .contains("PROCESS_STARTED", "DECISION_TABLE_APPLIED");
            assertThat(history).filteredOn(event -> "DECISION_TABLE_APPLIED".equals(event.getEventType()))
                    .singleElement()
                    .satisfies(event -> {
                        assertThat(event.getActivityId()).isEqualTo("CreditRules");
                        assertThat(event.getDetailsJson())
                                .contains("DMN_CREDIT_RISK_V1")
                                .contains("matchedRuleIndexes")
                                .contains("score")
                                .doesNotContain("780"); // values never enter history
                    });
        }
    }

    @Test
    void fallsBackToOtherwiseRuleWhenNoConditionMatches() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/decision-table-test.bpmn");

            var instance = engine.startProcess("CreditDecisionProcess", "alice",
                    Map.of("applicant", Map.of("creditScore", 480, "annualIncome", 20000)));

            assertThat(engine.getProcessInstanceById(instance.getId()).getVariables())
                    .containsEntry("riskLevel", "HIGH")
                    .containsEntry("autoApprove", false);
        }
    }

    @Test
    void rollsBackStartWhenTheDecisionCannotBeMade() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/decision-table-no-fallback.bpmn");

            assertThatThrownBy(() -> engine.startProcess("NoFallbackDecisionProcess", "alice",
                    Map.of("score", 100)))
                    .isInstanceOf(ProcessEngineException.class)
                    .hasMessageContaining("matched no rule");

            // The failed start must leave no process instance behind. The deploy
            // itself legitimately records one PROCESS_DEFINITION_DEPLOYED history
            // row, so the whole history table must still hold only that event:
            // no PROCESS_STARTED and no DECISION_TABLE_APPLIED may survive.
            assertThat(context.getBean(ProcessInstanceRepository.class).count()).isZero();
            assertThat(context.getBean(ActivityHistoryRepository.class).findAll())
                    .extracting(ActivityHistoryEntity::getEventType)
                    .containsExactly("PROCESS_DEFINITION_DEPLOYED");
        }
    }

    @Test
    void recoversDecisionTableResultAcrossApplicationRestart() {
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/decision-table-test.bpmn");
            instanceId = engine.startProcess("CreditDecisionProcess", "alice",
                    Map.of("applicant", Map.of("creditScore", 640, "annualIncome", 50000))).getId();
        }

        try (ConfigurableApplicationContext restarted = startApplication()) {
            AbadaEngine engine = restarted.getBean(AbadaEngine.class);
            // Reloading re-parses the persisted (canonicalized) XML: the native
            // abada:decisionTable extension must survive the round-trip.
            assertThat(engine.getProcessInstanceById(instanceId).getVariables())
                    .containsEntry("riskLevel", "MEDIUM")
                    .containsEntry("autoApprove", false);
            assertThat(restarted.getBean(ActivityHistoryRepository.class)
                    .findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                    .extracting(ActivityHistoryEntity::getEventType)
                    .contains("DECISION_TABLE_APPLIED");
        }
    }

    private void deploy(AbadaEngine engine, String resource) {
        try (InputStream bpmn = getClass().getResourceAsStream(resource)) {
            assertThat(bpmn).as(resource).isNotNull();
            engine.deploy(bpmn);
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
