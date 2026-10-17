package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.CockpitController;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.dto.ActivityHistoryDto;
import com.abada.engine.dto.ExternalTaskBpmnErrorRequest;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.FlowTakenDto;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.project.ProjectConstants;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * M5 S2 under the PostgreSQL authority: every sequence flow a token takes is a
 * {@code FLOW_TAKEN} history fact written in the command's transaction, with the
 * matched condition, the route that sent it and its loop pass, and exposed
 * typed in the instance history DTO. A rolled-back command leaves none.
 */
@Testcontainers
class FlowHistoryRuntimeTest {
    private static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_flows").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;

    @BeforeAll
    static void start() throws Exception {
        context = startApplication();
        for (String fixture : List.of("condition-router", "parallel-fork-join", "review-loop", "rework-loop",
                "routing-agent", "boundaries")) {
            engine().deploy(PROJECT, new ByteArrayInputStream(
                    Files.readAllBytes(Path.of("src/test/resources/apl/" + fixture + ".apl.yaml"))));
        }
        engine().deploy(PROJECT, new ByteArrayInputStream("""
                version: abada.io/v1
                metadata: { key: score_gate, name: Score gate }
                flow:
                  entry: request
                  nodes:
                    - { id: request, type: webhook, next: review }
                    - { id: review, type: human-input, assignees: [reviewers], next: decide }
                    - id: decide
                      type: condition
                      rules:
                        - if: "score >= 750"
                          then: approved
                        - else: true
                          then: declined
                    - { id: approved, type: end }
                    - { id: declined, type: end }
                """.getBytes(StandardCharsets.UTF_8)));
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void aSequentialPathRecordsEveryFlowInOrder() {
        String id = engine().startProcess(PROJECT, "rating_router", "alice", Map.of("rating", "silver")).getId();
        complete(id, "abada:silver-tier", Map.of());

        assertThat(hops(id)).containsExactly("start>route", "route>silverDesk", "silverDesk>end");
        List<FlowTakenDto> flows = flows(id);
        assertThat(flows).extracting(FlowTakenDto::id)
                .containsExactly("Flow_start_route", "Flow_route_silverDesk", "Flow_silverDesk_end");
        assertThat(flows).extracting(FlowTakenDto::tokenId).doesNotContainNull().containsOnly(flows.get(0).tokenId());
        assertThat(flows.get(2).route()).isNull();
        assertThat(flows.get(2).loopIteration()).isNull();
        // The raw details carry the same fact for clients reading details.
        assertThat(raw(id)).allSatisfy(details -> assertThat(details).contains("\"flow\":{\"id\":"));
    }

    @Test
    void aConditionRecordsTheRuleThatMatchedOrItsElse() {
        String gold = engine().startProcess(PROJECT, "rating_router", "alice", Map.of("rating", "gold")).getId();
        assertThat(hops(gold)).containsExactly("start>route", "route>goldDesk");
        assertThat(flowInto(gold, "goldDesk").condition()).isEqualTo("rating == \"gold\"");
        assertThat(flowInto(gold, "goldDesk").otherwise()).isNull();

        String other = engine().startProcess(PROJECT, "rating_router", "bob", Map.of("rating", "tin")).getId();
        assertThat(hops(other)).containsExactly("start>route", "route>basicDesk");
        assertThat(flowInto(other, "basicDesk").otherwise()).isTrue();
        assertThat(flowInto(other, "basicDesk").condition()).isNull();
    }

    @Test
    void aParallelSplitRecordsEachBranchAndTheJoinEachArrival() {
        String id = engine().startProcess(PROJECT, "parallel_fork_join", "alice", Map.of()).getId();
        assertThat(hops(id)).containsExactly("start>fanout", "fanout>creditDesk", "fanout>fraudDesk");
        complete(id, "abada:credit-check", Map.of());
        assertThat(hops(id)).endsWith("creditDesk>rejoin");
        complete(id, "abada:fraud-check", Map.of());
        assertThat(hops(id)).endsWith("creditDesk>rejoin", "fraudDesk>rejoin", "rejoin>archive");

        List<FlowTakenDto> flows = flows(id);
        String credit = flowInto(id, "creditDesk").tokenId();
        String fraud = flowInto(id, "fraudDesk").tokenId();
        assertThat(credit).isNotEqualTo(fraud);
        // Each branch token arrives on its own; the forking token continues after the join.
        assertThat(flows).filteredOn(flow -> flow.to().equals("rejoin")).extracting(FlowTakenDto::tokenId)
                .containsExactly(credit, fraud);
        assertThat(flowInto(id, "archive").tokenId()).isEqualTo(flowInto(id, "fanout").tokenId());
    }

    @Test
    void aBoundedLoopRecordsTheBackEdgeWithItsPassAndTheExhaustedRoute() {
        String id = engine().startProcess(PROJECT, "rework_loop", "alice", Map.of()).getId();
        for (int pass = 1; pass <= 3; pass++) {
            complete(id, "rework-draft", Map.of());
            completeTask(id, "review", Map.of("approved", false));
        }
        assertThat(flows(id)).filteredOn(flow -> flow.to().equals("draft")).extracting(FlowTakenDto::from,
                FlowTakenDto::loopIteration, flow -> Boolean.TRUE.equals(flow.otherwise()))
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("request", 1, false),
                        org.assertj.core.groups.Tuple.tuple("decide", 2, true),
                        org.assertj.core.groups.Tuple.tuple("decide", 3, true),
                        // The fourth entry is refused: the token travelled the back-edge, then the exhausted route.
                        org.assertj.core.groups.Tuple.tuple("decide", null, true));
        FlowTakenDto exhausted = flows(id).getLast();
        assertThat(exhausted.from()).isEqualTo("draft");
        assertThat(exhausted.to()).isEqualTo("escalate");
        assertThat(exhausted.route().kind()).isEqualTo("LOOP_EXHAUSTED");
        assertThat(exhausted.id()).isNull();
    }

