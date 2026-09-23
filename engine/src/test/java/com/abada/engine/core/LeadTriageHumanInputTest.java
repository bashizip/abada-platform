package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.ProjectTreeNodeDTO;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProjectEntity;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.project.ProjectService;
import com.abada.engine.project.ProjectTreeService;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.abada.engine.util.DatabaseTestHelper;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * End-to-end validation of the human-input chain using the real APL example
 * {@code examples/apl/lead-triage-demo.apl.yaml}. Deploys the example into a
 * project, creates the form resource it references, starts the process with the
 * example payload, drives through the agent external task, asserts the human
 * task carries the formKey, resolves the form, completes with form values, and
 * confirms the process terminates with all expected variables.
 */
@Testcontainers
class LeadTriageHumanInputTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("abada_lead_triage")
                    .withUsername("abada")
                    .withPassword("abada");

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("APL human-input formKey resolves, task completes, variables land")
    void humanInputFormKeyRoundTrip() throws Exception {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            ExternalTaskCommandService externalTasks = context.getBean(ExternalTaskCommandService.class);
            TaskManager taskManager = context.getBean(TaskManager.class);
            ProjectService projectService = context.getBean(ProjectService.class);
            ProjectTreeService projectTree = context.getBean(ProjectTreeService.class);
            PrincipalRepository principals = context.getBean(PrincipalRepository.class);

            // Seed the principal so the project owner FK constraint is satisfied.
            PrincipalEntity alice = new PrincipalEntity();
            alice.setId("alice-id");
            alice.setIssuer("test");
            alice.setSubjectId("alice-id");
            alice.setUsername("alice");
            alice.setFirstSeenAt(Instant.now());
            alice.setLastSeenAt(Instant.now());
            principals.save(alice);

            // 1. Create a project and a FORM resource the human node references.
            IdentityContext.set(new Identity("alice-id", "alice", List.of("abada-admin")));
            try {
            ProjectEntity project = projectService.create("lead-triage", "Lead Triage", "sales demo");
            String projectId = project.getId();
            String formsFolderId = projectTree.tree(projectId).stream()
                    .filter(n -> "FOLDER".equals(n.kind()) && "forms".equals(n.name()))
                    .findFirst().orElseThrow().id();
            String formSchema = """
                    {
                      "title": "Lead Review",
                      "fields": [
                        {"id": "decision", "type": "select", "label": "Decision",
                         "required": true, "options": ["approve", "reject"]},
                        {"id": "notes", "type": "textarea", "label": "Notes",
                         "required": false}
                      ]
                    }""";
            projectTree.createResource(projectId, formsFolderId,
                    "lead-triage-review.json", "application/json",
                    ProjectResourceEntity.Kind.FORM,
                    formSchema.getBytes(StandardCharsets.UTF_8));

            // 2. Deploy the example APL from the repo examples directory.
            Path aplPath = Path.of(System.getProperty("user.dir"))
                    .getParent().resolve("examples/apl/lead-triage-demo.apl.yaml");
            try (var stream = Files.newInputStream(aplPath)) {
                engine.deploy(projectId, stream);
            }

            // 3. Start the process with the example payload.
            @SuppressWarnings("unchecked")
            Map<String, Object> variables = objectMapper.readValue(
                    """
                    {
                      "lead": {
                        "companySize": "5000 employees",
                        "email": "enterprise@client.com"
                      }
                    }""", Map.class);
            ProcessInstance instance = engine.startProcess(projectId,
                    "lead_triage_demo", "alice", variables);

            // 4. The agent external task is waiting on topic "abada:agent".
            //    Complete it with lead_priority = HIGH to route to the human task.
            var agentJobs = externalTasks.fetchAndLock(new FetchAndLockRequest(
                    "worker-agent", List.of("abada:agent"), 10_000L, 1, projectId));
            assertThat(agentJobs).singleElement()
                    .satisfies(job -> assertThat(job.activityId()).isEqualTo("analyze-lead"));
            externalTasks.complete(agentJobs.getFirst().id(),
                    Map.of("lead_priority", Map.of("priority", "HIGH", "_confidence", 92)));

            // 5. The human task "senior-sales-review" is now active with formKey.
            List<TaskInstance> tasks = taskManager.getTasksForProcessInstance(instance.getId());
            assertThat(tasks).singleElement();
            TaskInstance task = tasks.getFirst();
            assertThat(task.getTaskDefinitionKey()).isEqualTo("senior-sales-review");
            assertThat(task.getFormKey()).isEqualTo("lead-triage-review");
            assertThat(task.getCandidateGroups()).containsExactly("sales-director");

            // 6. Resolve the form via the service — the chain is connected.
            assertThat(projectTree.findFormByKey(projectId, "lead-triage-review"))
                    .isPresent();
            ProjectResourceEntity form = projectTree.findFormByKey(projectId, "lead-triage-review").get();
            assertThat(form.getName()).isEqualTo("lead-triage-review.json");
            assertThat(new String(form.getContent(), StandardCharsets.UTF_8))
                    .contains("\"decision\"");

            // 7. Claim and complete the task via engine.claim — exercise the
            //    full TaskGroupResolver path.  Bob is a member with task group
            //    SALES_DIRECTOR, but his identity groups (abada-task-user) do
            //    NOT contain "sales-director".  The task-group merge makes the
            //    claim succeed.
            PrincipalEntity bob = new PrincipalEntity();
            bob.setId("bob-id");
            bob.setIssuer("test");
            bob.setSubjectId("bob-id");
            bob.setUsername("bob");
            bob.setFirstSeenAt(Instant.now());
            bob.setLastSeenAt(Instant.now());
            principals.save(bob);

            String bobFormsFolderId = projectTree.tree(projectId).stream()
                    .filter(n -> "FOLDER".equals(n.kind()) && "forms".equals(n.name()))
                    .findFirst().orElseThrow().id();
            // Reuse projectTree.createResource — already used above.
            // Add bob as member with task group SALES_DIRECTOR.
            var projectMembers = context.getBean(
                    com.abada.engine.persistence.repository.ProjectMemberRepository.class);
            var tx = context.getBean(org.springframework.transaction.support.TransactionTemplate.class);
            tx.executeWithoutResult(s -> {
                var member = new com.abada.engine.persistence.entity.ProjectMemberEntity();
                member.setProjectId(projectId);
                member.setPrincipalId("bob-id");
                member.setRoles(java.util.Set.of(
                        com.abada.engine.persistence.entity.ProjectMemberEntity.Role.VIEWER,
                        com.abada.engine.persistence.entity.ProjectMemberEntity.Role.OPERATOR));
                member.setTaskGroups(java.util.Set.of("sales-director"));
                member.setCreatedAt(Instant.now());
                member.setCreatedBy("alice");
                projectMembers.save(member);
            });

            // Set IdentityContext for bob — groups do NOT include sales-director.
            IdentityContext.set(new Identity("bob-id", "bob", List.of("abada-task-user")));
            try {
                engine.claim(task.getId(), "bob", List.of("abada-task-user"));

                // 8. Complete as bob.
                engine.completeTask(task.getId(), "bob", List.of("abada-task-user"),
                        Map.of("decision", "approve", "notes", "High-value enterprise deal"));
            } finally {
                IdentityContext.clear();
            }

            // 8. The process completed; all variables are present.
            ProcessInstance completed = engine.getProcessInstanceById(instance.getId());
            assertThat(completed.isCompleted()).isTrue();
            assertThat(completed.getVariables())
                    .containsEntry("lead_priority", Map.of("priority", "HIGH"))
                    .containsEntry("decision", "approve")
                    .containsEntry("notes", "High-value enterprise deal")
                    .containsEntry("lead", Map.of(
                            "companySize", "5000 employees",
                            "email", "enterprise@client.com"));
            } finally {
                IdentityContext.clear();
            }
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
