package com.abada.engine.core.replay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.insight.InsightPolicyService;
import com.abada.engine.insight.InsightProposalService;
import com.abada.engine.persistence.entity.InsightProposalEntity;
import com.abada.engine.persistence.entity.InsightProposalReviewEntity;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.entity.ReplayCaseEntity;
import com.abada.engine.persistence.entity.ReplayRunEntity;
import com.abada.engine.persistence.repository.InsightProposalRepository;
import com.abada.engine.persistence.repository.ProcessStartInputRepository;
import com.abada.engine.persistence.repository.ProjectRepository;
import com.abada.engine.persistence.repository.ReplayCaseRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * E15 under the PostgreSQL authority: a proposal is replayed on the last recorded cases, nothing but the replay's
 * own tables is written, the diff shows what changed, budgets and cancellation stop a run, an expired lease is
 * claimed again, and a policy can require a finished replay before an approval.
 */
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PostgresReplayTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final List<String> REVIEWERS = List.of("reviewers");

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_replay").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;
    private static MockMvc mvc;
    private static String project;
    private static ProcessDefinitionEntity deployed;
    private static String source;
    private static final List<String> instanceIds = new ArrayList<>();
    private static long proposalId;

    /** Answers every agent step with a fixed result and counts the calls. */
    private static final AtomicInteger MODEL_CALLS = new AtomicInteger();
    private static final ReplayRunner.AgentPort STUB = (activityId, work, inputs) -> {
        MODEL_CALLS.incrementAndGet();
        return new ReplayRunner.AgentAnswer(Map.of("draft_result", "replayed draft"), work.model(), 100, 50,
                new BigDecimal("0.01"), false);
    };

    @BeforeAll
    static void start() throws Exception {
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
        mvc = MockMvcBuilders.webAppContextSetup((WebApplicationContext) context)
                .defaultRequest(get("/").header("X-User", "alice")).build();
        project = JSON.readTree(mvc.perform(post("/v1/projects").contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(Map.of("slug", "replay", "name", "Replay", "description", ""))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("id").asText();
        var projects = context.getBean(ProjectRepository.class);
        var row = projects.findById(project).orElseThrow();
        row.setEvidencePayloads("full");
        projects.save(row);

        source = Files.readString(Path.of("src/test/resources/apl/review-tracked.apl.yaml"));
        deployed = context.getBean(AbadaEngine.class).deploy(project,
                new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)));
        // Six finished cases: the first two were rejected once before they were approved.
        for (int i = 0; i < 6; i++) instanceIds.add(finishedCase(i < 2));
        proposal(changed());
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    @Order(1)
    void aPlanSelectsTheNewestRecordedCasesAndPricesThemFromWhatTheyCost() throws Exception {
        // One case lost its inputs (retention): it cannot be replayed and is counted, not hidden.
        var inputs = context.getBean(ProcessStartInputRepository.class);
        var lost = inputs.findById(instanceIds.get(0)).orElseThrow();
        lost.setInputsEnc(null);
        inputs.save(lost);

        String body = mvc.perform(post("/v1/projects/{p}/insight/proposals/{id}/replays", project, proposalId)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"cases\":10}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PLANNED"))
                .andExpect(jsonPath("$.withoutInputs").value(1))
                .andExpect(jsonPath("$.cases.length()").value(5))
                .andReturn().getResponse().getContentAsString();
        String runId = JSON.readTree(body).path("id").asText();
        assertThat(JSON.readTree(body).path("cases").findValuesAsText("originalInstanceId"))
                .doesNotContain(instanceIds.get(0));

        // A second plan while one is open is refused; a planned run can be cancelled.
        mvc.perform(post("/v1/projects/{p}/insight/proposals/{id}/replays", project, proposalId)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isConflict());
        mvc.perform(post("/v1/projects/{p}/insight/proposals/{id}/replays/{r}/cancel", project, proposalId, runId))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));
        mvc.perform(post("/v1/projects/{p}/insight/proposals/{id}/replays", project, proposalId)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"cases\":0}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @Order(2)
    void aReplayShowsWhatChangedAndWritesNothingButItsOwnTables() throws Exception {
        var counts = runtimeCounts();
        int modelCalls = MODEL_CALLS.get();
        String runId = plan(4, null);
        mvc.perform(post("/v1/projects/{p}/insight/proposals/{id}/replays/{r}/start", project, proposalId, runId))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("RUNNING"));
        drive(runId);

        var view = replays().get(project, runId);
        assertThat(view.run().getStatus()).isEqualTo(ReplayRunEntity.Status.COMPLETED);
        // The proposal asks for 80% confidence; the stub reports none, so every case now goes to escalation,
        // where no reviewer decision was ever recorded.
        assertThat(view.cases()).hasSize(4).allSatisfy(row -> {
            assertThat(row.getState()).isEqualTo(ReplayCaseEntity.State.NEEDS_HUMAN);
            assertThat(row.getStoppedAt()).isEqualTo("escalate");
            assertThat(row.getChanged()).isTrue();
            assertThat(row.isInputsRedacted()).isFalse();
        });
        assertThat(view.aggregate().changed()).isEqualTo(4);
        assertThat(view.aggregate().needsHuman()).isEqualTo(4);
        assertThat(view.aggregate().originallyOverridden()).isEqualTo(
                (int) view.cases().stream().filter(row -> Boolean.TRUE.equals(row.getOriginallyOverridden())).count());
        assertThat(view.run().getCostUsd()).isEqualByComparingTo("0.04");
        assertThat(MODEL_CALLS.get() - modelCalls).isEqualTo(4);

        // Nothing but the replay's tables moved; its own lifecycle (planned, started, completed) is audited.
        Map<String, Long> after = runtimeCounts();
        assertThat(after.get("outbox_events")).isEqualTo(counts.get("outbox_events") + 3);
        after.remove("outbox_events");
        counts.remove("outbox_events");
        assertThat(after).isEqualTo(counts);

        mvc.perform(get("/v1/projects/{p}/insight/proposals/{id}/replays/{r}", project, proposalId, runId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.aggregate.changed").value(4))
                .andExpect(jsonPath("$.cases[0].replayPath[0].outcome").value("LOW_CONFIDENCE"))
                .andExpect(jsonPath("$.cases[0].diff.changed").value(true));
    }

    @Test
    @Order(3)
    void theSameSourceReplaysUnchangedAndCountsTheOverriddenCases() throws Exception {
        proposal(source);
        String runId = plan(6, null);
        replays().start(project, runId, "alice");
        drive(runId);
        var view = replays().get(project, runId);
        assertThat(view.run().getStatus()).isEqualTo(ReplayRunEntity.Status.COMPLETED);
        assertThat(view.aggregate().changed()).isZero();
        assertThat(view.aggregate().originallyOverridden()).isEqualTo(1); // two were rejected; one had no inputs left
        assertThat(view.aggregate().overriddenNowDiffering()).isZero();
        assertThat(view.cases()).allSatisfy(row -> assertThat(row.getState()).isIn(
                ReplayCaseEntity.State.DONE, ReplayCaseEntity.State.NEEDS_HUMAN));
    }

    @Test
    @Order(4)
    void aBudgetStopsTheRunAndSkipsTheRest() throws Exception {
        proposal(changed());
        String runId = plan(5, new BigDecimal("0.015"));
        replays().start(project, runId, "alice");
        driveOneAtATime(runId);
        var view = replays().get(project, runId);
        assertThat(view.run().getStatus()).isEqualTo(ReplayRunEntity.Status.PARTIAL);
        assertThat(view.cases().stream().filter(row -> row.getState() == ReplayCaseEntity.State.SKIPPED))
                .isNotEmpty().allSatisfy(row -> assertThat(row.getStoppedAt()).isEqualTo("BUDGET"));
        assertThat(view.cases().stream().filter(row -> row.getState() == ReplayCaseEntity.State.NEEDS_HUMAN)).hasSize(2);
    }

    @Test
    @Order(5)
    void aCaseWhoseLeaseExpiredIsClaimedAgainAndRecordedOnce() throws Exception {
        proposal(changed());
        String runId = plan(1, null);
        replays().start(project, runId, "alice");
        // A replica claims the case and dies: the lease runs out.
        var first = replays().claim(1, "replica-a");
        assertThat(first).hasSize(1);
        assertThat(replays().claim(1, "replica-b")).isEmpty();
        var cases = context.getBean(ReplayCaseRepository.class);
        var held = cases.findById(first.getFirst().getId()).orElseThrow();
        held.setLeaseUntil(Instant.now().minusSeconds(5));
        cases.save(held);

        var again = replays().claim(1, "replica-b");
        assertThat(again).extracting(ReplayCaseEntity::getId).containsExactly(first.getFirst().getId());
        replays().execute(again.getFirst().getId(), STUB);
        replays().execute(again.getFirst().getId(), STUB); // a late duplicate finds the case settled and does nothing
        var view = replays().get(project, runId);
        assertThat(view.run().getStatus()).isEqualTo(ReplayRunEntity.Status.COMPLETED);
        assertThat(view.cases()).singleElement().satisfies(row -> assertThat(row.getLeaseOwner()).isNull());
    }

    @Test
    @Order(6)
    void aPolicyCanRequireAFinishedReplayOfTheCurrentSourceBeforeAnApproval() throws Exception {
        long id = proposal(source.replace("prompt: \"Draft the offer.", "prompt: \"Write the offer.")).getId();
        var policies = context.getBean(InsightPolicyService.class);
        policies.update(project, "review_tracked", 0, 1, "lane:TECHNICAL", "PARALLEL", "alice", true, 3);
        var proposals = context.getBean(InsightProposalService.class);
        List<String> selectors = List.of("lane:TECHNICAL");

        assertThatThrownBy(() -> proposals.review(project, id, "carol", selectors,
                InsightProposalReviewEntity.Decision.APPROVE, null, null))
                .isInstanceOf(InsightProposalService.ReplayRequiredException.class);
        // Too few cases do not qualify either.
        String small = plan(id, 2, null);
        replays().start(project, small, "alice");
        drive(small);
        assertThatThrownBy(() -> proposals.review(project, id, "carol", selectors,
                InsightProposalReviewEntity.Decision.APPROVE, null, null))
                .isInstanceOf(InsightProposalService.ReplayRequiredException.class);

        String run = plan(id, 4, null);
        replays().start(project, run, "alice");
        drive(run);
        // Editing the proposal afterwards invalidates the replay.
        var proposal = context.getBean(InsightProposalRepository.class).findById(id).orElseThrow();
        String original = proposal.getProposedSource();
        proposal.setProposedSource(original + "\n# edited after the replay\n");
        context.getBean(InsightProposalRepository.class).save(proposal);
        assertThatThrownBy(() -> proposals.review(project, id, "carol", selectors,
                InsightProposalReviewEntity.Decision.APPROVE, null, null))
                .isInstanceOf(InsightProposalService.ReplayRequiredException.class);
        // A rejection is never blocked.
        assertThat(proposals.review(project, id, "dave", selectors, InsightProposalReviewEntity.Decision.REJECT,
                "not for us", null).getStatus()).isEqualTo(InsightProposalEntity.Status.REJECTED);

        // With the source as replayed, a qualifying run lets the approval through.
        long approvable = proposal(source.replace("prompt: \"Draft the offer.", "prompt: \"Compose the offer.")).getId();
        String qualifying = plan(approvable, 4, null);
        replays().start(project, qualifying, "alice");
        drive(qualifying);
        assertThat(proposals.review(project, approvable, "carol", selectors,
                InsightProposalReviewEntity.Decision.APPROVE, null, null).getStatus())
                .isEqualTo(InsightProposalEntity.Status.ADOPTED);
    }

    @Test
    @Order(7)
    void strangersAndWorkersCannotSeeOrStartAReplay() throws Exception {
        mvc.perform(get("/v1/projects/{p}/insight/proposals/{id}/replays", project, proposalId)
                        .header("X-User", "mallory"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/v1/projects/{p}/insight/proposals/{id}/replays", project, proposalId)
                        .header("X-User", "mallory").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isNotFound());
    }

    // ---- helpers ----

    private static ReplayService replays() {
        return context.getBean(ReplayService.class);
    }

    private static String plan(int cases, BigDecimal budget) {
        return plan(proposalId, cases, budget);
    }

    private static String plan(long id, int cases, BigDecimal budget) {
        return replays().plan(project, id, cases, budget, "alice").run().getId();
    }

    /** Runs a started replay to its end the way the worker would, two cases at a time. */
    private static void drive(String runId) {
        for (int guard = 0; guard < 50; guard++) {
            replays().enforceBudgets();
            var run = replays().get(project, runId).run();
            if (run.getStatus() != ReplayRunEntity.Status.RUNNING) return;
            for (ReplayCaseEntity claimed : replays().claim(2, "test")) replays().execute(claimed.getId(), STUB);
        }
        throw new AssertionError("the replay did not finish");
    }

    private static void driveOneAtATime(String runId) {
        for (int guard = 0; guard < 50; guard++) {
            replays().enforceBudgets();
            if (replays().get(project, runId).run().getStatus() != ReplayRunEntity.Status.RUNNING) return;
            for (ReplayCaseEntity claimed : replays().claim(1, "test")) replays().execute(claimed.getId(), STUB);
        }
        throw new AssertionError("the replay did not finish");
    }

    private static Map<String, Long> runtimeCounts() {
        JdbcTemplate jdbc = context.getBean(JdbcTemplate.class);
        Map<String, Long> counts = new java.util.LinkedHashMap<>();
        for (String table : List.of("process_instances", "tasks", "external_tasks", "jobs", "outbox_events",
                "insight_agent_facts", "insight_execution_facts", "event_subscriptions", "process_tokens",
                "process_start_inputs", "agent_steps")) {
            counts.put(table, jdbc.queryForObject("select count(*) from " + table, Long.class));
        }
        counts.put("history_without_replay", jdbc.queryForObject(
                "select count(*) from activity_history where event_type not like 'REPLAY_%'", Long.class));
        return counts;
    }

    /** Only one proposal per deployment is open at a time: the earlier ones are superseded first. */
    private static InsightProposalEntity proposal(String proposed) {
        var repository = context.getBean(InsightProposalRepository.class);
        for (InsightProposalEntity open : repository.findAll()) {
            if (open.getStatus() == InsightProposalEntity.Status.DRAFT
                    || open.getStatus() == InsightProposalEntity.Status.IN_REVIEW) {
                open.setStatus(InsightProposalEntity.Status.SUPERSEDED);
                repository.save(open);
            }
        }
        InsightProposalEntity created = newProposal(proposed);
        proposalId = created.getId();
        return created;
    }

    private static String changed() {
        return source.replace("      reviewed_by:",
                "      confidence_threshold: 80\n      on_low_confidence: escalate\n      reviewed_by:");
    }

    private static InsightProposalEntity newProposal(String proposed) {
        InsightProposalEntity proposal = new InsightProposalEntity();
        proposal.setProjectId(project);
        proposal.setDefinitionKey("review_tracked");
        proposal.setDefinitionDeploymentId(deployed.getDeploymentId());
        proposal.setTargetVersion(deployed.getVersion());
        proposal.setTargetChecksum(deployed.getChecksum());
        proposal.setTargetSource(source);
        proposal.setProposedSource(proposed);
        proposal.setRationale("test");
        proposal.setRequiredGroups("lane:TECHNICAL");
        proposal.setCreatedAt(Instant.now());
        proposal.setUpdatedAt(Instant.now());
        return context.getBean(InsightProposalRepository.class).save(proposal);
    }

    /** Starts an instance, lets the agent draft and a reviewer decide, optionally after one rejection. */
    private static String finishedCase(boolean rejectedOnce) throws Exception {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String id = engine.startProcess(project, "review_tracked", "alice", Map.of("customer", "C-" + instanceIds.size()))
                .getId();
        if (rejectedOnce) {
            draft();
            engine.decideTask(openReview(id), "bob", REVIEWERS, "reject", "Mention the warranty", Map.of());
        }
        draft();
        engine.decideTask(openReview(id), "bob", REVIEWERS, "approve", null, Map.of());
        return id;
    }

    private static void draft() {
        ExternalTaskCommandService workers = context.getBean(ExternalTaskCommandService.class);
        var task = workers.fetchAndLock(new FetchAndLockRequest("drafter", List.of("abada:agent"), 60_000L)).getFirst();
        workers.complete(task.id(), "drafter", Map.of("draft_result", "an offer"));
    }

    private static String openReview(String instanceId) {
        return context.getBean(TaskRepository.class).findAll().stream()
                .filter(task -> task.getProcessInstanceId().equals(instanceId)
                        && task.getTaskDefinitionKey().equals("review") && task.getEndDate() == null)
                .findFirst().orElseThrow().getId();
    }
}
