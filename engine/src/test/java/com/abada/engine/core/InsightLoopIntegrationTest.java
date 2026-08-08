package com.abada.engine.core;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.InsightController;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.InsightProposalDetailDTO;
import com.abada.engine.dto.InsightProposalSummaryDTO;
import com.abada.engine.dto.InsightReviewRequest;
import com.abada.engine.dto.PageDTO;
import com.abada.engine.insight.InsightWorker;
import com.abada.engine.insight.InsightProposalService;
import com.abada.engine.persistence.entity.InsightFindingEntity;
import com.abada.engine.persistence.entity.InsightObservationWindowEntity;
import com.abada.engine.persistence.entity.InsightProposalEntity;
import com.abada.engine.persistence.entity.InsightProposalReviewEntity;
import com.abada.engine.persistence.repository.InsightExecutionFactRepository;
import com.abada.engine.persistence.repository.InsightFindingRepository;
import com.abada.engine.persistence.repository.InsightObservationWindowRepository;
import com.abada.engine.persistence.repository.InsightProposalRepository;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.abada.engine.util.DatabaseTestHelper;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Map;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * End-to-end coverage of the Phase 2 Insight Loop on the PostgreSQL
 * authority: terminal facts are written inside the same workflow
 * transactions, the window worker classifies them, proposals are
 * deduplicated per deployment, adoption deploys the proposal as a new
 * immutable definition version, and the gateway validates (and discards)
 * LLM suggestions. A local fake plays the OpenAI-compatible endpoint.
 */
