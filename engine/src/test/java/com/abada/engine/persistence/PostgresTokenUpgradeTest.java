package com.abada.engine.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.EventManager;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.persistence.entity.JobEntity;
import com.abada.engine.persistence.repository.JobRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.sql.DriverManager;
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
 * Upgrading a running 1.0.0-rc.8 database to V23 keeps in-flight instances
 * moving. The test creates real instances, turns the database back into the
 * exact rc.8 shape (V23 objects dropped, legacy JSON as rc.8 writes it, work
 * rows without token ids), then starts the engine again: Flyway applies V23
 * and each instance is converted on its first command and runs to completion.
 */
@Testcontainers
class PostgresTokenUpgradeTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_token_upgrade").withUsername("abada").withPassword("abada");

    private static final String JOIN = """
            version: abada.io/v1
            metadata: { key: upgrade_join, name: Upgrade join }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: fork }
                - { id: fork, type: parallel, branches: [a, b] }
                - { id: a, type: engine-task, service: upgrade-a, next: join }
                - { id: b, type: engine-task, service: upgrade-b, next: join }
                - { id: join, type: parallel, next: after }
                - { id: after, type: decision-table, rules: [ { otherwise: { then: { joined: true } } } ], next: done }
                - { id: done, type: end }
            """;
    private static final String RACE = """
            version: abada.io/v1
            metadata: { key: upgrade_race, name: Upgrade race }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: race }
                - id: race
                  type: event-gateway
                  events:
                    - { type: message-catch, message: UpgradePaid, next: after }
                    - { type: timer, duration: PT1H, next: done }
                - { id: after, type: decision-table, rules: [ { otherwise: { then: { paid: true } } } ], next: done }
                - { id: done, type: end }
            """;
    private static final String REVIEW = """
            version: abada.io/v1
            metadata: { key: upgrade_review, name: Upgrade review }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: review }
                - { id: review, type: human-input, assignees: [reviewers], next: after }
                - { id: after, type: decision-table, rules: [ { otherwise: { then: { reviewed: true } } } ], next: done }
                - { id: done, type: end }
            """;

    @Test
    void inFlightRc8InstancesAreConvertedOnTheirFirstCommandAfterTheUpgrade() throws Exception {
        String joinId;
        String raceId;
        String reviewId;
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            engine.deploy(new ByteArrayInputStream(JOIN.getBytes(StandardCharsets.UTF_8)));
            engine.deploy(new ByteArrayInputStream(RACE.getBytes(StandardCharsets.UTF_8)));
            engine.deploy(new ByteArrayInputStream(REVIEW.getBytes(StandardCharsets.UTF_8)));
            ExternalTaskCommandService externalTasks = context.getBean(ExternalTaskCommandService.class);

            joinId = engine.startProcess("upgrade_join", "alice", Map.of()).getId();
            var branchA = externalTasks.fetchAndLock(new FetchAndLockRequest("w", List.of("upgrade-a"), 60_000L));
            externalTasks.complete(branchA.getFirst().id(), "w", Map.of());
            raceId = engine.startProcess("upgrade_race", "alice", Map.of("correlationKey", "k-1")).getId();
            reviewId = engine.startProcess("upgrade_review", "alice", Map.of()).getId();
        }

        // Back to the rc.8 schema (V22) with the state rc.8 itself would have written.
        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                POSTGRES.getPassword()); var statement = connection.createStatement()) {
            // Undo V32, V31, V30, V29, V28, V27, V26, V25, V24, then V23.
            statement.execute("drop index idx_agent_steps_child");
            statement.execute("alter table agent_steps drop column child_instance_id");
            statement.execute("drop index idx_tasks_agent_step");
            statement.execute("alter table tasks drop column kind");
            statement.execute("alter table tasks drop column agent_step_id");
            statement.execute("drop table model_prices");
            statement.execute("alter table projects drop column evidence_payloads");
            statement.execute("alter table projects drop column evidence_retention_days");
            for (String column : List.of("attempt_cost_usd", "attempt_cost_unpriced", "attempt_prompt_tokens",
                    "attempt_completion_tokens")) {
                statement.execute("alter table external_tasks drop column " + column);
            }
            statement.execute("drop index idx_jobs_related_instance");
            statement.execute("alter table jobs drop column related_instance_id");
            statement.execute("drop index idx_process_instances_parent");
            statement.execute("drop index idx_process_instances_root");
            for (String column : List.of("parent_instance_id", "parent_token_id", "parent_activity_id",
                    "root_instance_id", "call_depth", "started_by_agent")) {
                statement.execute("alter table process_instances drop column " + column);
            }
            statement.execute("alter table process_definitions drop column call_targets");
            statement.execute("drop table agent_steps");
            statement.execute("alter table external_tasks drop column attempt");
            statement.execute("drop table tool_credentials");
            statement.execute("alter table process_definitions drop column tool_bindings");
            statement.execute("alter table project_resources drop constraint ck_project_resource_kind");
            statement.execute("alter table project_resources add constraint ck_project_resource_kind "
                    + "check (kind in ('FORM', 'RESOURCE'))");
            statement.execute("drop index idx_jobs_instance_token_kind");
            statement.execute("alter table jobs drop column job_kind");
            statement.execute("alter table jobs drop column boundary_id");
            statement.execute("alter table tasks drop column due_at");
            statement.execute("alter table tasks drop column escalated_at");
            statement.execute("alter table external_tasks drop column model_override");
            statement.execute("alter table external_tasks drop column deferrals");
            statement.execute("drop table incidents");
            statement.execute("drop index idx_event_subscription_instance_activity");
            statement.execute("alter table event_subscriptions add constraint uk_event_subscription "
                    + "unique (process_instance_id, activity_id)");
            statement.execute("drop table process_tokens");
            for (String table : List.of("tasks", "external_tasks", "jobs", "event_subscriptions")) {
                statement.execute("alter table " + table + " drop column token_id");
            }
            statement.execute("delete from flyway_schema_history where version in ('23', '24', '25', '26', '27', '28', '29', '30', '31', '32')");
            legacyState(statement, joinId, "b", "[\"b\"]", "{\"join\":2}", "{\"join\":[\"a\"]}");
            legacyState(statement, raceId, "race_e0", "[\"race_e0\",\"race_e1\"]", "{}", "{}");
            legacyState(statement, reviewId, "review", "[\"review\"]", "{}", "{}");
        }

        try (ConfigurableApplicationContext context = startApplication()) {
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            ExternalTaskCommandService externalTasks = context.getBean(ExternalTaskCommandService.class);

            // Mid-join: branch a already arrived under rc.8; completing b fires the join.
            var branchB = externalTasks.fetchAndLock(new FetchAndLockRequest("w", List.of("upgrade-b"), 60_000L));
            assertThat(branchB).singleElement().satisfies(task -> assertThat(task.activityId()).isEqualTo("b"));
            externalTasks.complete(branchB.getFirst().id(), "w", Map.of());
            var joined = engine.getProcessInstanceById(joinId);
            assertThat(joined.isCompleted()).isTrue();
            assertThat(joined.getVariables()).containsEntry("joined", true);

            // Event race: the message wins and the competing rc.8 timer job is cancelled.
            context.getBean(EventManager.class).correlateMessage("UpgradePaid", "k-1", Map.of());
            var raced = engine.getProcessInstanceById(raceId);
            assertThat(raced.isCompleted()).isTrue();
            assertThat(raced.getVariables()).containsEntry("paid", true);
            assertThat(context.getBean(JobRepository.class).findAll()).filteredOn(job ->
                    job.getProcessInstanceId().equals(raceId)).extracting(JobEntity::getStatus)
                    .containsOnly(JobEntity.Status.CANCELLED);

            // A user task created by rc.8 (no token id) still completes.
            var task = context.getBean(TaskRepository.class).findAll().stream()
                    .filter(candidate -> candidate.getProcessInstanceId().equals(reviewId)).findFirst().orElseThrow();
            assertThat(task.getTokenId()).isNull();
            engine.completeTask(task.getId(), "alice", List.of("reviewers"), Map.of());
            assertThat(engine.getProcessInstanceById(reviewId).getVariables()).containsEntry("reviewed", true);
        }

        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                POSTGRES.getPassword());
             var tokens = connection.prepareStatement(
                     "select count(*), sum(case when state in ('ACTIVE','WAITING','ARRIVED','FORKED','EVENT_WAIT') "
                             + "then 1 else 0 end) from process_tokens where process_instance_id = ?")) {
            for (String id : List.of(joinId, raceId, reviewId)) {
                tokens.setString(1, id);
                try (var result = tokens.executeQuery()) {
                    assertThat(result.next()).isTrue();
                    assertThat(result.getInt(1)).as("converted token rows of " + id).isPositive();
                    assertThat(result.getInt(2)).as("live tokens of completed " + id).isZero();
                }
            }
        }
    }

    @Test
    void newWorkNamesItsTokenAndTheLegacyColumnsStayReadableByRc8() throws Exception {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            engine.deploy(new ByteArrayInputStream(JOIN.getBytes(StandardCharsets.UTF_8)));
            ExternalTaskCommandService externalTasks = context.getBean(ExternalTaskCommandService.class);

            String id = engine.startProcess("upgrade_join", "alice", Map.of()).getId();
            var branchA = externalTasks.fetchAndLock(new FetchAndLockRequest("w", List.of("upgrade-a"), 60_000L));
            externalTasks.complete(branchA.getFirst().id(), "w", Map.of());

            try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                    POSTGRES.getPassword())) {
                try (var work = connection.prepareStatement("select e.token_id, t.state from external_tasks e "
                        + "join process_tokens t on t.id = e.token_id where e.process_instance_id = ? "
                        + "order by e.activity_id")) {
                    work.setString(1, id);
                    try (var result = work.executeQuery()) {
                        assertThat(result.next()).isTrue();
                        assertThat(result.getString("state")).as("branch a arrived at the join").isEqualTo("ARRIVED");
                        assertThat(result.next()).isTrue();
                        assertThat(result.getString("state")).as("branch b waits").isEqualTo("WAITING");
                    }
                }
                // rc.8 reads these columns: one waiting activity, and a join whose
                // arrival count is still below its expectation.
                try (var legacy = connection.prepareStatement("select current_activity_id, active_tokens_json, "
                        + "join_expected_tokens_json, join_arrived_tokens_json from process_instances where id = ?")) {
                    legacy.setString(1, id);
                    try (var result = legacy.executeQuery()) {
                        assertThat(result.next()).isTrue();
                        assertThat(result.getString(1)).isEqualTo("b");
                        assertThat(result.getString(2)).isEqualTo("[\"b\"]");
                        assertThat(result.getString(3)).isEqualTo("{\"join\":2}");
                        assertThat(result.getString(4)).matches("\\{\"join\":\\[\"[0-9a-f-]{36}\"]}");
                    }
                }
            }
        }
    }

    private static final String TWO_REVIEWS = """
            version: abada.io/v1
            metadata: { key: upgrade_two_reviews, name: Upgrade two reviews }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: review }
                - { id: review, type: human-input, assignees: [reviewers], next: review2 }
                - { id: review2, type: human-input, assignees: [reviewers], next: after }
                - { id: after, type: decision-table, rules: [ { otherwise: { then: { reviewed: true } } } ], next: done }
                - { id: done, type: end }
            """;

    /**
     * Upgrade, roll back to rc.8, let rc.8 advance an instance, upgrade again:
     * rc.8 updated only the legacy columns, so the token rows are stale. The
     * engine detects the mismatch and rebuilds the tokens from the legacy state.
     */
    @Test
    void tokenRowsLeftStaleByAnOlderEngineAreRebuiltFromTheLegacyState() throws Exception {
        String id;
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            engine.deploy(new ByteArrayInputStream(TWO_REVIEWS.getBytes(StandardCharsets.UTF_8)));
            id = engine.startProcess("upgrade_two_reviews", "alice", Map.of()).getId();
            TaskRepository tasks = context.getBean(TaskRepository.class);
            var first = tasks.findAll().stream().filter(task -> task.getProcessInstanceId().equals(id))
                    .findFirst().orElseThrow();
            engine.completeTask(first.getId(), "alice", List.of("reviewers"), Map.of());
        }

        // What rc.8 leaves behind after it, not this engine, completed the first
        // review: the legacy columns name review2, the second task has no token,
        // and the token rows still describe the first review.
        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                POSTGRES.getPassword()); var statement = connection.createStatement()) {
            statement.execute("update process_tokens set activity_id = 'review' where process_instance_id = '"
                    + id + "' and state = 'WAITING'");
            statement.execute("update tasks set token_id = null where process_instance_id = '" + id + "'");
        }

        try (ConfigurableApplicationContext context = startApplication()) {
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            var second = context.getBean(TaskRepository.class).findAll().stream()
                    .filter(task -> task.getProcessInstanceId().equals(id)
                            && task.getTaskDefinitionKey().equals("review2"))
                    .findFirst().orElseThrow();

            engine.completeTask(second.getId(), "alice", List.of("reviewers"), Map.of());

            var completed = engine.getProcessInstanceById(id);
            assertThat(completed.isCompleted()).isTrue();
            assertThat(completed.getVariables()).containsEntry("reviewed", true);
            assertThat(completed.getTokens()).noneMatch(token -> token.state().isLive());
        }
    }

    private static void legacyState(java.sql.Statement statement, String id, String current, String active,
            String expected, String arrived) throws Exception {
        statement.execute("update process_instances set current_activity_id = '" + current
                + "', active_tokens_json = '" + active + "', join_expected_tokens_json = '" + expected
                + "', join_arrived_tokens_json = '" + arrived + "' where id = '" + id + "'");
    }

    private static ConfigurableApplicationContext startApplication() {
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(context,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=3",
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
