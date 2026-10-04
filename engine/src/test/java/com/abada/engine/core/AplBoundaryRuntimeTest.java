package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.CockpitController;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.dto.ExternalTaskFailureDto;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.IncidentDTO;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.JobEntity;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.JobRepository;
import com.abada.engine.persistence.repository.OutboxEventRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
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
 * Boundaries under the PostgreSQL authority: on_timeout interrupts an agent or
 * a human task and retires its work, sla_hours escalates an open task in place,
 * a last failed attempt takes on_error or opens a WORK_FAILED incident that an
 * operator retries (optionally on another allowed model), and rate-limit
 * deferrals keep the attempt budget with a growing, bounded delay.
 */
@Testcontainers
class AplBoundaryRuntimeTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_boundaries").withUsername("abada").withPassword("abada");

    private static final String AGENT_TOPIC = "abada:agent";

    @Test
    void anAgentTimeoutRetiresItsWorkAndTakesTheTimeoutRoute() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployResource(engine, "/apl/boundaries.apl.yaml");
            String id = engine.startProcess("boundaries", "alice", Map.of()).getId();
            LockedExternalTask draft = fetch(context).getFirst();

            fireDue(context, id, JobEntity.Kind.BOUNDARY_TIMEOUT);

            ProcessInstance instance = engine.getProcessInstanceById(id);
            assertThat(instance.getActiveTokens()).containsExactly("manual");
            assertThat(instance.getVariables()).containsEntry("draft_outcome", "TIMEOUT");
            assertThat(externalTask(context, draft.id()).getStatus()).isEqualTo(ExternalTaskEntity.Status.CANCELLED);
            assertThat(history(context, id)).contains("BOUNDARY_TAKEN");

            // The worker's late answer is rejected: its task was retired with the timeout.
            ExternalTaskCommandService workers = context.getBean(ExternalTaskCommandService.class);
            assertThatThrownBy(() -> workers.complete(draft.id(), "worker-1", Map.of("draft_result", "late")))
                    .isInstanceOf(ProcessEngineException.class).hasMessageContaining("not locked");
            assertThat(engine.getProcessInstanceById(id).getActiveTokens()).containsExactly("manual");
        }
    }

    @Test
    void aNormalCompletionCancelsTheTimeoutAndStartsTheReviewTimers() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployResource(engine, "/apl/boundaries.apl.yaml");
            String id = engine.startProcess("boundaries", "alice", Map.of()).getId();
            completeDraft(context);

            List<JobEntity> jobs = jobs(context, id);
            assertThat(jobs).filteredOn(job -> job.getEventId().equals("draft")).singleElement()
                    .satisfies(job -> assertThat(job.getStatus()).isEqualTo(JobEntity.Status.CANCELLED));
            assertThat(jobs).filteredOn(job -> job.getEventId().equals("review")
                            && job.getStatus() == JobEntity.Status.AVAILABLE)
                    .extracting(JobEntity::getKind)
                    .containsExactlyInAnyOrder(JobEntity.Kind.BOUNDARY_TIMEOUT, JobEntity.Kind.SLA);
            TaskEntity review = openTask(context, id, "review");
            assertThat(review.getDueAt()).isNotNull();
            assertThat(java.time.Duration.between(review.getStartDate(), review.getDueAt()))
                    .isEqualTo(java.time.Duration.ofHours(4));
        }
    }

    @Test
    void aMissedServiceLevelEscalatesTheTaskInPlace() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployResource(engine, "/apl/boundaries.apl.yaml");
            String id = engine.startProcess("boundaries", "alice", Map.of()).getId();
            completeDraft(context);

            fireDue(context, id, JobEntity.Kind.SLA);

            TaskEntity review = openTask(context, id, "review");
            assertThat(review.getStatus()).isEqualTo(TaskStatus.AVAILABLE);
            assertThat(review.getEscalatedAt()).isNotNull();
            assertThat(review.getCandidateGroups()).containsExactlyInAnyOrder("reviewers", "managers");
            assertThat(engine.getProcessInstanceById(id).getActiveTokens()).containsExactly("review");
            assertThat(history(context, id)).contains("TASK_SLA_BREACHED");
            assertThat(context.getBean(OutboxEventRepository.class).findByAggregateIdOrderByOccurredAt(id))
                    .anySatisfy(event -> assertThat(event.getEventType()).isEqualTo("TASK_SLA_BREACHED"));

            // A manager added by the escalation can finish the task.
            engine.completeTask(review.getId(), "maria", List.of("managers"), Map.of());
            assertThat(engine.getProcessInstanceById(id).isCompleted()).isTrue();
            assertThat(jobs(context, id)).noneMatch(job -> job.getStatus() == JobEntity.Status.AVAILABLE);
        }
    }

    @Test
    void aHumanTimeoutCancelsTheTaskAndEndsTheRequest() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployResource(engine, "/apl/boundaries.apl.yaml");
            String id = engine.startProcess("boundaries", "alice", Map.of()).getId();
            completeDraft(context);
            String reviewId = openTask(context, id, "review").getId();

            fireDue(context, id, JobEntity.Kind.BOUNDARY_TIMEOUT);

            assertThat(engine.getProcessInstanceById(id).isCompleted()).isTrue();
            assertThat(context.getBean(TaskRepository.class).findById(reviewId).orElseThrow().getStatus())
                    .isEqualTo(TaskStatus.CANCELLED);
            assertThatThrownBy(() -> engine.completeTask(reviewId, "bob", List.of("reviewers"), Map.of()))
                    .isInstanceOf(ProcessEngineException.class);
        }
    }

    @Test
    void theLastFailedAttemptTakesOnError() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployResource(engine, "/apl/boundaries.apl.yaml");
            String id = engine.startProcess("boundaries", "alice", Map.of()).getId();

            String taskId = failAttempt(context, 1);
            failAttempt(context, 0);

            ProcessInstance instance = engine.getProcessInstanceById(id);
            assertThat(instance.getActiveTokens()).containsExactly("manual");
            assertThat(instance.getVariables()).containsEntry("draft_outcome", "ERROR")
                    .containsEntry("draft_error_code", "WORK_FAILED");
            // Routed failure is handled work, not a retryable failed job.
            assertThat(externalTask(context, taskId).getStatus()).isEqualTo(ExternalTaskEntity.Status.CANCELLED);
            assertThat(context.getBean(CockpitController.class).getIncidents(id)).isEmpty();
        }
    }

    @Test
    void unroutedFailureOpensAnIncidentRetriedOnAnotherModelWithAnAuditTrail() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploySource(engine, """
                    version: abada.io/v1
                    metadata: { key: no_route, name: No route }
                    flow:
                      entry: request
                      nodes:
                        - { id: request, type: webhook, next: draft }
                        - id: draft
                          type: agent
                          prompt: Draft a reply
                          model: gemini-3.6-flash
                          max_attempts: 1
                          next: done
                        - { id: done, type: end }
                    """);
            String id = engine.startProcess("no_route", "alice", Map.of()).getId();
            failAttempt(context, 0);

            List<IncidentDTO> incidents = context.getBean(CockpitController.class).getIncidents(id);
            assertThat(incidents).singleElement().satisfies(incident -> {
                assertThat(incident.type()).isEqualTo("WORK_FAILED");
                assertThat(incident.activityId()).isEqualTo("draft");
            });
            String incidentId = incidents.getFirst().id();
            assertThat(engine.getProcessInstanceById(id).getActiveTokens()).containsExactly("draft");

            assertThatThrownBy(() -> engine.retryIncident(id, incidentId, "not-a-model", "quota"))
                    .isInstanceOf(ProcessEngineException.class).hasMessageContaining("allowed model list");
            assertThatThrownBy(() -> engine.retryIncident(id, incidentId, "gemini-3.7-flash", " "))
                    .isInstanceOf(ProcessEngineException.class).hasMessageContaining("reason");

            engine.retryIncident(id, incidentId, "gemini-3.7-flash", "provider quota exhausted until tomorrow");

            LockedExternalTask retried = fetch(context).getFirst();
            assertThat(retried.agentWork().model()).isEqualTo("gemini-3.7-flash");
            assertThat(retried.retries()).isEqualTo(1);
            assertThat(context.getBean(CockpitController.class).getIncidents(id)).singleElement()
                    .satisfies(incident -> assertThat(incident.resolution()).isEqualTo("RETRIED"));
            ActivityHistoryEntity retry = historyEntries(context, id).stream()
                    .filter(entry -> entry.getEventType().equals("INCIDENT_RETRIED")).findFirst().orElseThrow();
            assertThat(retry.getDetailsJson()).contains("\"fromModel\":\"gemini-3.6-flash\"")
                    .contains("\"toModel\":\"gemini-3.7-flash\"")
                    .contains("provider quota exhausted until tomorrow");

            // The override applies to this task only: the next instance uses the designed model.
            engine.startProcess("no_route", "alice", Map.of());
            assertThat(fetch(context)).singleElement()
                    .satisfies(next -> assertThat(next.agentWork().model()).isEqualTo("gemini-3.6-flash"));
        }
    }

    @Test
    void rateLimitDeferralsKeepTheBudgetGrowAndAreBounded() {
        try (ConfigurableApplicationContext context = startApplication("abada.agent.max-deferrals=2",
                "abada.agent.max-deferral-delay=PT10S")) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployResource(engine, "/apl/boundaries.apl.yaml");
            String id = engine.startProcess("boundaries", "alice", Map.of()).getId();
            ExternalTaskCommandService workers = context.getBean(ExternalTaskCommandService.class);

            List<Long> delays = new ArrayList<>();
            String taskId = null;
            for (int deferral = 1; deferral <= 2; deferral++) {
                LockedExternalTask task = fetch(context).getFirst();
                taskId = task.id();
                Instant before = Instant.now();
                workers.handleFailure(task.id(), new ExternalTaskFailureDto("worker-1", "rate limited", "429",
                        2, 1_000L, null, true));
                ExternalTaskEntity stored = externalTask(context, task.id());
                assertThat(stored.getRetries()).as("deferral " + deferral).isEqualTo(2);
                assertThat(stored.getDeferrals()).isEqualTo(deferral);
                delays.add(java.time.Duration.between(before, stored.getLockExpirationTime()).toMillis());
                makeAvailable(context, task.id());
            }
            assertThat(delays.get(1)).isGreaterThan(delays.get(0));
            assertThat(history(context, id)).filteredOn("EXTERNAL_TASK_DEFERRED"::equals).hasSize(2);

            // Past the cap a deferral is an ordinary failed attempt, so waiting is bounded.
            LockedExternalTask third = fetch(context).getFirst();
            workers.handleFailure(third.id(), new ExternalTaskFailureDto("worker-1", "rate limited", "429",
                    2, 1_000L, null, true));
            ExternalTaskEntity stored = externalTask(context, taskId);
            assertThat(stored.getRetries()).isEqualTo(1);
            assertThat(java.time.Duration.between(Instant.now(), stored.getLockExpirationTime()))
                    .isLessThanOrEqualTo(java.time.Duration.ofSeconds(10));
        }
    }

    @Test
    void aPendingTimeoutSurvivesARestartAndFiresOnce() {
        String id;
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployResource(engine, "/apl/boundaries.apl.yaml");
            id = engine.startProcess("boundaries", "alice", Map.of()).getId();
        }
        try (ConfigurableApplicationContext context = startApplication()) {
            fireDue(context, id, JobEntity.Kind.BOUNDARY_TIMEOUT);
            context.getBean(JobScheduler.class).executeDueJobs();

            AbadaEngine engine = context.getBean(AbadaEngine.class);
            assertThat(engine.getProcessInstanceById(id).getActiveTokens()).containsExactly("manual");
            assertThat(history(context, id)).filteredOn("BOUNDARY_TAKEN"::equals).hasSize(1);
        }
    }

    @Test
    void cancellingTheInstanceRetiresAllItsWork() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployResource(engine, "/apl/boundaries.apl.yaml");
            String id = engine.startProcess("boundaries", "alice", Map.of()).getId();
            completeDraft(context);
            String reviewId = openTask(context, id, "review").getId();

            engine.cancelProcessInstance(id, "customer withdrew");

            assertThat(jobs(context, id)).allSatisfy(job -> assertThat(job.getStatus())
                    .isIn(JobEntity.Status.CANCELLED, JobEntity.Status.COMPLETED));
            assertThat(context.getBean(TaskRepository.class).findById(reviewId).orElseThrow().getStatus())
                    .isEqualTo(TaskStatus.CANCELLED);
        }
    }

    private static List<LockedExternalTask> fetch(ConfigurableApplicationContext context) {
        return context.getBean(ExternalTaskCommandService.class)
                .fetchAndLock(new FetchAndLockRequest("worker-1", List.of(AGENT_TOPIC), 60_000L));
    }

    private static void completeDraft(ConfigurableApplicationContext context) {
        LockedExternalTask draft = fetch(context).getFirst();
        context.getBean(ExternalTaskCommandService.class).complete(draft.id(), "worker-1",
                Map.of("draft_result", "Dear customer"));
    }

    /** Fetches the agent task and reports a failed attempt leaving {@code remaining} retries. */
    private static String failAttempt(ConfigurableApplicationContext context, int remaining) {
        LockedExternalTask task = fetch(context).getFirst();
        context.getBean(ExternalTaskCommandService.class).handleFailure(task.id(),
                new ExternalTaskFailureDto("worker-1", "model call failed", "AgentExecutionException", remaining, 0L));
        return task.id();
    }

    /** Makes the pending job of {@code kind} due now and runs the job poller once. */
    private static void fireDue(ConfigurableApplicationContext context, String id, JobEntity.Kind kind) {
        JobRepository repository = context.getBean(JobRepository.class);
        List<JobEntity> pending = jobs(context, id).stream()
                .filter(job -> job.getKind() == kind && job.getStatus() == JobEntity.Status.AVAILABLE).toList();
        assertThat(pending).as("pending " + kind + " job").hasSize(1);
        JobEntity job = pending.getFirst();
        job.setExecutionTimestamp(Instant.now().minusSeconds(1));
        repository.save(job);
        context.getBean(JobScheduler.class).executeDueJobs();
    }

    private static void makeAvailable(ConfigurableApplicationContext context, String taskId) {
        ExternalTaskEntity task = externalTask(context, taskId);
        task.setLockExpirationTime(Instant.now().minusSeconds(1));
        context.getBean(ExternalTaskRepository.class).save(task);
    }

    private static List<JobEntity> jobs(ConfigurableApplicationContext context, String id) {
        return context.getBean(JobRepository.class).findAll().stream()
                .filter(job -> job.getProcessInstanceId().equals(id)).toList();
    }

    private static TaskEntity openTask(ConfigurableApplicationContext context, String id, String activity) {
        return context.getBean(TaskRepository.class).findAll().stream()
                .filter(task -> task.getProcessInstanceId().equals(id) && task.getTaskDefinitionKey().equals(activity)
                        && task.getEndDate() == null)
                .findFirst().orElseThrow();
    }

    private static ExternalTaskEntity externalTask(ConfigurableApplicationContext context, String taskId) {
        return context.getBean(ExternalTaskRepository.class).findById(taskId).orElseThrow();
    }

    private static List<ActivityHistoryEntity> historyEntries(ConfigurableApplicationContext context, String id) {
        return context.getBean(ActivityHistoryRepository.class).findByProcessInstanceIdOrderByOccurredAtAsc(id);
    }

    private static List<String> history(ConfigurableApplicationContext context, String id) {
        return historyEntries(context, id).stream().map(ActivityHistoryEntity::getEventType).toList();
    }

    private static void deployResource(AbadaEngine engine, String resource) {
        try (InputStream stream = AplBoundaryRuntimeTest.class.getResourceAsStream(resource)) {
            engine.deploy(stream);
        } catch (java.io.IOException exception) {
            throw new AssertionError(exception);
        }
    }

    private static void deploySource(AbadaEngine engine, String source) {
        engine.deploy(new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)));
    }

    private static ConfigurableApplicationContext startApplication(String... extraProperties) {
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
                // A configured provider; no model is ever called (the tests act as the worker).
                "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                "abada.insight.llm.api-key=test-key",
                "otel.sdk.disabled=true",
                "management.tracing.enabled=false",
                "management.otlp.metrics.export.enabled=false"));
        properties.addAll(List.of(extraProperties));
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(context,
                        properties.toArray(String[]::new)))
                .run("--spring.profiles.active=test");
    }
}
