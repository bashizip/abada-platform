package com.abada.engine.core;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.AgentAttemptMetadata;
import com.abada.engine.core.model.DefinitionSchema;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.dto.ExternalTaskFailureDto;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.entity.ProcessInstanceEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.ProcessDefinitionRepository;
import com.abada.engine.persistence.repository.ProcessInstanceRepository;
import com.abada.engine.util.DatabaseTestHelper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * End-to-end execution of native {@code abada.io/v1} APL definitions under the
 * PostgreSQL authority: polymorphic persistence, decision-table inline
 * execution, approval-gate user tasks, agent external tasks, condition
 * routing, schema coexistence with BPMN definitions, and restart recovery.
 */
@Testcontainers
class AplRuntimeTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("abada_apl")
                    .withUsername("abada")
                    .withPassword("abada");

    @Test
    void executesCandidateFlowThroughDecisionTableApprovalAndAgent() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");

            var instance = engine.startProcess("candidate_review", "alice", Map.of("score", 88));
            assertThat(engine.getProcessInstanceById(instance.getId()).getVariables())
                    .containsEntry("rating", "pass");

            var rejected = engine.startProcess("candidate_review", "bob", Map.of("score", 30));
            assertThat(engine.getProcessInstanceById(rejected.getId()).getVariables())
                    .containsEntry("rating", "fail");

            // The approval gate sits between the decision and the agent: the
            // pending user task is visible to the recruiter group only.
            // The approval gate sits between the decision and the agent: the
            // pending user task is visible to the recruiter group only.
            var pending = engine.getTaskManager().getVisibleTasksForUser("carol", List.of("recruiters"));
            assertThat(pending).extracting(TaskInstance::getProcessInstanceId)
                    .contains(instance.getId(), rejected.getId());
            var gateTask = pending.stream()
                    .filter(task -> task.getProcessInstanceId().equals(instance.getId()))
                    .findFirst().orElseThrow();
            assertThat(gateTask.getTaskDefinitionKey()).isEqualTo("gate");
            assertThat(gateTask.getCandidateGroups()).containsExactly("recruiters");
            engine.completeTask(gateTask.getId(), "carol", List.of("recruiters"), Map.of("approved", true));

            var externalTaskService = context.getBean(ExternalTaskCommandService.class);
            var agentJobs = externalTaskService.fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:agent"), 10_000L));
            assertThat(agentJobs).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("notify"));
            externalTaskService.complete(agentJobs.getFirst().id(), Map.of("handled", true));

            ProcessInstance completed = engine.getProcessInstanceById(instance.getId());
            assertThat(completed.isCompleted()).isTrue();
            assertThat(completed.getVariables())
                    .containsEntry("rating", "pass")
                    .containsEntry("approved", true)
                    .containsEntry("handled", true);
        }
    }

    @Test
    void executesScriptNodeInTransactionAndCompletes() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/script-transform.apl.yaml");

            var premium = engine.startProcess("script_transform", "alice", Map.of("orderValue", 120));
            assertThat(engine.getProcessInstanceById(premium.getId()).isCompleted()).isTrue();
            assertThat(engine.getProcessInstanceById(premium.getId()).getVariables())
                    .containsEntry("shippingTier", "premium");

            var standard = engine.startProcess("script_transform", "bob", Map.of("orderValue", 45));
            assertThat(engine.getProcessInstanceById(standard.getId()).getVariables())
                    .containsEntry("shippingTier", "standard");
        }
    }

    @Test
    void executesInclusiveForkAndJoinRoutingEveryMatchingBranch() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/inclusive-router.apl.yaml");

            var single = engine.startProcess("inclusive_router", "alice", Map.of("path", "C"));
            ProcessInstance singleDone = engine.getProcessInstanceById(single.getId());
            assertThat(singleDone.isCompleted()).isTrue();
            assertThat(singleDone.getVariables())
                    .containsEntry("branchC", true)
                    .doesNotContainKey("branchD");

            var both = engine.startProcess("inclusive_router", "bob", Map.of("path", "CD"));
            ProcessInstance bothDone = engine.getProcessInstanceById(both.getId());
            assertThat(bothDone.isCompleted()).isTrue();
            assertThat(bothDone.getVariables())
                    .containsEntry("branchC", true)
                    .containsEntry("branchD", true);
        }
    }

    @Test
    void awaitsMessageTimerAndSignalCatchEventsThroughTheDurableRuntime() throws Exception {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            EventManager eventManager = context.getBean(EventManager.class);
            JobScheduler jobScheduler = context.getBean(JobScheduler.class);

            deploy(engine, "/apl/message-catch.apl.yaml");
            var messageInstance = engine.startProcess("message_catch", "alice",
                    Map.of("correlationKey", "fast-1"));
            var waiting = engine.getProcessInstanceById(messageInstance.getId());
            assertThat(waiting.isCompleted()).isFalse();
            assertThat(waiting.getActiveTokens()).containsExactly("catchFastTrack");
            eventManager.correlateMessage("FastTrackMessage", "fast-1", Map.of("paymentStatus", "PAID"));
            assertThat(engine.getProcessInstanceById(messageInstance.getId()).isCompleted()).isTrue();

            deploy(engine, "/apl/timer-catch.apl.yaml");
            var timerInstance = engine.startProcess("timer_catch", "bob", Map.of());
            var waitingTimer = engine.getProcessInstanceById(timerInstance.getId());
            assertThat(waitingTimer.getActiveTokens()).containsExactly("catchTimeout");
            Thread.sleep(1100);
            jobScheduler.executeDueJobs();
            assertThat(engine.getProcessInstanceById(timerInstance.getId()).isCompleted()).isTrue();

            deploy(engine, "/apl/signal-catch.apl.yaml");
            var signalInstance = engine.startProcess("signal_catch", "carol", Map.of());
            assertThat(engine.getProcessInstanceById(signalInstance.getId()).getActiveTokens())
                    .containsExactly("catchGo");
            eventManager.broadcastSignal("proceed", Map.of("go", true));
            assertThat(engine.getProcessInstanceById(signalInstance.getId()).isCompleted()).isTrue();
        }
    }

    @Test
    void persistsAgentAttemptMetadataThroughWorkerAndHistoryContracts() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");

            var instance = engine.startProcess("candidate_review", "alice", Map.of("score", 88));
            var pending = engine.getTaskManager().getVisibleTasksForUser("carol", List.of("recruiters"));
            var gateTask = pending.stream()
                    .filter(task -> task.getProcessInstanceId().equals(instance.getId()))
                    .findFirst().orElseThrow();
            engine.completeTask(gateTask.getId(), "carol", List.of("recruiters"), Map.of("approved", true));

            var externalTaskService = context.getBean(ExternalTaskCommandService.class);
            var agentJobs = externalTaskService.fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:agent"), 10_000L));
            assertThat(agentJobs).singleElement().satisfies(job -> {
                assertThat(job.activityId()).isEqualTo("notify");
                // The durable retry budget is seeded from the APL max_attempts.
                assertThat(job.retries()).isEqualTo(4);
            });

            // The locked history event records the durable agent request facts.
            var historyRepo = context.getBean(ActivityHistoryRepository.class);
            var locked = historyRepo.findByProcessInstanceIdOrderByOccurredAtAsc(instance.getId()).stream()
                    .filter(event -> "EXTERNAL_TASK_LOCKED".equals(event.getEventType()))
                    .findFirst().orElseThrow();
            assertThat(locked.getDetailsJson())
                    .contains("\"agent\"")
                    .contains("\"confidenceThreshold\":85.0");

            // A real worker reports attempt metadata on the durable completion command.
            externalTaskService.complete(agentJobs.getFirst().id(), "worker-1", Map.of("handled", true),
                    new AgentAttemptMetadata("gemini-3.6-flash", "google-gemini", 1, 1_234L,
                            List.of("crm.read"), "notify_result", "abc123", null, 93.0));

            // The durable worker record carries the attempt metadata JSON.
            var task = context.getBean(ExternalTaskRepository.class)
                    .findById(agentJobs.getFirst().id()).orElseThrow();
            assertThat(task.getAgentMetadataJson())
                    .contains("\"model\":\"gemini-3.6-flash\"")
                    .contains("\"provider\":\"google-gemini\"")
                    .contains("\"attempt\":1")
                    .contains("\"confidence\":93.0");

            // The history contract exposes model, provider, attempt, tool and
            // confidence facts.
            var completed = historyRepo.findByProcessInstanceIdOrderByOccurredAtAsc(instance.getId()).stream()
                    .filter(event -> "EXTERNAL_TASK_COMPLETED".equals(event.getEventType()))
                    .findFirst().orElseThrow();
            assertThat(completed.getDetailsJson())
                    .contains("\"agent\"")
                    .contains("\"model\":\"gemini-3.6-flash\"")
                    .contains("\"tools\":[\"crm.read\"]")
                    .contains("\"confidence\":93.0");
        }
    }

    @Test
    void persistsAgentFailureMetadataThroughWorkerAndHistoryContracts() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");

            var instance = engine.startProcess("candidate_review", "alice", Map.of("score", 88));
            var pending = engine.getTaskManager().getVisibleTasksForUser("carol", List.of("recruiters"));
            var gateTask = pending.stream()
                    .filter(task -> task.getProcessInstanceId().equals(instance.getId()))
                    .findFirst().orElseThrow();
            engine.completeTask(gateTask.getId(), "carol", List.of("recruiters"), Map.of("approved", true));

            var externalTaskService = context.getBean(ExternalTaskCommandService.class);
            var agentJobs = externalTaskService.fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:agent"), 10_000L));

            externalTaskService.handleFailure(agentJobs.getFirst().id(), new ExternalTaskFailureDto(
                    "worker-1", "LLM gateway returned HTTP 429", "RateLimitException", 2, 2_000L,
                    new AgentAttemptMetadata("gpt-5-mini", "openai-compatible", 1, null,
                            List.of(), null, null, "RateLimitException", null)));

            var task = context.getBean(ExternalTaskRepository.class)
                    .findById(agentJobs.getFirst().id()).orElseThrow();
            assertThat(task.getAgentMetadataJson())
                    .contains("\"errorType\":\"RateLimitException\"")
                    .contains("\"model\":\"gpt-5-mini\"");

            var failed = context.getBean(ActivityHistoryRepository.class)
                    .findByProcessInstanceIdOrderByOccurredAtAsc(instance.getId()).stream()
                    .filter(event -> "EXTERNAL_TASK_FAILED".equals(event.getEventType()))
                    .findFirst().orElseThrow();
            assertThat(failed.getDetailsJson())
                    .contains("\"agent\"")
                    .contains("\"errorType\":\"RateLimitException\"");
        }
    }

    @Test
    void routesConditionBranchesToDeclaredServiceTopics() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/condition-router.apl.yaml");

            var instance = engine.startProcess("rating_router", "alice", Map.of("rating", "gold"));
            var externalTaskService = context.getBean(ExternalTaskCommandService.class);
            var goldJobs = externalTaskService.fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:gold-tier"), 10_000L));
            assertThat(goldJobs).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("goldDesk"));
            externalTaskService.complete(goldJobs.getFirst().id(), Map.of("tier", "gold"));
            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isTrue();

            // No declared rule matched: the last condition rule becomes the default.
            var defaulted = engine.startProcess("rating_router", "bob", Map.of("rating", "platinum"));
            var basicJobs = externalTaskService.fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("abada:basic-tier"), 10_000L));
            assertThat(basicJobs).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("basicDesk"));
            externalTaskService.complete(basicJobs.getFirst().id(), Map.of("tier", true));
            assertThat(engine.getProcessInstanceById(defaulted.getId()).isCompleted()).isTrue();
        }
    }

    @Test
    void runsParallelForkAndJoinThroughEngineTasks() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/parallel-fork-join.apl.yaml");

            var instance = engine.startProcess("parallel_fork_join", "alice", Map.of());
            var externalTaskService = context.getBean(ExternalTaskCommandService.class);

            // The fork created one durable job per branch, before the join runs.
            var creditJob = externalTaskService.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:credit-check"), 10_000L));
            var fraudJob = externalTaskService.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:fraud-check"), 10_000L));
            assertThat(creditJob).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("creditDesk"));
            assertThat(fraudJob).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("fraudDesk"));

            // Completing a single branch does not satisfy the join: the stream
            // must not advance to the archive job yet.
            externalTaskService.complete(creditJob.getFirst().id(), Map.of("credit", "clear"));
            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isFalse();
            assertThat(externalTaskService.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:archive"), 10_000L))).isEmpty();

            // Once the second branch arrives, the join releases the stream.
            externalTaskService.complete(fraudJob.getFirst().id(), Map.of("fraud", "clear"));
            var archiveJob = externalTaskService.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:archive"), 10_000L));
            assertThat(archiveJob).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("archive"));
            externalTaskService.complete(archiveJob.getFirst().id(), Map.of("archived", true));

            assertThat(engine.getProcessInstanceById(instance.getId()).isCompleted()).isTrue();
            assertThat(engine.getProcessInstanceById(instance.getId()).getVariables())
                    .containsEntry("credit", "clear")
                    .containsEntry("fraud", "clear")
                    .containsEntry("archived", true);
        }
    }

    @Test
    void recoversParallelJoinStateAcrossApplicationRestart() {
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/apl/parallel-fork-join.apl.yaml");
            instanceId = engine.startProcess("parallel_fork_join", "alice", Map.of()).getId();

            // Complete exactly one branch; the join token for the second branch
            // must survive the restart.
            var externalTaskService = first.getBean(ExternalTaskCommandService.class);
            var branchJobs = externalTaskService.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:credit-check", "abada:fraud-check"), 10_000L));
            var creditJob = branchJobs.stream()
                    .filter(job -> job.activityId().equals("creditDesk"))
                    .findFirst().orElseThrow();
            externalTaskService.complete(creditJob.id(), Map.of("credit", "clear"));
        }

        try (ConfigurableApplicationContext restarted = startApplication()) {
            assertThat(restarted.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("parallel_fork_join"))
                    .isPresent()
                    .get()
                    .extracting(ProcessDefinitionEntity::getSchemaType)
                    .isEqualTo(DefinitionSchema.APL_NATIVE.name());

            AbadaEngine engine = restarted.getBean(AbadaEngine.class);
            var instance = engine.getProcessInstanceById(instanceId);
            assertThat(instance.isCompleted()).isFalse();

            // The join's arrived-token bookkeeping persisted: only the fraud
            // branch is still pending, the consumed credit job is not replayed.
            var externalTaskService = restarted.getBean(ExternalTaskCommandService.class);
            var pending = externalTaskService.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:fraud-check", "abada:archive"), 10_000L));
            assertThat(pending).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("fraudDesk"));
            externalTaskService.complete(pending.getFirst().id(), Map.of("fraud", "clear"));

            var archiveJob = externalTaskService.fetchAndLock(new FetchAndLockRequest(
                    "worker-1", List.of("abada:archive"), 10_000L));
            assertThat(archiveJob).singleElement().satisfies(job ->
                    assertThat(job.activityId()).isEqualTo("archive"));
            externalTaskService.complete(archiveJob.getFirst().id(), Map.of("archived", true));

            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isTrue();
        }
    }

    @Test
    void rejectsInvalidAplDeploymentWithoutSideEffects() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);

            String broken = "version: abada.io/v1\n"
                    + "metadata:\n  name: broken flow\n"
                    + "flow:\n"
                    + "  entry: start\n"
                    + "  nodes:\n"
                    + "    - id: start\n      type: webhook\n      next: phantom\n";
            assertThatThrownBy(() -> engine.deploy(new java.io.ByteArrayInputStream(
                    broken.getBytes(StandardCharsets.UTF_8))))
                    .isInstanceOf(ProcessEngineException.class)
                    .hasMessageContaining("not a declared node");

            assertThat(context.getBean(ProcessDefinitionRepository.class).count()).isZero();
        }
    }

    @Test
    void agentModelAllowListGatesNewDeploymentsWithoutBreakingAdmittedOnes() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);

            // A model outside the current allow-list is rejected at admission.
            String legacyApl = "version: abada.io/v1\n"
                    + "metadata:\n"
                    + "  key: legacy_agent_flow\n"
                    + "  name: Legacy Agent Flow\n"
                    + "flow:\n"
                    + "  entry: start\n"
                    + "  nodes:\n"
                    + "    - id: start\n"
                    + "      type: webhook\n"
                    + "      next: analyze\n"
                    + "    - id: analyze\n"
                    + "      type: agent\n"
                    + "      profile: abada.agent/v1\n"
                    + "      model: gemini-2.5-flash\n"
                    + "      prompt: Classify the lead.\n"
                    + "      result_variable: out\n"
                    + "      next: end\n"
                    + "    - id: end\n"
                    + "      type: end\n";
            assertThatThrownBy(() -> engine.deploy(new java.io.ByteArrayInputStream(
                    legacyApl.getBytes(StandardCharsets.UTF_8))))
                    .isInstanceOf(ProcessEngineException.class)
                    .hasMessageContaining("not on the allowed model list");

            // A definition admitted under an older operator policy keeps
            // materializing its instances after the allow-list is tightened.
            ProcessDefinitionEntity admitted = new ProcessDefinitionEntity();
            admitted.setProjectId(com.abada.engine.project.ProjectConstants.DEFAULT_PROJECT_ID);
            admitted.setId("legacy_agent_flow");
            admitted.setProcessKey("legacy_agent_flow");
            admitted.setVersion(1);
            admitted.setName("Legacy Agent Flow");
            admitted.setBpmnXml(legacyApl);
            admitted.setSchemaType(DefinitionSchema.APL_NATIVE.name());
            admitted.setDeploymentId("legacy-deployment");
            admitted.setChecksum("legacy-checksum");
            admitted.setDefinitionFormatVersion("apl-native-1");
            admitted.setCompatibilityProfiles("abada-native-1");
            admitted.setDetectedNamespaces("abada.io/v1");
            admitted.setCompatibilityReport("{}");
            admitted.setCompilerVersion("apl-1");
            context.getBean(ProcessDefinitionRepository.class).save(admitted);

            ProcessInstanceEntity instance = new ProcessInstanceEntity("legacy-instance-1",
                    "legacy_agent_flow", "analyze", ProcessStatus.RUNNING);
            instance.setProjectId(com.abada.engine.project.ProjectConstants.DEFAULT_PROJECT_ID);
            instance.setProcessDefinitionDeploymentId("legacy-deployment");
            instance.setVariablesJson("{}");
            instance.setStartDate(java.time.Instant.now());
            context.getBean(ProcessInstanceRepository.class).save(instance);

            var page = engine.getProcessInstances(com.abada.engine.project.ProjectConstants.DEFAULT_PROJECT_ID, null, null,
                    org.springframework.data.domain.PageRequest.of(0, 10));
            assertThat(page.getContent()).singleElement().satisfies(pi -> {
                assertThat(pi.getId()).isEqualTo("legacy-instance-1");
                assertThat(pi.getDefinition().getId()).isEqualTo("legacy_agent_flow");
                assertThat(pi.getDefinition().getServiceTask("analyze").agentWork().model())
                        .isEqualTo("gemini-2.5-flash");
            });
        }
    }

    @Test
    void recoversAplStateAcrossApplicationRestart() {
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/apl/candidate-review.apl.yaml");
            instanceId = engine.startProcess("candidate_review", "alice", Map.of("score", 88)).getId();
        }

        try (ConfigurableApplicationContext restarted = startApplication()) {
            // The persisted APL source is reloaded from PostgreSQL and recompiled
            // by the native loader — no XML round-trip, no schema guesswork.
            assertThat(restarted.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("candidate_review"))
                    .isPresent()
                    .get()
                    .extracting(ProcessDefinitionEntity::getSchemaType)
                    .isEqualTo(DefinitionSchema.APL_NATIVE.name());

            AbadaEngine engine = restarted.getBean(AbadaEngine.class);
            assertThat(engine.getProcessInstanceById(instanceId).isCompleted()).isFalse();
            assertThat(engine.getTaskManager().getVisibleTasksForUser("carol", List.of("recruiters")))
                    .singleElement()
                    .satisfies(task -> assertThat(task.getTaskDefinitionKey()).isEqualTo("gate"));
        }
    }

    @Test
    void aplAndBpmnDefinitionsVersionTogetherAndDeduplicate() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deploy(engine, "/apl/condition-router.apl.yaml");
            deploy(engine, "/bpmn/decision-table-test.bpmn");

            var aplFlow = context.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("rating_router");
            var bpmn = context.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("CreditDecisionProcess");
            assertThat(aplFlow).isPresent().get().satisfies(entity -> {
                assertThat(entity.getSchemaType()).isEqualTo(DefinitionSchema.APL_NATIVE.name());
                assertThat(entity.getDefinitionFormatVersion()).isEqualTo("apl-native-1");
            });
            assertThat(bpmn).isPresent().get().satisfies(entity -> {
                assertThat(entity.getSchemaType()).isEqualTo(DefinitionSchema.BPMN_XML.name());
                assertThat(entity.getDefinitionFormatVersion()).isEqualTo("canonical-1");
            });

            // Re-deploying identical source is idempotent: no version bump.
            deploy(engine, "/apl/condition-router.apl.yaml");
            assertThat(context.getBean(ProcessDefinitionRepository.class)
                    .findFirstByProcessKeyOrderByVersionDesc("rating_router"))
                    .isPresent()
                    .get()
                    .extracting(ProcessDefinitionEntity::getVersion)
                    .isEqualTo(1);
        }
    }

    private void deploy(AbadaEngine engine, String resource) {
        try (InputStream stream = getClass().getResourceAsStream(resource)) {
            assertThat(stream).as(resource).isNotNull();
            engine.deploy(stream);
        } catch (Exception exception) {
            throw new AssertionError("Could not deploy " + resource, exception);
        }
    }

    private ConfigurableApplicationContext startApplication() {
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(
                        context,
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
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
    }
}