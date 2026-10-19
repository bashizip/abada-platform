package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.model.AgentDelegate;
import com.abada.engine.core.model.ToolBinding;
import com.abada.engine.core.model.ToolPolicy;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ProcessInstanceEntity;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.ProcessInstanceRepository;
import com.abada.engine.persistence.repository.ProjectResourceRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.project.ProjectConstants;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
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
 * The documented use-case gallery runs: every process under {@code examples/apl}
 * deploys into one project with the example tool server, starts and reaches
 * its first step, and the M3 examples carry what the documentation says they
 * do (tool policies and approvers, routes, delegation, a governed child).
 * The CRM showcase under {@code examples/showcase/crm-leads} runs here too,
 * through its agent, rules, review form and worker, without the CRM itself.
 */
@Testcontainers
class ExampleGalleryTest {
    private static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;
    private static final Path EXAMPLES = Path.of(System.getProperty("user.dir")).getParent().resolve("examples/apl");
    private static final Path CRM_SHOWCASE = EXAMPLES.resolveSibling("showcase/crm-leads");

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_examples").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;

    @BeforeAll
    static void deployGallery() throws Exception {
        context = startApplication();
        installToolServer(EXAMPLES.resolve("tool-servers/payments.yaml"));
        installToolServer(CRM_SHOWCASE.resolve("tool-servers/crm.yaml"));
        // Children first: call targets and delegates are pinned when the parent is deployed.
        for (String file : List.of("fraud-check.apl.yaml", "refund-payout.apl.yaml", "support-triage.apl.yaml",
                "refund-agent.apl.yaml", "complaint-reply.apl.yaml", "lead-triage-demo.apl.yaml",
                "kyc-onboarding.apl.yaml", "document-check.apl.yaml", "document-batch.apl.yaml",
                "review-triage.apl.yaml")) {
            try (InputStream source = Files.newInputStream(EXAMPLES.resolve(file))) {
                engine().deploy(PROJECT, source);
            }
        }
        try (InputStream source = Files.newInputStream(CRM_SHOWCASE.resolve("process/lead-to-opportunity.apl.yaml"))) {
            engine().deploy(PROJECT, source);
        }
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void everyExampleIsDeployedByTheGallery() throws IOException {
        try (var files = Files.list(EXAMPLES)) {
            assertThat(files.map(path -> path.getFileName().toString()).filter(name -> name.endsWith(".apl.yaml")))
                    .containsExactlyInAnyOrder("fraud-check.apl.yaml", "refund-payout.apl.yaml",
                            "support-triage.apl.yaml", "refund-agent.apl.yaml", "complaint-reply.apl.yaml",
                            "lead-triage-demo.apl.yaml", "kyc-onboarding.apl.yaml", "document-check.apl.yaml",
                            "document-batch.apl.yaml", "review-triage.apl.yaml");
        }
    }

    @Test
    void theEarlierExamplesStartAtTheirFirstAgent() {
        assertThat(start("complaint_reply", Map.of("complaint", Map.of("text", "My parcel arrived broken"))))
                .extracting(ProcessInstance::getActiveTokens).asList().containsExactly("classify");
        assertThat(start("lead_triage_demo", Map.of("lead", Map.of("companySize", "5000 employees"))))
                .extracting(ProcessInstance::getActiveTokens).asList().containsExactly("analyze-lead");
        assertThat(start("kyc_onboarding_v1", Map.of()))
                .extracting(ProcessInstance::getActiveTokens).asList().containsExactly("extractAgent");
    }

    @Test
    void theRefundAgentReadsFreelyAndNeedsFinanceToApproveARefund() {
        ProcessInstance instance = start("refund_agent",
                Map.of("request", Map.of("order_id", "A-1042", "message", "The kettle arrived broken")));
        LockedExternalTask task = lock(instance.getId(), "handle");

        List<ToolBinding> bindings = task.agentWork().toolBindings();
        assertThat(bindings).extracting(ToolBinding::tool).containsExactly("get_order", "refund");
        assertThat(bindings.get(0).policy()).isEqualTo(ToolPolicy.READ);
        ToolBinding refund = bindings.get(1);
        assertThat(refund.policy()).isEqualTo(ToolPolicy.APPROVAL_REQUIRED);
        assertThat(refund.idempotency()).isEqualTo("none");
        assertThat(refund.approvers()).containsExactly("finance");
        assertThat(task.agentWork().limits().maxTurns()).isEqualTo(6);
        assertThat(task.agentWork().limits().budgetUsd()).isEqualByComparingTo(new BigDecimal("0.05"));
    }

    @Test
    void supportTriageRoutesDelegatesAndCallsAGovernedChild() {
        ProcessInstance instance = start("support_triage", Map.of("request", Map.of(
                "text", "My order A-1042 arrived broken, I want my money back", "order_id", "A-1042",
                "amount", 120.0)));
        LockedExternalTask triage = lock(instance.getId(), "triage");
        assertThat(triage.agentWork().outputSchema()).containsKey("properties");
        externalTasks().complete(triage.id(), "gallery-worker", Map.of("triage_result",
                Map.of("summary", "Broken kettle", "route", "refund", "_confidence", 90)));

        LockedExternalTask investigate = lock(instance.getId(), "investigate");
        assertThat(investigate.agentWork().delegates()).extracting(AgentDelegate::process)
                .containsExactly("fraud_check");
        assertThat(investigate.agentWork().delegates().getFirst().outputs()).containsExactly("verdict");
        externalTasks().complete(investigate.id(), "gallery-worker", Map.of("investigation",
                Map.of("approve", true, "reason", "Low fraud risk, damaged on delivery")));

        // The payout is a governed child with only the mapped inputs, linked to this instance.
        List<ProcessInstanceEntity> children = context.getBean(ProcessInstanceRepository.class)
                .findByParentInstanceIdOrderByStartDateAsc(instance.getId());
        assertThat(children).singleElement().satisfies(child -> {
            ProcessInstance running = engine().getProcessInstanceById(child.getId());
            assertThat(running.getActiveTokens()).containsExactly("pay");
            assertThat(running.getVariables()).containsEntry("order_id", "A-1042").containsKey("amount")
                    .doesNotContainKey("request");
        });
        assertThat(engine().getProcessInstanceById(instance.getId()).getActiveTokens()).containsExactly("payout");
    }

    @Test
    void theM4ExamplesStartAndCarryTheirGovernance() {
        // A batch runs a governed child per document, five at a time, and the rest wait their turn.
        List<String> documents = new java.util.ArrayList<>();
        for (int i = 0; i < 8; i++) documents.add("doc-" + i);
        ProcessInstance batch = start("document_batch", Map.of("case_id", "K-7", "documents", documents));
        assertThat(batch.getActiveTokens()).containsExactly("check_each");
        assertThat(context.getBean(ProcessInstanceRepository.class)
                .findByParentInstanceIdOrderByStartDateAsc(batch.getId())).hasSize(5);
        assertThat(batch.getDefinition().getForEach("check_each").maxItems()).isEqualTo(25);

        // The triage agent is checked by a named review whose accepting outcome is declared.
        ProcessInstance triage = start("review_triage", Map.of("ticket", Map.of("text", "Where is my order?")));
        assertThat(triage.getActiveTokens()).containsExactly("triage");
        assertThat(triage.getDefinition().getReviewOf("triage").reviewNode()).isEqualTo("review");
        assertThat(triage.getDefinition().getReviewOf("triage").accept()).isEqualTo("approve");
    }

    @Test
    void theCrmShowcaseGoesFromAgentAdviceThroughRulesAndAReviewToTheWorker() {
        ProcessInstance instance = start("lead_to_opportunity", Map.of("lead", Map.of("company", "MongoDB",
                "contact_email", "dana@mongodb.com", "message", "400 MacBook Pro this quarter")));
        LockedExternalTask research = lock(instance.getId(), "research");

        // The agent may read the CRM and write a note, nothing else; the bindings are frozen at deployment.
        List<ToolBinding> bindings = research.agentWork().toolBindings();
        assertThat(bindings).extracting(ToolBinding::tool)
                .containsExactly("find_company", "list_opportunities", "add_note");
        assertThat(bindings).extracting(ToolBinding::policy)
                .containsExactly(ToolPolicy.READ, ToolPolicy.READ, ToolPolicy.WRITE);
        assertThat(bindings.get(2).idempotency()).isEqualTo("key");
        assertThat(research.agentWork().fallbackModels()).containsExactly("gemini-3.8-flash", "gemini-3.7-flash");
        assertThat(research.agentWork().limits().maxTurns()).isEqualTo(10);

        externalTasks().complete(research.id(), "gallery-worker", Map.of("research", Map.of("fit_score", 95,
                "segment", "new_logo", "estimated_amount", 48000, "summary", "Clear need", "_confidence", 90)));

        // The table decided the lane and pre-filled the stage the review form shows.
        ProcessInstance reviewing = engine().getProcessInstanceById(instance.getId());
        assertThat(reviewing.getVariables()).containsEntry("lane", "review").containsEntry("deal_stage", "SCREENING");
        TaskEntity review = openTask(instance.getId(), "sales-review");
        assertThat(review.getFormKey()).isEqualTo("lead-qualification");
        assertThat(review.getCandidateGroups()).containsExactly("sales");

        engine().decideTask(review.getId(), "alice", List.of("sales"), "approve", null,
                Map.of("deal_stage", "PROPOSAL", "deal_amount", 960000));
        LockedExternalTask create = lock(instance.getId(), "create-opportunity", "crm.create-opportunity");
        assertThat(create.variables()).containsEntry("deal_stage", "PROPOSAL").containsEntry("deal_amount", 960000);
        externalTasks().complete(create.id(), "gallery-worker", Map.of("opportunity_id", "opp-1"));
        assertThat(engine().getProcessInstanceById(instance.getId()).isCompleted()).isTrue();

        // A weak lead never reaches a person.
        ProcessInstance weak = start("lead_to_opportunity", Map.of("lead", Map.of("company", "Rosie's Bakery",
                "message", "hi, do you sell computers?")));
        externalTasks().complete(lock(weak.getId(), "research").id(), "gallery-worker", Map.of("research",
                Map.of("fit_score", 15, "segment", "new_logo", "estimated_amount", 0, "summary", "Vague",
                        "_confidence", 85)));
        ProcessInstance nurtured = engine().getProcessInstanceById(weak.getId());
        assertThat(nurtured.isCompleted()).isTrue();
        assertThat(nurtured.getVariables()).containsEntry("lane", "nurture");
    }

    private static ProcessInstance start(String key, Map<String, Object> variables) {
        return engine().startProcess(PROJECT, key, "alice", variables);
    }

    private static LockedExternalTask lock(String instanceId, String activityId) {
        return lock(instanceId, activityId, "abada:agent");
    }

    private static LockedExternalTask lock(String instanceId, String activityId, String topic) {
        return externalTasks().fetchAndLock(new FetchAndLockRequest("gallery-worker", List.of(topic),
                        60_000L, 20)).stream()
                .filter(task -> task.processInstanceId().equals(instanceId))
                .filter(task -> task.activityId().equals(activityId))
                .findFirst().orElseThrow(() -> new AssertionError("no " + activityId + " task for " + instanceId));
    }

    private static TaskEntity openTask(String instanceId, String activityId) {
        return context.getBean(TaskRepository.class).findAll().stream()
                .filter(task -> task.getProcessInstanceId().equals(instanceId)
                        && task.getTaskDefinitionKey().equals(activityId) && task.getEndDate() == null)
                .findFirst().orElseThrow(() -> new AssertionError("no open " + activityId + " task"));
    }

    private static void installToolServer(Path file) throws Exception {
        byte[] content = Files.readAllBytes(file);
        ProjectResourceEntity server = new ProjectResourceEntity();
        server.setProjectId(PROJECT);
        server.setName(file.getFileName().toString());
        server.setContentType("application/yaml");
        server.setContent(content);
        server.setSizeBytes(content.length);
        server.setSha256(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)));
        server.setKind(ProjectResourceEntity.Kind.TOOL_SERVER);
        server.setCreatedAt(Instant.now());
        server.setUpdatedAt(Instant.now());
        context.getBean(ProjectResourceRepository.class).save(server);
    }

    private static AbadaEngine engine() {
        return context.getBean(AbadaEngine.class);
    }

    private static ExternalTaskCommandService externalTasks() {
        return context.getBean(ExternalTaskCommandService.class);
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
                        "spring.flyway.enabled=true",
                        "spring.task.scheduling.enabled=false",
                        "abada.outbox.dispatcher.enabled=false",
                        "abada.security.mode=disabled",
                        // The CRM showcase's tool server is plain http on the dev network.
                        "abada.tools.allow-insecure-http=true",
                        "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                        "abada.insight.llm.api-key=test-key",
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
    }
}