@Testcontainers
class InsightLoopIntegrationTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("abada_insight")
                    .withUsername("abada")
                    .withPassword("abada");

    @Test
    void parallelPolicyRequiresEveryRoleAndSupersedesStaleTargets() {
        try (ConfigurableApplicationContext context = startApp()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            var deployed = deployReturning(engine, "/apl/candidate-review.apl.yaml");
            var repository = context.getBean(InsightProposalRepository.class);
            InsightProposalEntity proposal = repository.save(proposalFor(deployed, "lead,compliance", 2,
                    InsightProposalEntity.ApprovalMode.PARALLEL));
            InsightProposalService service = context.getBean(InsightProposalService.class);

            assertThatThrownBy(() -> service.review(proposal.getId(), "wrong-role",
                    List.of("abada-admin"), InsightProposalReviewEntity.Decision.APPROVE,
                    "Admin access does not override the configured separation of duties",
                    proposal.getUpdatedAt()))
                    .isInstanceOf(ProcessEngineException.class)
                    .hasMessageContaining("approval policy");

            InsightProposalEntity afterLead = service.review(proposal.getId(), "lead-user", List.of("lead"),
                    InsightProposalReviewEntity.Decision.APPROVE, "Technically sound", proposal.getUpdatedAt());
            assertThat(afterLead.getStatus()).isEqualTo(InsightProposalEntity.Status.IN_REVIEW);
            InsightProposalEntity adopted = service.review(proposal.getId(), "compliance-user",
                    List.of("compliance"), InsightProposalReviewEntity.Decision.APPROVE,
                    "Controls verified", afterLead.getUpdatedAt());
            assertThat(adopted.getStatus()).isEqualTo(InsightProposalEntity.Status.ADOPTED);
            assertThat(adopted.getAdoptedVersion()).isEqualTo(2);
            Instant adoptedAt = adopted.getUpdatedAt();
            assertThatThrownBy(() -> service.review(proposal.getId(), "late-reviewer",
                    List.of("lead"), InsightProposalReviewEntity.Decision.APPROVE,
                    "Too late", adoptedAt))
                    .isInstanceOf(InsightProposalService.InsightConflictException.class)
                    .hasMessageContaining("already ADOPTED");

            var staleTarget = context.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("candidate_review").orElseThrow();
            InsightProposalEntity stale = repository.save(proposalFor(staleTarget,
                    "abada-insight-reviewer", 1, InsightProposalEntity.ApprovalMode.PARALLEL));
            engine.deploy(new java.io.ByteArrayInputStream(
                    ("# newer immutable version\n" + staleTarget.getBpmnXml()).getBytes(StandardCharsets.UTF_8)));
            InsightProposalEntity superseded = service.review(stale.getId(), "reviewer",
                    List.of("abada-insight-reviewer"), InsightProposalReviewEntity.Decision.APPROVE,
                    "Reviewed", stale.getUpdatedAt());
            assertThat(superseded.getStatus()).isEqualTo(InsightProposalEntity.Status.SUPERSEDED);
        }
    }

    @Test
    void recordsFactsFindsFallbackThrashAndAdoptsRuleBasedProposal() {
        try (ConfigurableApplicationContext context = startApp()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");

            for (int i = 1; i <= 4; i++) {
                runInstance(engine, context.getBean(ExternalTaskCommandService.class), Map.of("score", 30));
            }

            var facts = context.getBean(InsightExecutionFactRepository.class);
            assertThat(facts.countByEndedAtGreaterThanEqualAndEndedAtLessThan(
                    java.time.Instant.EPOCH, java.time.Instant.now().plusSeconds(60))).isEqualTo(12);

            var worker = context.getBean(InsightWorker.class);
            assertThat(worker.runCycle()).isEqualTo(InsightWorker.RunOutcome.PROCESSED);

            var windows = context.getBean(InsightObservationWindowRepository.class).findAll();
            assertThat(windows).singleElement().satisfies(window -> {
                assertThat(window.getStatus()).isEqualTo(InsightObservationWindowEntity.Status.COMPLETED);
                assertThat(window.getFactsProcessed()).isEqualTo(12);
            });

            var findings = context.getBean(InsightFindingRepository.class).findAll();
            assertThat(findings).singleElement().satisfies(finding ->
                    assertThat(finding.getSignalType())
                            .isEqualTo(InsightFindingEntity.SignalType.FALLBACK_THRASH));

            var proposals = context.getBean(InsightProposalRepository.class).findAll();
            assertThat(proposals).singleElement().satisfies(proposal -> {
                assertThat(proposal.getStatus()).isEqualTo(InsightProposalEntity.Status.DRAFT);
                assertThat(proposal.getDefinitionKey()).isEqualTo("candidate_review");
                assertThat(proposal.getTargetVersion()).isEqualTo(1);
                assertThat(proposal.getProposedSource()).startsWith("# Insight engine working draft");
                assertThat(proposal.getProposedSource()).contains("score");
            });

            var controller = context.getBean(InsightController.class);
            PageDTO<InsightProposalSummaryDTO> page = controller.list(0, 20, null, null).getBody();
            List<InsightProposalSummaryDTO> listed = page.items();
            assertThat(listed).singleElement();
            long proposalId = listed.getFirst().id();

            InsightProposalDetailDTO detail = controller.detail(proposalId).getBody();
            assertThat(detail.targetSource()).contains("score >= 75");
            assertThat(detail.proposedSource()).startsWith("# Insight engine working draft");

            IdentityContext.set(new Identity("alice", List.of("abada-insight-reviewer")));
            InsightProposalDetailDTO adopted;
            try {
                adopted = controller.review(proposalId,
                        new InsightReviewRequest("APPROVE", "Validated against the execution facts",
                                detail.updatedAt())).getBody();
            } finally {
                IdentityContext.clear();
            }
            assertThat(adopted.status()).isEqualTo(InsightProposalEntity.Status.ADOPTED.name());
            assertThat(adopted.adoptedVersion()).isEqualTo(2);
            assertThat(adopted.reviews()).singleElement().satisfies(review -> {
                assertThat(review.actor()).isEqualTo("alice");
                assertThat(review.decision()).isEqualTo("APPROVE");
            });

            var latest = context.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("candidate_review").orElseThrow();
            assertThat(latest.getVersion()).isEqualTo(2);
            assertThat(latest.getBpmnXml()).isEqualTo(adopted.proposedSource());
            assertThat(latest.getDeploymentId()).isEqualTo(adopted.adoptedDeploymentId());

            assertThat(context.getBean(InsightProposalRepository.class).findById(proposalId).orElseThrow()
                    .getStatus()).isEqualTo(InsightProposalEntity.Status.ADOPTED);
        }
    }

    @Test
    void llmSuggestionIsValidatedBeforeItBecomesAProposal() throws Exception {
        String rewrite = "# changed: LLM rewrite\n"
                + "version: abada.io/v1\n"
                + "metadata:\n  name: Candidate Review\n"
                + "flow:\n  entry: apply\n  nodes:\n"
                + "    - id: apply\n      type: webhook\n      next: score\n"
                + "    - id: score\n      type: decision-table\n      decisionKey: CANDIDATE_SCORING\n"
                + "      hitPolicy: FIRST\n      inputs:\n        - name: score\n      rules:\n"
                + "        - when: score >= 75\n          then:\n            rating: pass\n"
                + "        - otherwise: true\n          then:\n            rating: fail\n      next: gate\n"
                + "    - id: gate\n      type: approval-gate\n      assignees: [recruiters]\n      next: notify\n"
                + "    - id: notify\n      type: agent\n      next: end\n"
                + "    - id: end\n      type: end\n";
        FakeLlm server = new FakeLlm(List.of(rewrite));
        server.start();
        try (ConfigurableApplicationContext context = startApp(
                "abada.insight.enabled=true",
                "abada.insight.llm.base-url=" + server.baseUrl(),
                "abada.insight.llm.api-key=test-key",
                "abada.insight.llm.model=fake-model")) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");
            for (int i = 1; i <= 4; i++) {
                runInstance(engine, context.getBean(ExternalTaskCommandService.class), Map.of("score", 30));
            }

            context.getBean(InsightWorker.class).runCycle();

            var proposals = context.getBean(InsightProposalRepository.class).findAll();
            assertThat(proposals).singleElement();
            assertThat(proposals.getFirst().getProposedSource()).startsWith("# changed: LLM rewrite");
        } finally {
            server.stop();
        }
    }

    @Test
    void proposalsSurviveRestartAndInvalidLlmPayloadFallsBackTemporarily() throws Exception {
        FakeLlm server = new FakeLlm(List.of("this is not yaml at all"));
        server.start();
        try {
            try (ConfigurableApplicationContext first = startApp(
                    "abada.insight.enabled=true",
                    "abada.insight.llm.base-url=" + server.baseUrl(),
                    "abada.insight.llm.api-key=test-key",
                    "abada.insight.llm.model=fake-model")) {
                first.getBean(DatabaseTestHelper.class).cleanup();
                AbadaEngine engine = first.getBean(AbadaEngine.class);
                deploy(engine, "/apl/candidate-review.apl.yaml");
                for (int i = 1; i <= 4; i++) {
                    runInstance(engine, first.getBean(ExternalTaskCommandService.class), Map.of("score", 30));
                }
                first.getBean(InsightWorker.class).runCycle();

                assertThat(first.getBean(InsightProposalRepository.class).findAll()).singleElement()
                        .satisfies(proposal -> {
                            assertThat(proposal.getStatus()).isEqualTo(InsightProposalEntity.Status.DRAFT);
                            assertThat(proposal.getProposedSource())
                                    .startsWith("# Insight engine working draft");
                        });
            }

            try (ConfigurableApplicationContext restarted = startApp(
                    "abada.insight.enabled=true",
                    "abada.insight.llm.base-url=" + server.baseUrl(),
                    "abada.insight.llm.api-key=test-key",
                    "abada.insight.llm.model=fake-model")) {
                assertThat(restarted.getBean(InsightProposalRepository.class).findAll()).singleElement()
                        .satisfies(proposal ->
                                assertThat(proposal.getStatus()).isEqualTo(InsightProposalEntity.Status.DRAFT));
            }
        } finally {
            server.stop();
        }
    }

    private static void runInstance(AbadaEngine engine,
            ExternalTaskCommandService externalTasks, Map<String, Object> variables) {
        var instance = engine.startProcess("candidate_review", "alice", variables);
        TaskInstance task = engine.getTaskManager().getVisibleTasksForUser("bob", List.of("recruiters"))
                .stream()
                .filter(candidate -> candidate.getProcessInstanceId().equals(instance.getId()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("gate task missing"));
        engine.completeTask(task.getId(), "bob", List.of("recruiters"), Map.of("approved", true));
        var jobs = externalTasks.fetchAndLock(
                new FetchAndLockRequest("worker-a", List.of("abada:agent"), 10_000L));
        if (jobs.size() != 1) {
            throw new AssertionError("expected exactly one agent job, got " + jobs.size());
        }
        externalTasks.complete(jobs.getFirst().id(), Map.of("handled", true));
    }

    private void deploy(AbadaEngine engine, String resource) {
        deployReturning(engine, resource);
    }

    private com.abada.engine.persistence.entity.ProcessDefinitionEntity deployReturning(
            AbadaEngine engine, String resource) {
        try (InputStream stream = getClass().getResourceAsStream(resource)) {
            assertThat(stream).as(resource).isNotNull();
            return engine.deploy(stream);
        } catch (Exception exception) {
            throw new AssertionError("Could not deploy " + resource, exception);
        }
    }

    private InsightProposalEntity proposalFor(
            com.abada.engine.persistence.entity.ProcessDefinitionEntity definition,
            String groups, int approvals, InsightProposalEntity.ApprovalMode mode) {
        InsightProposalEntity proposal = new InsightProposalEntity();
        proposal.setDefinitionKey(definition.getProcessKey());
        proposal.setDefinitionDeploymentId(definition.getDeploymentId());
        proposal.setTargetVersion(definition.getVersion());
        proposal.setTargetChecksum(definition.getChecksum());
        proposal.setTargetSource(definition.getBpmnXml());
        proposal.setProposedSource("# reviewed proposal\n" + definition.getBpmnXml());
        proposal.setRationale("integration governance test");
        proposal.setRequiredGroups(groups);
        proposal.setRequiredApprovals(approvals);
        proposal.setApprovalMode(mode);
        proposal.setStatus(InsightProposalEntity.Status.DRAFT);
        proposal.setCreatedAt(Instant.now());
        proposal.setUpdatedAt(Instant.now());
        return proposal;
    }

    private static ConfigurableApplicationContext startApp(String... insightExtras) {
        String[] properties = new String[] {
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
                "management.otlp.metrics.export.enabled=false",
                "abada.insight.enabled=true",
                "abada.insight.drift-seconds=0",
                "abada.insight.min-attempts=4",
                "abada.insight.min-fallback-samples=4",
                "abada.insight.failure-rate-threshold=0.2",
                "abada.insight.fallback-ratio-threshold=0.5",
                "abada.insight.initial-delay-ms=3600000" };
        String[] merged = new String[properties.length + insightExtras.length];
        System.arraycopy(properties, 0, merged, 0, properties.length);
        System.arraycopy(insightExtras, 0, merged, properties.length, insightExtras.length);
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(
                        context, merged))
                .run("--spring.profiles.active=test");
    }

    /** Minimal OpenAI-compatible chat completions stub on the JDK HTTP server. */
    private static final class FakeLlm {
        private final ArrayDeque<String> answers;
        private HttpServer server;
        private int port;

        FakeLlm(List<String> answers) {
            this.answers = new ArrayDeque<>(answers);
        }

        void start() throws IOException {
            server = HttpServer.create(new InetSocketAddress(0), 0);
            server.createContext("/v1/chat/completions", exchange -> {
                String answer = answers.pollFirst();
                String content = answer == null ? "" : answer;
                byte[] body = ("{\"id\":\"chatcmpl-1\",\"choices\":[{\"index\":0,"
                        + "\"message\":{\"role\":\"assistant\",\"content\":\""
                        + jsonString(content) + "\"},\"finish_reason\":\"stop\"}]}")
                        .getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, body.length);
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(body);
                }
            });
            server.start();
            port = server.getAddress().getPort();
        }

        String baseUrl() {
            return "http://localhost:" + port + "/v1";
        }

        void stop() {
            server.stop(0);
        }

        private static String jsonString(String value) {
            return value.replace("\\", "\\\\").replace("\"", "\\\"")
                    .replace("\n", "\\n");
        }
    }
}