    @Test
    void reviewOutcomesAndAgentRoutesRecordTheRouteTheyChose() {
        String review = engine().startProcess(PROJECT, "review_loop", "alice", Map.of()).getId();
        draft(review);
        engine().decideTask(openTask(review, "review"), "bob", List.of("reviewers"), "reject", "Too short",
                Map.of());
        FlowTakenDto rejected = flowInto(review, "draft", 2);
        assertThat(rejected.from()).isEqualTo("review");
        assertThat(rejected.route()).isEqualTo(new FlowTakenDto.Route("OUTCOME", "reject"));
        assertThat(rejected.loopIteration()).isEqualTo(2);
        draft(review);
        engine().decideTask(openTask(review, "review"), "bob", List.of("reviewers"), "approve", null, Map.of());
        assertThat(flowInto(review, "done").route()).isEqualTo(new FlowTakenDto.Route("OUTCOME", "approve"));
        // The reviewer's comment is evidence of the task, never of the path.
        assertThat(raw(review)).noneMatch(details -> details.contains("Too short"));

        Map<String, Object> variables = new HashMap<>(Map.of("request_text", "refund order 7", "amount", 20.0));
        String routed = engine().startProcess(PROJECT, "routing_agent", "alice", variables).getId();
        LockedExternalTask triage = lock(routed, "abada:agent");
        workers().complete(triage.id(), "w", Map.of("triage_result",
                Map.of("route", "refund", "summary", "routed", "_confidence", 92)));
        assertThat(flowInto(routed, "refund").route()).isEqualTo(new FlowTakenDto.Route("ROUTE", "refund"));
    }

