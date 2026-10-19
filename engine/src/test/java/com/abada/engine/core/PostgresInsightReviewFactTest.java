package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.entity.InsightAgentFactEntity;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.InsightAgentFactRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
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
 * E14 under the PostgreSQL authority: each agent visit leaves one fact, the
 * reviewer's decision completes it in the decision's own transaction, a rework
 * loop pairs every pass with its own review, and a refused decision changes nothing.
 */
@Testcontainers
class PostgresInsightReviewFactTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_review_facts").withUsername("abada").withPassword("abada");

    private static final List<String> REVIEWERS = List.of("reviewers");

    @Test
    void everyPassOfAReworkLoopPairsItsVisitWithItsOwnReview() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine);
            String id = engine.startProcess("review_tracked", "alice", Map.of()).getId();
            InsightAgentFactRepository facts = context.getBean(InsightAgentFactRepository.class);

            draft(context, "version 1");
            assertThat(facts.findAll()).singleElement().satisfies(fact -> {
                assertThat(fact.getAgentNode()).isEqualTo("draft");
                assertThat(fact.getReviewNode()).isEqualTo("review");
                assertThat(fact.getReviewedAt()).isNull();
                assertThat(fact.getOverridden()).isNull();
            });

            String reviewId = openTask(context, id, "review").getId();
            assertThatThrownBy(() -> engine.decideTask(reviewId, "bob", REVIEWERS, "reject", " ", Map.of()))
                    .isInstanceOf(ProcessEngineException.class);
            assertThat(facts.findAll()).singleElement().satisfies(fact -> assertThat(fact.getReviewedAt()).isNull());

            engine.decideTask(reviewId, "bob", REVIEWERS, "reject", "Mention the warranty.", Map.of());
            draft(context, "version 2");
            engine.decideTask(openTask(context, id, "review").getId(), "bob", REVIEWERS, "approve", null, Map.of());

            List<InsightAgentFactEntity> rows = facts.findAll().stream()
                    .sorted(Comparator.comparing(InsightAgentFactEntity::getEndedAt)).toList();
            assertThat(rows).hasSize(2);
            assertThat(rows.get(0).getReviewOutcome()).isEqualTo("reject");
            assertThat(rows.get(0).getOverridden()).isTrue();
            assertThat(rows.get(1).getReviewOutcome()).isEqualTo("approve");
            assertThat(rows.get(1).getOverridden()).isFalse();
            assertThat(rows).allSatisfy(row -> assertThat(row.getReviewedAt()).isNotNull());
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
        try (InputStream stream = PostgresInsightReviewFactTest.class.getResourceAsStream("/apl/review-tracked.apl.yaml")) {
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
