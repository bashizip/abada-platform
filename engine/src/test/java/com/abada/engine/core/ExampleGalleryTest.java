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
import com.abada.engine.persistence.repository.ProcessInstanceRepository;
import com.abada.engine.persistence.repository.ProjectResourceRepository;
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
 */
@Testcontainers
class ExampleGalleryTest {
    private static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;
    private static final Path EXAMPLES = Path.of(System.getProperty("user.dir")).getParent().resolve("examples/apl");

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_examples").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;

    @BeforeAll
    static void deployGallery() throws Exception {
        context = startApplication();
        installToolServer("payments.yaml");
        // Children first: call targets and delegates are pinned when the parent is deployed.
        for (String file : List.of("fraud-check.apl.yaml", "refund-payout.apl.yaml", "support-triage.apl.yaml",
                "refund-agent.apl.yaml", "complaint-reply.apl.yaml", "lead-triage-demo.apl.yaml",
                "kyc-onboarding.apl.yaml")) {
            try (InputStream source = Files.newInputStream(EXAMPLES.resolve(file))) {
                engine().deploy(PROJECT, source);
            }
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
                            "lead-triage-demo.apl.yaml", "kyc-onboarding.apl.yaml");
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

    private static ProcessInstance start(String key, Map<String, Object> variables) {
        return engine().startProcess(PROJECT, key, "alice", variables);
    }

    private static LockedExternalTask lock(String instanceId, String activityId) {
        return externalTasks().fetchAndLock(new FetchAndLockRequest("gallery-worker", List.of("abada:agent"),
                        60_000L, 20)).stream()
                .filter(task -> task.processInstanceId().equals(instanceId))
                .filter(task -> task.activityId().equals(activityId))
                .findFirst().orElseThrow(() -> new AssertionError("no " + activityId + " task for " + instanceId));
    }

    private static void installToolServer(String file) throws Exception {
        byte[] content = Files.readAllBytes(EXAMPLES.resolve("tool-servers").resolve(file));
        ProjectResourceEntity server = new ProjectResourceEntity();
        server.setProjectId(PROJECT);
        server.setName(file);
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
