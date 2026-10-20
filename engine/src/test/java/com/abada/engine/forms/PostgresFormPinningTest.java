package com.abada.engine.forms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.TaskManager;
import com.abada.engine.dto.ProjectTreeNodeDTO;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
import com.abada.engine.project.ProjectService;
import com.abada.engine.project.ProjectTreeService;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.abada.engine.util.DatabaseTestHelper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.time.Instant;
import java.util.HashMap;
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
 * PostgreSQL is the reference for the pinned form (V41): the snapshot is stored
 * with the definition version, survives an engine restart, and a refused
 * completion rolls back as one transaction.
 */
@Testcontainers
class PostgresFormPinningTest {
    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_form_pinning").withUsername("abada").withPassword("abada");
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void thePinnedFormSurvivesARestartAndAnEditToTheForm() throws Exception {
        String projectId;
        String instanceId;
        String taskId;
        ObjectNode form = (ObjectNode) JSON.readTree(resource("apl/forms/supplier-onboarding.json"));
        try (ConfigurableApplicationContext context = start()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            PrincipalEntity alice = new PrincipalEntity();
            alice.setId("alice-id");
            alice.setIssuer("test");
            alice.setSubjectId("alice-id");
            alice.setUsername("alice");
            alice.setFirstSeenAt(Instant.now());
            alice.setLastSeenAt(Instant.now());
            context.getBean(PrincipalRepository.class).save(alice);
            IdentityContext.set(new Identity("alice-id", "alice", List.of("abada-admin")));
            try {
                projectId = context.getBean(ProjectService.class).create("suppliers", "Suppliers", "").getId();
                ProjectTreeService trees = context.getBean(ProjectTreeService.class);
                String forms = trees.tree(projectId).stream()
                        .filter(node -> "FOLDER".equals(node.kind()) && "forms".equals(node.name()))
                        .map(ProjectTreeNodeDTO::id).findFirst().orElseThrow();
                ProjectResourceEntity stored = trees.createResource(projectId, forms, "supplier-onboarding.json",
                        "application/json", ProjectResourceEntity.Kind.FORM, JSON.writeValueAsBytes(form));
                AbadaEngine engine = context.getBean(AbadaEngine.class);
                var deployed = engine.deploy(projectId,
                        new ByteArrayInputStream(resource("apl/supplier-onboarding.apl.yaml")));
                assertThat(context.getBean(ProcessDefinitionRepository.class).findById(deployed.getDeploymentId())
                        .orElseThrow().getFormSnapshots()).contains("\"review\"").contains("supplier-onboarding");
                instanceId = engine.startProcess(projectId, "supplier_onboarding", "alice", Map.of()).getId();
                taskId = context.getBean(TaskManager.class).getTasksForProcessInstance(instanceId).getFirst().getId();
                // The form is edited after the task was created: it must not change this task's rules.
                ((ObjectNode) form.withArray("fields").get(3)).put("required", true);
                trees.replaceResource(projectId, stored.getId(), stored.getEntityVersion(), "application/json",
                        JSON.writeValueAsBytes(form));
            } finally {
                IdentityContext.clear();
            }
        }

        Map<String, Object> valid = new HashMap<>(JSON.convertValue(
                JSON.readTree(resource("forms/submission-conformance.json")).path("valid"), Map.class));
        try (ConfigurableApplicationContext context = start()) {
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            Map<String, Object> broken = new HashMap<>(valid);
            broken.put("iban", "not an iban");
            String task = taskId;
            assertThatThrownBy(() -> engine.completeTask(task, "alice", List.of("procurement"), broken))
                    .isInstanceOfSatisfying(FormSubmission.RejectedException.class, rejected ->
                            assertThat(rejected.violations()).containsExactly(new FormSubmission.Violation("iban", "pattern")));
            assertThat(engine.getProcessInstanceById(instanceId).getVariables()).doesNotContainKey("legal_name");
            assertThat(context.getBean(ActivityHistoryRepository.class).findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                    .noneMatch(entry -> entry.getEventType().equals("TASK_COMPLETED"));

            // trading_name is required only in the edited form, which this version never pinned.
            engine.completeTask(taskId, "alice", List.of("procurement"), valid);
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();
            assertThat(engine.getProcessInstanceById(instanceId).getVariables()).containsEntry("legal_name",
                    "Transportes Ribeira Lda");
        }
    }

    private ConfigurableApplicationContext start() {
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(context,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=3",
                        "spring.datasource.hikari.minimum-idle=1",
                        "spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect",
                        "spring.jpa.hibernate.ddl-auto=validate",
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

    private static byte[] resource(String name) throws Exception {
        try (InputStream in = PostgresFormPinningTest.class.getClassLoader().getResourceAsStream(name)) {
            return in.readAllBytes();
        }
    }
}
