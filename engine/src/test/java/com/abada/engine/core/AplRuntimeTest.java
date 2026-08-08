package com.abada.engine.core;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.DefinitionSchema;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
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
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * End-to-end execution of native {@code abada.io/v1} APL definitions under the
 * PostgreSQL authority: polymorphic persistence, decision-table inline
 * execution, approval-gate user tasks, agent external tasks, condition
 * routing, schema coexistence with BPMN definitions, and restart recovery.
 */
@Testcontainers
class AplRuntimeTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("abada_apl")
                    .withUsername("abada")
                    .withPassword("abada");

    @Test
    void executesCandidateFlowThroughDecisionTableApprovalAndAgent() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");

            var instance = engine.startProcess("candidate_review", "alice", Map.of("score", 88));
            assertThat(engine.getProcessInstanceById(instance.getId()).getVariables())
                    .containsEntry("rating", "pass");

            var rejected = engine.startProcess("candidate_review", "bob", Map.of("score", 30));
            assertThat(engine.getProcessInstanceById(rejected.getId()).getVariables())
                    .containsEntry("rating", "fail");

            // The approval gate sits between the decision and the agent: the
            // pending user task is visible to the recruiter group only.
            // The approval gate sits between the decision and the agent: the
            // pending user task is visible to the recruiter group only.
            var pending = engine.getTaskManager().getVisibleTasksForUser("carol", List.of("recruiters"));
            assertThat(pending).extracting(TaskInstance::getProcessInstanceId)
                    .contains(instance.getId(), rejected.getId());
            var gateTask = pending.stream()
                    .filter(task -> task.getProcessInstanceId().equals(instance.getId()))
                    .findFirst().orElseThrow();
            assertThat(gateTask.getTaskDefinitionKey()).isEqualTo("gate");
            assertThat(gateTask.getCandidateGroups()).containsExactly("recruiters");
            engine.completeTask(gateTask.getId(), "carol", List.of("recruiters"), Map.of("approved", true));

            var externalTaskService = context.getBean(ExternalTaskCommandService.class);
            var agentJobs = externalTaskService.fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:agent"), 10_000L));
            assertThat(agentJobs).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("notify"));
            externalTaskService.complete(agentJobs.getFirst().id(), Map.of("handled", true));

            ProcessInstance completed = engine.getProcessInstanceById(instance.getId());
            assertThat(completed.isCompleted()).isTrue();
            assertThat(completed.getVariables())
                    .containsEntry("rating", "pass")
                    .containsEntry("approved", true)
                    .containsEntry("handled", true);
        }
    }

    @Test
    void routesConditionBranchesToDeclaredServiceTopics() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/condition-router.apl.yaml");

            var instance = engine.startProcess("rating_router", "alice", Map.of("rating", "gold"));
            var externalTaskService = context.getBean(ExternalTaskCommandService.class);
            var goldJobs = externalTaskService.fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:gold-tier"), 10_000L));
            assertThat(goldJobs).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("goldDesk"));
            externalTaskService.complete(goldJobs.getFirst().id(), Map.of("tier", "gold"));
            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isTrue();

            // No declared rule matched: the last condition rule becomes the default.
            var defaulted = engine.startProcess("rating_router", "bob", Map.of("rating", "platinum"));
            var basicJobs = externalTaskService.fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:basic-tier"), 10_000L));
            assertThat(basicJobs).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("basicDesk"));
            externalTaskService.complete(basicJobs.getFirst().id(), Map.of("tier", true));
            assertThat(engine.getProcessInstanceById(defaulted.getId()).isCompleted()).isTrue();
        }
    }

    @Test
    void rejectsInvalidAplDeploymentWithoutSideEffects() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);

            String broken = "version: abada.io/v1\n"
                    + "metadata:\n  name: broken flow\n"
                    + "flow:\n"
                    + "  entry: start\n"
                    + "  nodes:\n"
                    + "    - id: start\n      type: webhook\n      next: phantom\n";
            assertThatThrownBy(() -> engine.deploy(new java.io.ByteArrayInputStream(
                    broken.getBytes(StandardCharsets.UTF_8))))
                    .isInstanceOf(ProcessEngineException.class)
                    .hasMessageContaining("not a declared node");

            assertThat(context.getBean(ProcessDefinitionRepository.class).count()).isZero();
        }
    }

    @Test
    void recoversAplStateAcrossApplicationRestart() {
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");
            instanceId = engine.startProcess("candidate_review", "alice", Map.of("score", 88)).getId();
        }

        try (ConfigurableApplicationContext restarted = startApplication()) {
            // The persisted APL source is reloaded from PostgreSQL and recompiled
            // by the native loader — no XML round-trip, no schema guesswork.
            assertThat(restarted.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("candidate_review"))
                    .isPresent()
                    .get()
                    .extracting(ProcessDefinitionEntity::getSchemaType)
                    .isEqualTo(DefinitionSchema.APL_NATIVE.name());

            AbadaEngine engine = restarted.getBean(AbadaEngine.class);
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isFalse();
            assertThat(engine.getTaskManager().getVisibleTasksForUser("carol", List.of("recruiters")))
                    .singleElement()
                    .satisfies(task -> assertThat(task.getTaskDefinitionKey()).isEqualTo("gate"));
        }
    }

    @Test
    void aplAndBpmnDefinitionsVersionTogetherAndDeduplicate() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/condition-router.apl.yaml");
            deploy(engine, "/bpmn/decision-table-test.bpmn");

            var aplFlow = context.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("rating_router");
            var bpmn = context.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("CreditDecisionProcess");
            assertThat(aplFlow).isPresent().get().satisfies(entity -> {
                assertThat(entity.getSchemaType()).isEqualTo(DefinitionSchema.APL_NATIVE.name());
                assertThat(entity.getDefinitionFormatVersion()).isEqualTo("apl-native-1");
            });
            assertThat(bpmn).isPresent().get().satisfies(entity -> {
                assertThat(entity.getSchemaType()).isEqualTo(DefinitionSchema.BPMN_XML.name());
                assertThat(entity.getDefinitionFormatVersion()).isEqualTo("canonical-1");
            });

            // Re-deploying identical source is idempotent: no version bump.
            deploy(engine, "/apl/condition-router.apl.yaml");
            assertThat(context.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("rating_router"))
                    .isPresent()
                    .get()
                    .extracting(ProcessDefinitionEntity::getVersion)
                    .isEqualTo(1);
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
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
    }
}