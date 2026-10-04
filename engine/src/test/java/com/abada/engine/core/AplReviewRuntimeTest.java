package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.InputStream;
import java.util.ArrayList;
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
 * The M2 exit demo under the PostgreSQL authority: an agent drafts, a reviewer
 * rejects with a comment, the agent's next attempt receives that comment, the
 * reviewer approves — inside a bounded loop that survives an engine restart.
 * The engine owns the decision: an undeclared outcome, a missing required
 * comment, or a plain completion of a review is rejected without any change.
 */
@Testcontainers
class AplReviewRuntimeTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_reviews").withUsername("abada").withPassword("abada");

    private static final List<String> REVIEWERS = List.of("reviewers");

    @Test
    void aRejectionCommentReachesTheNextDraftAndAnApprovalEndsTheLoopAcrossARestart() {
        String id;
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine);
            id = engine.startProcess("review_loop", "alice", Map.of()).getId();

            LockedExternalTask first = draft(context, "Dear customer, version 1");
            assertThat(first.variables()).containsEntry("review_comment", null);
            engine.decideTask(openTask(context, id, "review").getId(), "bob", REVIEWERS, "reject",
                    "  Mention the 30-day warranty.  ", Map.of());
            assertThat(engine.getProcessInstanceById(id).getVariables())
                    .containsEntry("review_outcome", "reject")
                    .containsEntry("review_comment", "Mention the 30-day warranty.")
                    .containsEntry("draft_iteration", 2);
        }

        // The engine stops between the rejection and the revised draft.
        try (ConfigurableApplicationContext context = startApplication()) {
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            LockedExternalTask revised = draft(context, "Dear customer, version 2 with warranty");
            assertThat(revised.variables()).containsEntry("review_comment", "Mention the 30-day warranty.");

            engine.decideTask(openTask(context, id, "review").getId(), "bob", REVIEWERS, "approve", null, Map.of());

            ProcessInstance done = engine.getProcessInstanceById(id);
            assertThat(done.isCompleted()).isTrue();
            // An approval without a comment clears the earlier one.
            assertThat(done.getVariables()).containsEntry("review_outcome", "approve")
                    .containsEntry("review_comment", null);
            List<ActivityHistoryEntity> decisions = history(context, id).stream()
                    .filter(entry -> entry.getEventType().equals("TASK_COMPLETED")).toList();
            assertThat(decisions).hasSize(2);
            assertThat(decisions.get(0).getDetailsJson()).contains("\"outcome\":\"reject\"")
                    .contains("\"commentLength\":28").doesNotContain("warranty");
            assertThat(history(context, id)).anySatisfy(entry -> {
                assertThat(entry.getEventType()).isEqualTo("BOUNDARY_TAKEN");
                assertThat(entry.getDetailsJson()).contains("\"kind\":\"OUTCOME\"").contains("\"code\":\"reject\"");
            });
        }
    }

    @Test
    void theEngineRejectsADecisionItCannotHonourWithoutChangingAnything() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine);
            String id = engine.startProcess("review_loop", "alice", Map.of()).getId();
            draft(context, "Dear customer");
            String reviewId = openTask(context, id, "review").getId();

            assertThatThrownBy(() -> engine.decideTask(reviewId, "bob", REVIEWERS, "reject", "  ", Map.of()))
                    .isInstanceOf(ProcessEngineException.class).hasMessageContaining("requires a comment");
            assertThatThrownBy(() -> engine.decideTask(reviewId, "bob", REVIEWERS, "maybe", null, Map.of()))
                    .isInstanceOf(ProcessEngineException.class).hasMessageContaining("Unknown outcome 'maybe'");
            assertThatThrownBy(() -> engine.completeTask(reviewId, "bob", REVIEWERS, Map.of("approved", true)))
                    .isInstanceOf(ProcessEngineException.class).hasMessageContaining("needs a decision");
            assertThatThrownBy(() -> engine.decideTask(reviewId, "bob", REVIEWERS, "approve", null,
                    Map.of("review_outcome", "reject")))
                    .isInstanceOf(ProcessEngineException.class).hasMessageContaining("written by the engine");
            assertThatThrownBy(() -> engine.decideTask(reviewId, "bob", REVIEWERS, "reject", "x".repeat(4_001),
                    Map.of()))
                    .isInstanceOf(ProcessEngineException.class).hasMessageContaining("longer than");
            assertThatThrownBy(() -> engine.decideTask(reviewId, "mallory", List.of("customers"), "approve", null,
                    Map.of()))
                    .isInstanceOf(ProcessEngineException.class);

            ProcessInstance unchanged = engine.getProcessInstanceById(id);
            assertThat(unchanged.getActiveTokens()).containsExactly("review");
            assertThat(unchanged.getVariables()).doesNotContainKeys("review_outcome", "review_comment", "approved");
            assertThat(openTask(context, id, "review").getStatus()).isEqualTo(TaskStatus.AVAILABLE);

            engine.cancelProcessInstance(id, "withdrawn");
            assertThatThrownBy(() -> engine.decideTask(reviewId, "bob", REVIEWERS, "approve", null, Map.of()))
                    .isInstanceOf(ProcessEngineException.class);
        }
    }

    @Test
    void theThirdRejectionEscalates() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine);
            String id = engine.startProcess("review_loop", "alice", Map.of()).getId();

            for (int pass = 1; pass <= 3; pass++) {
                draft(context, "Draft " + pass);
                engine.decideTask(openTask(context, id, "review").getId(), "bob", REVIEWERS, "reject",
                        "Still not right (" + pass + ")", Map.of());
            }

            ProcessInstance escalated = engine.getProcessInstanceById(id);
            assertThat(escalated.getActiveTokens()).containsExactly("escalate");
            assertThat(escalated.getVariables()).containsEntry("review_comment", "Still not right (3)");
        }
    }

    private static LockedExternalTask draft(ConfigurableApplicationContext context, String text) {
        ExternalTaskCommandService workers = context.getBean(ExternalTaskCommandService.class);
        LockedExternalTask task = workers.fetchAndLock(
                new FetchAndLockRequest("drafter", List.of("abada:agent"), 60_000L)).getFirst();
        workers.complete(task.id(), "drafter", Map.of("draft_result", text));
        return task;
    }

    private static TaskEntity openTask(ConfigurableApplicationContext context, String id, String activity) {
        return context.getBean(TaskRepository.class).findAll().stream()
                .filter(task -> task.getProcessInstanceId().equals(id) && task.getTaskDefinitionKey().equals(activity)
                        && task.getEndDate() == null)
                .findFirst().orElseThrow();
    }

    private static List<ActivityHistoryEntity> history(ConfigurableApplicationContext context, String id) {
        return context.getBean(ActivityHistoryRepository.class).findByProcessInstanceIdOrderByOccurredAtAsc(id);
    }

    private static void deploy(AbadaEngine engine) {
        try (InputStream stream = AplReviewRuntimeTest.class.getResourceAsStream("/apl/review-loop.apl.yaml")) {
            engine.deploy(stream);
        } catch (java.io.IOException exception) {
            throw new AssertionError(exception);
        }
    }

    private static ConfigurableApplicationContext startApplication() {
        List<String> properties = new ArrayList<>(List.of(
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
                // A configured provider; no model is ever called (the test acts as the worker).
                "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                "abada.insight.llm.api-key=test-key",
                "otel.sdk.disabled=true",
                "management.tracing.enabled=false",
                "management.otlp.metrics.export.enabled=false"));
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(context,
                        properties.toArray(String[]::new)))
                .run("--spring.profiles.active=test");
    }
}
