package com.abada.engine.core.delegation;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.JobScheduler;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LineageDto;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.IncidentEntity;
import com.abada.engine.persistence.entity.JobEntity;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.IncidentRepository;
import com.abada.engine.persistence.repository.JobRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.project.ProjectConstants;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
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
 * E20a under the PostgreSQL authority: a parent calls a governed child, waits
 * and continues with only the declared outputs; failures, timeouts, cancels,
 * depth and version pinning behave as the contract says.
 */
@Testcontainers
class PostgresCallProcessTest {
    static final String PROJECT = ProjectConstants.DEFAULT_PROJECT_ID;

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_calls").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;

    @BeforeAll
    static void start() {
        context = startApplication(POSTGRES, false);
        deployFixture(context, "call-fraud-check.apl.yaml");
        deployFixture(context, "call-refund.apl.yaml");
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void theParentWaitsAndContinuesWithOnlyTheDeclaredOutputs() {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String parent = engine.startProcess(PROJECT, "refund_with_check", "alice",
                Map.of("case_id", "c-1", "amount", 120.5, "iban", "DE89-secret")).getId();

        LineageDto lineage = engine.lineage(parent);
        assertThat(lineage.children()).singleElement().satisfies(child -> {
            assertThat(child.processDefinitionId()).isEqualTo("fraud_check");
            assertThat(child.parentActivityId()).isEqualTo("fraud_check");
            assertThat(child.depth()).isEqualTo(1);
        });
        String child = lineage.children().getFirst().instanceId();
        ProcessInstance started = engine.getProcessInstanceById(child);
        assertThat(started.getVariables()).containsOnlyKeys("case_id", "amount");
        assertThat(started.getStartedBy()).isEqualTo("alice");
        assertThat(engine.lineage(child).ancestors()).extracting(LineageDto.Link::instanceId).containsExactly(parent);
        assertThat(engine.lineage(child).rootInstanceId()).isEqualTo(parent);

        complete(context, "fraud.score", child, Map.of("verdict", "clean", "score", 0.1));
        assertThat(engine.getProcessInstanceById(child).getStatus()).isEqualTo(ProcessStatus.COMPLETED);
        assertThat(engine.getProcessInstanceById(parent).getActiveTokens()).containsExactly("fraud_check");

        runJobs(context);
        ProcessInstance resumed = engine.getProcessInstanceById(parent);
        assertThat(resumed.getActiveTokens()).containsExactly("decide");
        assertThat(resumed.getVariables()).containsEntry("fraud_verdict", "clean")
                .containsEntry("fraud_check_outcome", "OK").doesNotContainKey("score").doesNotContainKey("verdict");
        assertThat(events(context, parent)).contains("CHILD_STARTED", "CHILD_COMPLETED");
        assertThat(events(context, child)).contains("PROCESS_STARTED");
    }

    @Test
    void aChildCancelledByAnOperatorTakesTheParentsOnErrorRoute() {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String parent = engine.startProcess(PROJECT, "refund_with_check", "alice",
                Map.of("case_id", "c-2", "amount", 10)).getId();
        String child = onlyChild(engine, parent);

        engine.cancelProcessInstance(child, "operator stopped the check");
        runJobs(context);

        ProcessInstance routed = engine.getProcessInstanceById(parent);
        assertThat(routed.getActiveTokens()).containsExactly("manual_review");
        assertThat(routed.getVariables()).containsEntry("fraud_check_error_code", "CHILD_FAILED");
    }

    @Test
    void inputsThatDoNotFitTheChildsDeclaredTypesNeverStartAChild() {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String parent = engine.startProcess(PROJECT, "refund_with_check", "alice",
                Map.of("case_id", "c-3", "amount", "a lot")).getId();

        assertThat(engine.lineage(parent).children()).isEmpty();
        ProcessInstance routed = engine.getProcessInstanceById(parent);
        assertThat(routed.getActiveTokens()).containsExactly("manual_review");
        assertThat(routed.getVariables()).containsEntry("fraud_check_error_code", "CHILD_INPUT_INVALID");
    }

    @Test
    void withoutAnErrorRouteAFailedChildOpensAnIncidentAndRetryStartsANewChild() {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        deploy(context, """
                version: abada.io/v1
                metadata: { key: strict_refund, name: Strict refund }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: check }
                    - id: check
                      type: call-process
                      process: fraud_check
                      inputs: { case_id: "${case_id}" }
                      outputs: { verdict: verdict }
                      next: done
                    - { id: done, type: end }
                """);
        String parent = engine.startProcess(PROJECT, "strict_refund", "alice", Map.of("case_id", "c-4")).getId();
        engine.cancelProcessInstance(onlyChild(engine, parent), "stopped");
        runJobs(context);

        IncidentEntity incident = context.getBean(IncidentRepository.class)
                .findByProcessInstanceIdAndResolvedAtIsNull(parent).stream().findFirst().orElseThrow();
        assertThat(incident.getType()).isEqualTo("CHILD_FAILED");
        assertThat(engine.lineage(parent).children()).hasSize(1);

        engine.retryIncident(parent, incident.getId());
        LineageDto lineage = engine.lineage(parent);
        assertThat(lineage.children()).hasSize(2);
        String second = lineage.children().get(1).instanceId();
        complete(context, "fraud.score", second, Map.of("verdict", "review"));
        runJobs(context);
        ProcessInstance done = engine.getProcessInstanceById(parent);
        assertThat(done.getStatus()).isEqualTo(ProcessStatus.COMPLETED);
        assertThat(done.getVariables()).containsEntry("verdict", "review");
    }

    @Test
    void cancellingAnInstanceCancelsItsWholeSubtreeWithoutResumingAnyone() {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        deploy(context, """
                version: abada.io/v1
                metadata: { key: outer_case, name: Outer case }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: refund }
                    - id: refund
                      type: call-process
                      process: refund_with_check
                      inputs: { case_id: "${case_id}", amount: "${amount}" }
                      outputs: { refund_verdict: fraud_verdict }
                      next: done
                    - { id: done, type: end }
                """);
        String outer = engine.startProcess(PROJECT, "outer_case", "alice", Map.of("case_id", "c-5", "amount", 5))
                .getId();
        String middle = onlyChild(engine, outer);
        String inner = onlyChild(engine, middle);
        assertThat(engine.lineage(inner).ancestors()).extracting(LineageDto.Link::instanceId)
                .containsExactly(outer, middle);
        assertThat(engine.lineage(inner).depth()).isEqualTo(2);

        engine.cancelProcessInstance(outer, "customer withdrew");

        assertThat(engine.getProcessInstanceById(middle).getStatus()).isEqualTo(ProcessStatus.CANCELLED);
        assertThat(engine.getProcessInstanceById(inner).getStatus()).isEqualTo(ProcessStatus.CANCELLED);
        assertThat(context.getBean(ExternalTaskRepository.class).findAll().stream()
                .filter(task -> task.getProcessInstanceId().equals(inner)))
                .allMatch(task -> task.getStatus() == ExternalTaskEntity.Status.CANCELLED);
        assertThat(context.getBean(JobRepository.class).findAll().stream()
                .filter(job -> job.getKind() == JobEntity.Kind.CHILD_DONE)
                .filter(job -> List.of(middle, inner).contains(job.getRelatedInstanceId()))).isEmpty();
    }

    @Test
    void aTimeoutOnTheCallCancelsTheChild() {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String parent = engine.startProcess(PROJECT, "refund_with_check", "alice",
                Map.of("case_id", "c-6", "amount", 1)).getId();
        String child = onlyChild(engine, parent);

        JobRepository jobs = context.getBean(JobRepository.class);
        JobEntity timeout = jobs.findAll().stream().filter(job -> parent.equals(job.getProcessInstanceId())
                && job.getKind() == JobEntity.Kind.BOUNDARY_TIMEOUT).findFirst().orElseThrow();
        timeout.setExecutionTimestamp(Instant.now().minusSeconds(1));
        jobs.save(timeout);
        runJobs(context);

        assertThat(engine.getProcessInstanceById(child).getStatus()).isEqualTo(ProcessStatus.CANCELLED);
        ProcessInstance routed = engine.getProcessInstanceById(parent);
        assertThat(routed.getActiveTokens()).containsExactly("manual_review");
        assertThat(routed.getVariables()).containsEntry("fraud_check_outcome", "TIMEOUT");
    }

    @Test
    void aCallBeyondItsDepthLimitDoesNotStart() {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        deploy(context, """
                version: abada.io/v1
                metadata: { key: shallow_check, name: Shallow check }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: check }
                    - id: check
                      type: call-process
                      process: fraud_check
                      inputs: { case_id: "${case_id}" }
                      outputs: { verdict: verdict }
                      max_depth: 1
                      next: done
                    - { id: done, type: end }
                """);
        deploy(context, """
                version: abada.io/v1
                metadata: { key: deep_case, name: Deep case }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: nested }
                    - id: nested
                      type: call-process
                      process: shallow_check
                      inputs: { case_id: "${case_id}" }
                      outputs: { verdict: verdict }
                      next: done
                    - { id: done, type: end }
                """);
        String root = engine.startProcess(PROJECT, "deep_case", "alice", Map.of("case_id", "c-7")).getId();
        String shallow = onlyChild(engine, root);

        assertThat(engine.lineage(shallow).children()).isEmpty();
        assertThat(context.getBean(IncidentRepository.class).findByProcessInstanceIdAndResolvedAtIsNull(shallow))
                .singleElement().satisfies(incident -> {
                    assertThat(incident.getType()).isEqualTo("CHILD_FAILED");
                    assertThat(incident.getMessage()).contains("CHILD_DEPTH_EXCEEDED");
                });
    }

    @Test
    void theCalledVersionIsPinnedWhenTheParentIsDeployed() throws IOException {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String source = fixture("call-fraud-check.apl.yaml").replace("key: fraud_check", "key: pinned_check");
        ProcessDefinitionEntity v1 = deploy(context, source);
        String parentSource = fixture("call-refund.apl.yaml").replace("key: refund_with_check", "key: pinned_refund")
                .replace("process: fraud_check", "process: pinned_check");
        ProcessDefinitionEntity parentV1 = deploy(context, parentSource);
        ProcessDefinitionEntity v2 = deploy(context, source.replace("name: Fraud check", "name: Fraud check v2"));
        assertThat(v2.getVersion()).isEqualTo(v1.getVersion() + 1);

        String first = engine.startProcess(PROJECT, "pinned_refund", "alice", Map.of("case_id", "a", "amount", 1))
                .getId();
        assertThat(engine.getProcessInstanceById(onlyChild(engine, first)).getProcessDefinitionDeploymentId())
                .isEqualTo(v1.getDeploymentId());

        ProcessDefinitionEntity parentV2 = deploy(context, parentSource);
        assertThat(parentV2.getVersion()).isEqualTo(parentV1.getVersion() + 1);
        String second = engine.startProcess(PROJECT, "pinned_refund", "alice", Map.of("case_id", "b", "amount", 1))
                .getId();
        assertThat(engine.getProcessInstanceById(onlyChild(engine, second)).getProcessDefinitionDeploymentId())
                .isEqualTo(v2.getDeploymentId());
    }

    // ---- shared with the crash test ----------------------------------------------------------------------

    static String onlyChild(AbadaEngine engine, String parent) {
        List<LineageDto.Link> children = engine.lineage(parent).children();
        assertThat(children).as("children of " + parent).hasSize(1);
        return children.getFirst().instanceId();
    }

    static void complete(ConfigurableApplicationContext context, String topic, String instanceId,
            Map<String, Object> variables) {
        ExternalTaskCommandService workers = context.getBean(ExternalTaskCommandService.class);
        LockedExternalTask task = workers.fetchAndLock(new FetchAndLockRequest("w", List.of(topic), 60_000L, 50))
                .stream().filter(locked -> locked.processInstanceId().equals(instanceId)).findFirst()
                .orElseThrow(() -> new AssertionError("no " + topic + " task for " + instanceId));
        workers.complete(task.id(), "w", new LinkedHashMap<>(variables));
    }

    static void runJobs(ConfigurableApplicationContext context) {
        context.getBean(JobScheduler.class).executeDueJobs();
    }

    static List<String> events(ConfigurableApplicationContext context, String instanceId) {
        return context.getBean(ActivityHistoryRepository.class).findByProcessInstanceIdOrderByOccurredAtAsc(instanceId)
                .stream().map(ActivityHistoryEntity::getEventType).toList();
    }

    static ProcessDefinitionEntity deploy(ConfigurableApplicationContext context, String source) {
        return context.getBean(AbadaEngine.class).deploy(PROJECT,
                new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)));
    }

    static void deployFixture(ConfigurableApplicationContext context, String name) {
        try {
            deploy(context, fixture(name));
        } catch (IOException exception) {
            throw new AssertionError(exception);
        }
    }

    static String fixture(String name) throws IOException {
        try (InputStream stream = PostgresCallProcessTest.class.getResourceAsStream("/apl/" + name)) {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    static ConfigurableApplicationContext startApplication(PostgreSQLContainer<?> postgres, boolean immediate) {
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(initialized -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(initialized,
                        "server.port=0",
                        "spring.datasource.url=" + postgres.getJdbcUrl(),
                        "spring.datasource.username=" + postgres.getUsername(),
                        "spring.datasource.password=" + postgres.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=6",
                        "spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect",
                        "spring.jpa.hibernate.ddl-auto=validate",
                        "spring.jpa.open-in-view=false",
                        "spring.flyway.enabled=true",
                        "spring.task.scheduling.enabled=false",
                        "abada.outbox.dispatcher.enabled=false",
                        "abada.security.mode=disabled",
                        "abada.call-process.resume-immediately=" + immediate,
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
    }
}