    @Test
    void aBoundaryExitRecordsTheBoundaryFlow() {
        String id = engine().startProcess(PROJECT, "boundaries", "alice", Map.of()).getId();
        LockedExternalTask draft = lock(id, "abada:agent");
        workers().handleBpmnError(draft.id(),
                new ExternalTaskBpmnErrorRequest("w", "MODEL_DOWN", "provider unavailable", Map.of()));

        FlowTakenDto taken = flowInto(id, "manual");
        assertThat(taken.from()).isEqualTo("draft");
        assertThat(taken.route().kind()).isEqualTo("ERROR");
        assertThat(taken.id()).startsWith("Flow_draft_manual");
        assertThat(hops(id)).doesNotContain("draft>review");
    }

    @Test
    void aRolledBackCommandLeavesNoFlowRecord() {
        String id = engine().startProcess(PROJECT, "score_gate", "alice", Map.of()).getId();
        assertThat(hops(id)).containsExactly("request>review");

        // No score: the condition cannot decide and the completion fails after the token left the task.
        assertThatThrownBy(() -> completeTask(id, "review", Map.of())).isInstanceOf(RuntimeException.class);
        assertThat(hops(id)).containsExactly("request>review");
        assertThat(engine().getProcessInstanceById(id).getActiveTokens()).containsExactly("review");

        completeTask(id, "review", Map.of("score", 780));
        assertThat(hops(id)).containsExactly("request>review", "review>decide", "decide>approved");
        assertThat(flowInto(id, "approved").condition()).isEqualTo("score >= 750");
    }

    // ---------------------------------------------------------------- helpers

    private static AbadaEngine engine() {
        return context.getBean(AbadaEngine.class);
    }

    private static ExternalTaskCommandService workers() {
        return context.getBean(ExternalTaskCommandService.class);
    }

    /** The recorded flows as served by GET /api/v1/process-instances/{id}/history. */
    private static List<FlowTakenDto> flows(String id) {
        List<ActivityHistoryDto> history = context.getBean(CockpitController.class)
                .getHistory(id, 0, 100).getBody();
        return Objects.requireNonNull(history).stream()
                .filter(event -> event.eventType().equals("FLOW_TAKEN"))
                .map(ActivityHistoryDto::flow).toList();
    }

    private static List<String> hops(String id) {
        return flows(id).stream().map(flow -> flow.from() + ">" + flow.to()).toList();
    }

    private static FlowTakenDto flowInto(String id, String target) {
        return flows(id).stream().filter(flow -> flow.to().equals(target)).findFirst().orElseThrow();
    }

    private static FlowTakenDto flowInto(String id, String target, int visit) {
        return flows(id).stream().filter(flow -> flow.to().equals(target)).skip(visit - 1L).findFirst()
                .orElseThrow();
    }

    private static List<String> raw(String id) {
        return context.getBean(JdbcTemplate.class).queryForList("select details_json from activity_history"
                + " where process_instance_id = ? and event_type = 'FLOW_TAKEN'", String.class, id);
    }

    private static LockedExternalTask lock(String id, String topic) {
        return workers().fetchAndLock(new FetchAndLockRequest("w", List.of(topic), 60_000L, 50)).stream()
                .filter(task -> task.processInstanceId().equals(id)).findFirst()
                .orElseThrow(() -> new AssertionError("no " + topic + " task for " + id));
    }

    private static void complete(String id, String topic, Map<String, Object> variables) {
        workers().complete(lock(id, topic).id(), "w", variables);
    }

    private static void draft(String id) {
        workers().complete(lock(id, "abada:agent").id(), "w", Map.of("draft_result", "Dear customer"));
    }

    private static String openTask(String id, String activity) {
        return context.getBean(TaskRepository.class).findAll().stream()
                .filter(task -> task.getProcessInstanceId().equals(id) && task.getTaskDefinitionKey().equals(activity)
                        && task.getStatus() == TaskStatus.AVAILABLE)
                .findFirst().orElseThrow().getId();
    }

    private static void completeTask(String id, String activity, Map<String, Object> variables) {
        engine().completeTask(openTask(id, activity), "bob", List.of("reviewers"), variables);
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
