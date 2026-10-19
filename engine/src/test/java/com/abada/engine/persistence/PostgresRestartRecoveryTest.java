package com.abada.engine.persistence;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.EventManager;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.JobScheduler;
import com.abada.engine.core.TimerJobCommandService;
import com.abada.engine.core.IdempotencyService;
import com.abada.engine.core.OutboxService;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.ProcessInstanceRepository;
import com.abada.engine.persistence.repository.TaskRepository;
import com.abada.engine.persistence.repository.OutboxEventRepository;
import com.abada.engine.persistence.repository.JobRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.util.DatabaseTestHelper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.InputStream;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.HashSet;
import java.util.LinkedHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
class PostgresRestartRecoveryTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("abada_restart_recovery")
                    .withUsername("abada")
                    .withPassword("abada");

    @Test
    void rollsBackTaskStateVariablesAndHistoryWhenAdvancementFails() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            try (InputStream bpmn = getClass().getResourceAsStream("/bpmn/atomic-command-rollback.bpmn")) {
                assertThat(bpmn).isNotNull();
                engine.deploy(bpmn);
            } catch (Exception exception) {
                throw new AssertionError("Could not deploy atomic rollback BPMN", exception);
            }

            ProcessInstance instance = engine.startProcess("atomic-command-rollback", "alice", Map.of());
            String taskId = engine.getTaskManager().getVisibleTasksForUser("alice", List.of()).getFirst().getId();

            assertThatThrownBy(() -> engine.completeTask(taskId, "alice", List.of(), Map.of("mustRollback", true)))
                    .isInstanceOf(RuntimeException.class)
                    .hasMessageContaining("Error executing JavaDelegate");

            assertThat(context.getBean(TaskRepository.class).findById(taskId))
                    .isPresent().get()
                    .extracting(TaskEntity::getStatus)
                    .isEqualTo(TaskStatus.CLAIMED);
            assertThat(engine.getProcessInstanceById(instance.getId()).getVariables())
                    .doesNotContainKey("mustRollback");
            assertThat(context.getBean(ActivityHistoryRepository.class)
                    .findByProcessInstanceIdOrderByOccurredAtAsc(instance.getId()))
                    .extracting(ActivityHistoryEntity::getEventType)
                    // The flow into the task was recorded at start; the failed advancement added none.
                    .containsExactly("PROCESS_STARTED", "FLOW_TAKEN", "TASK_CREATED", "TASK_ASSIGNED");
            // Flows taken are history facts, never lifecycle events.
            assertThat(context.getBean(OutboxEventRepository.class)
                    .findByAggregateIdOrderByOccurredAt(instance.getId()))
                    .extracting(event -> event.getEventType())
                    .containsExactly("PROCESS_STARTED", "TASK_CREATED", "TASK_ASSIGNED");
        }
    }

    @Test
    void preservesCommittedStateWhenFailureOccursImmediatelyAfterCommit() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployRestartProcess(engine);
            ProcessInstance instance = engine.startProcess("postgres-restart-recovery", "alice", Map.of());

            TransactionTemplate transaction = context.getBean(TransactionTemplate.class);
            assertThatThrownBy(() -> transaction.executeWithoutResult(ignored -> {
                engine.updateProcessVariables(instance.getId(), Map.of("committedBeforeResponseLoss", true));
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        throw new IllegalStateException("simulated response loss after commit");
                    }
                });
            })).hasMessageContaining("simulated response loss after commit");

            assertThat(engine.getProcessInstanceById(instance.getId()).getVariables())
                    .containsEntry("committedBeforeResponseLoss", true);
            assertThat(context.getBean(ActivityHistoryRepository.class)
                    .findByProcessInstanceIdOrderByOccurredAtAsc(instance.getId()))
                    .extracting(ActivityHistoryEntity::getEventType)
                    .contains("VARIABLES_UPDATED");
            assertThat(context.getBean(OutboxEventRepository.class)
                    .findByAggregateIdOrderByOccurredAt(instance.getId()))
                    .extracting(event -> event.getEventType())
                    .contains("VARIABLES_UPDATED");
        }
    }

    @Test
    void leasesRetriesAndPublishesTransactionalOutboxEvents() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployRestartProcess(engine);
            ProcessInstance instance = engine.startProcess("postgres-restart-recovery", "alice", Map.of());

            OutboxService outbox = context.getBean(OutboxService.class);
            Instant now = Instant.now();
            var firstLease = outbox.claim("replica-a", 100, now);
            assertThat(firstLease).extracting(event -> event.eventType())
                    .contains("PROCESS_DEFINITION_DEPLOYED", "PROCESS_STARTED");
            assertThat(outbox.claim("replica-b", 100, now)).isEmpty();

            var definitionEvent = firstLease.stream()
                    .filter(event -> event.aggregateId().equals("postgres-restart-recovery"))
                    .findFirst().orElseThrow();
            var instanceEvent = firstLease.stream()
                    .filter(event -> event.aggregateId().equals(instance.getId()))
                    .filter(event -> event.eventType().equals("PROCESS_STARTED"))
                    .findFirst().orElseThrow();
            for (var event : firstLease) {
                if (event.id().equals(instanceEvent.id()))
                    outbox.markFailed(event.id(), "replica-a", "temporary transport failure", now);
                else outbox.markPublished(event.id(), "replica-a", now);
            }

            assertThat(outbox.claim("replica-b", 100, now.plusSeconds(1))).isEmpty();
            var retry = outbox.claim("replica-b", 100, now.plusSeconds(301));
            assertThat(retry).extracting(event -> event.id()).containsExactly(instanceEvent.id());
            outbox.markPublished(instanceEvent.id(), "replica-b", now.plusSeconds(301));
            assertThat(context.getBean(OutboxEventRepository.class).countByPublishedAtIsNull()).isZero();
        }
    }

    @Test
    void recoversMessageSubscriptionAcrossApplicationRestart() {
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/message-event-test.bpmn");
            ProcessInstance instance = engine.startProcess("MessageEventProcess", "test-user",
                    Map.of("correlationKey", "order-42"));
            instanceId = instance.getId();
            TaskInstance initial = engine.getTaskManager().getTasksForProcessInstance(instanceId).getFirst();
            engine.completeTask(initial.getId(), "test-user", List.of(), Map.of());
            assertThat(engine.getProcessInstanceById(instanceId).getActiveTokens())
                    .containsExactly("CatchEvent_OrderPaid");
        }

        try (ConfigurableApplicationContext restarted = startApplication()) {
            restarted.getBean(EventManager.class).correlateMessage(
                    "OrderPaid", "order-42", Map.of("paid", true));
            AbadaEngine engine = restarted.getBean(AbadaEngine.class);
            assertThat(engine.getProcessInstanceById(instanceId).getVariables()).containsEntry("paid", true);
            assertThat(engine.getTaskManager().getTasksForProcessInstance(instanceId))
                    .extracting(TaskInstance::getTaskDefinitionKey)
                    .containsExactly("Task_FulfillOrder");
        }
    }

    @Test
    void recoversTimerJobAcrossApplicationRestart() throws Exception {
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/timer-event-test.bpmn");
            ProcessInstance instance = engine.startProcess("TimerEventProcess", "test-user", Map.of());
            instanceId = instance.getId();
            TaskInstance initial = engine.getTaskManager().getTasksForProcessInstance(instanceId).getFirst();
            engine.completeTask(initial.getId(), "test-user", List.of(), Map.of());
        }

        Thread.sleep(1100);
        try (ConfigurableApplicationContext restarted = startApplication()) {
            restarted.getBean(JobScheduler.class).executeDueJobs();
            assertThat(restarted.getBean(AbadaEngine.class).getTaskManager()
                    .getTasksForProcessInstance(instanceId))
                    .extracting(TaskInstance::getTaskDefinitionKey)
                    .containsExactly("FinalTask");
        }
    }

    @Test
    void recoversExternalTaskAcrossApplicationRestart() {
        String instanceId;
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/external-task-test.bpmn");
            instanceId = engine.startProcess("ExternalTaskTestProcess", "worker-user", Map.of()).getId();
        }

        try (ConfigurableApplicationContext restarted = startApplication()) {
            ExternalTaskCommandService commands = restarted.getBean(ExternalTaskCommandService.class);
            var locked = commands.fetchAndLock(
                    new FetchAndLockRequest("worker-1", List.of("test-topic"), 10_000L));
            assertThat(locked).hasSize(1);
            commands.complete(locked.getFirst().id(), Map.of("externalResult", "recovered"));
            AbadaEngine engine = restarted.getBean(AbadaEngine.class);
            assertThat(engine.getProcessInstanceById(instanceId).getVariables())
                    .containsEntry("externalResult", "recovered");
            assertThat(engine.getTaskManager().getTasksForProcessInstance(instanceId))
                    .extracting(TaskInstance::getTaskDefinitionKey)
                    .containsExactly("FinalTask");
        }
    }

    @Test
    void pagesRuntimeQueriesInPostgresWithoutDuplicateRows() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployRestartProcess(engine);

            for (int instance = 0; instance < 5; instance++) {
                engine.startProcess("postgres-restart-recovery", "alice", Map.of("sequence", instance));
            }

            Sort taskOrder = Sort.by("startDate").ascending().and(Sort.by("id").ascending());
            Page<TaskInstance> firstTasks = engine.getTaskManager().getVisibleTasksForUser(
                    "alice", List.of("operators"), null, PageRequest.of(0, 2, taskOrder));
            Page<TaskInstance> secondTasks = engine.getTaskManager().getVisibleTasksForUser(
                    "alice", List.of("operators"), null, PageRequest.of(1, 2, taskOrder));

            assertThat(firstTasks.getTotalElements()).isEqualTo(5);
            assertThat(firstTasks.getContent()).hasSize(2);
            assertThat(secondTasks.getContent()).hasSize(2);
            assertThat(secondTasks.getContent())
                    .extracting(TaskInstance::getId)
                    .doesNotContainAnyElementsOf(firstTasks.map(TaskInstance::getId).getContent());

            Sort instanceOrder = Sort.by("startDate").descending().and(Sort.by("id").ascending());
            Page<ProcessInstance> firstInstances = engine.getProcessInstances(
                    PageRequest.of(0, 3, instanceOrder));
            Page<ProcessInstance> secondInstances = engine.getProcessInstances(
                    PageRequest.of(1, 3, instanceOrder));

            assertThat(firstInstances.getTotalElements()).isEqualTo(5);
            assertThat(firstInstances.getContent()).hasSize(3);
            assertThat(secondInstances.getContent()).hasSize(2);
            assertThat(secondInstances.getContent())
                    .extracting(ProcessInstance::getId)
                    .doesNotContainAnyElementsOf(firstInstances.map(ProcessInstance::getId).getContent());
        }
    }

    @Test
    void completesPersistedUserTaskAfterFullApplicationRestart() {
        String processInstanceId;
        String taskId;

        try (ConfigurableApplicationContext firstContext = startApplication()) {
            firstContext.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = firstContext.getBean(AbadaEngine.class);

            try (InputStream bpmn = getClass().getResourceAsStream(
                    "/bpmn/postgres-restart-recovery.bpmn")) {
                assertThat(bpmn).as("restart-recovery BPMN resource").isNotNull();
                engine.deploy(bpmn);
            } catch (Exception exception) {
                throw new AssertionError("Could not deploy restart-recovery BPMN", exception);
            }

            ProcessInstance instance = engine.startProcess(
                    "postgres-restart-recovery", "alice", Map.of("requestId", "request-42"));
            processInstanceId = instance.getId();

            List<TaskInstance> tasks = engine.getTaskManager()
                    .getVisibleTasksForUser("alice", List.of("operators"));
            assertThat(tasks).hasSize(1);
            taskId = tasks.getFirst().getId();

            assertThat(firstContext.getBean(ProcessInstanceRepository.class).findById(processInstanceId))
                    .isPresent()
                    .get()
                    .satisfies(entity -> {
                        assertThat(entity.getVariablesJson()).contains("request-42");
                        assertThat(entity.getActiveTokensJson()).contains("approval");
                    });
            assertThat(firstContext.getBean(TaskRepository.class).findById(taskId))
                    .isPresent()
                    .get()
                    .extracting(task -> task.getStatus())
                    .isEqualTo(TaskStatus.AVAILABLE);
        }

        try (ConfigurableApplicationContext restartedContext = startApplication()) {
            AbadaEngine restartedEngine = restartedContext.getBean(AbadaEngine.class);

            List<TaskInstance> recoveredTasks = restartedEngine.getTaskManager()
                    .getVisibleTasksForUser("alice", List.of("operators"));
            assertThat(recoveredTasks)
                    .extracting(TaskInstance::getId)
                    .containsExactly(taskId);

            restartedEngine.claim(taskId, "alice", List.of("operators"));

            // Poison detached query snapshots. A later command must reconstruct its
            // authoritative state from PostgreSQL rather than observing these changes.
            recoveredTasks.getFirst().setStatus(TaskStatus.COMPLETED);
            ProcessInstance detachedInstance = restartedEngine.getProcessInstanceById(processInstanceId);
            detachedInstance.putAllVariables(Map.of("memoryOnly", "must-not-be-persisted"));
            assertThat(restartedEngine.getProcessInstanceById(processInstanceId).getVariables())
                    .doesNotContainKey("memoryOnly");

            restartedEngine.completeTask(taskId, "alice", List.of("operators"),
                    Map.of("approved", true));

            ProcessInstance completed = restartedEngine.getProcessInstanceById(processInstanceId);
            assertThat(completed.isCompleted()).isTrue();
            assertThat(completed.getVariables())
                    .containsEntry("requestId", "request-42")
                    .containsEntry("approved", true)
                    .doesNotContainKey("memoryOnly");

            assertThat(restartedContext.getBean(TaskRepository.class).findById(taskId))
                    .isPresent()
                    .get()
                    .extracting(task -> task.getStatus())
                    .isEqualTo(TaskStatus.COMPLETED);

            List<ActivityHistoryEntity> history = restartedContext
                    .getBean(ActivityHistoryRepository.class)
                    .findByProcessInstanceIdOrderByOccurredAtAsc(processInstanceId);
            assertThat(history)
                    .extracting(ActivityHistoryEntity::getEventType)
                    .containsExactly("PROCESS_STARTED", "FLOW_TAKEN", "TASK_CREATED", "TASK_CLAIMED",
                            "TASK_COMPLETED", "FLOW_TAKEN");
        }
    }

    @Test
    void serializesConcurrentClaimAndFailureAcrossTwoEngineReplicas() throws Exception {
        try (ConfigurableApplicationContext firstContext = startApplication()) {
            firstContext.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine firstEngine = firstContext.getBean(AbadaEngine.class);
            deployRestartProcess(firstEngine);

            ProcessInstance instance = firstEngine.startProcess(
                    "postgres-restart-recovery", "alice", Map.of());
            String taskId = firstEngine.getTaskManager()
                    .getVisibleTasksForUser("alice", List.of("operators"))
                    .getFirst()
                    .getId();

            try (ConfigurableApplicationContext secondContext = startApplication()) {
                AbadaEngine secondEngine = secondContext.getBean(AbadaEngine.class);

                assertThat(runConcurrentAttempts(
                        claimAttempt(firstEngine, taskId),
                        claimAttempt(secondEngine, taskId)))
                        .containsExactlyInAnyOrder(true, false);
                assertThat(firstContext.getBean(TaskRepository.class).findById(taskId))
                        .isPresent()
                        .get()
                        .extracting(TaskEntity::getStatus)
                        .isEqualTo(TaskStatus.CLAIMED);

                assertThat(runConcurrentAttempts(
                        failureAttempt(firstEngine, taskId),
                        failureAttempt(secondEngine, taskId)))
                        .containsExactlyInAnyOrder(true, false);
                assertThat(firstContext.getBean(TaskRepository.class).findById(taskId))
                        .isPresent()
                        .get()
                        .extracting(TaskEntity::getStatus)
                        .isEqualTo(TaskStatus.FAILED);

                List<ActivityHistoryEntity> history = firstContext
                        .getBean(ActivityHistoryRepository.class)
                        .findByProcessInstanceIdOrderByOccurredAtAsc(instance.getId());
                assertThat(history)
                        .filteredOn(event -> "TASK_CLAIMED".equals(event.getEventType()))
                        .hasSize(1);
                assertThat(history)
                        .filteredOn(event -> "TASK_FAILED".equals(event.getEventType()))
                        .hasSize(1);
            }
        }
    }

    @Test
    void serializesConcurrentCompletionAcrossTwoEngineReplicas() throws Exception {
        try (ConfigurableApplicationContext firstContext = startApplication()) {
            firstContext.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine firstEngine = firstContext.getBean(AbadaEngine.class);
            deployRestartProcess(firstEngine);

            ProcessInstance instance = firstEngine.startProcess(
                    "postgres-restart-recovery", "alice", Map.of());
            String processInstanceId = instance.getId();
            String taskId = firstEngine.getTaskManager()
                    .getVisibleTasksForUser("alice", List.of("operators"))
                    .getFirst()
                    .getId();

            try (ConfigurableApplicationContext secondContext = startApplication()) {
                AbadaEngine secondEngine = secondContext.getBean(AbadaEngine.class);
                CountDownLatch ready = new CountDownLatch(2);
                CountDownLatch start = new CountDownLatch(1);

                try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
                    Future<Boolean> firstResult = executor.submit(
                            completionAttempt(firstEngine, taskId, ready, start));
                    Future<Boolean> secondResult = executor.submit(
                            completionAttempt(secondEngine, taskId, ready, start));

                    assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
                    start.countDown();

                    assertThat(List.of(
                            firstResult.get(10, TimeUnit.SECONDS),
                            secondResult.get(10, TimeUnit.SECONDS)))
                            .containsExactlyInAnyOrder(true, false);
                }

                assertThat(firstContext.getBean(TaskRepository.class).findById(taskId))
                        .isPresent()
                        .get()
                        .extracting(TaskEntity::getStatus)
                        .isEqualTo(TaskStatus.COMPLETED);
                assertThat(firstContext.getBean(ProcessInstanceRepository.class)
                        .findById(processInstanceId))
                        .isPresent()
                        .get()
                        .satisfies(entity -> assertThat(entity.getStatus().name()).isEqualTo("COMPLETED"));

                List<ActivityHistoryEntity> history = firstContext
                        .getBean(ActivityHistoryRepository.class)
                        .findByProcessInstanceIdOrderByOccurredAtAsc(processInstanceId);
                assertThat(history)
                        .filteredOn(event -> "TASK_COMPLETED".equals(event.getEventType()))
                        .hasSize(1);
            }
        }
    }

    @Test
    void preservesConcurrentVariableUpdatesAcrossTwoEngineReplicas() throws Exception {
        try (ConfigurableApplicationContext firstContext = startApplication()) {
            firstContext.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine firstEngine = firstContext.getBean(AbadaEngine.class);
            deployRestartProcess(firstEngine);

            ProcessInstance instance = firstEngine.startProcess(
                    "postgres-restart-recovery", "alice", Map.of("initial", true));

            try (ConfigurableApplicationContext secondContext = startApplication()) {
                AbadaEngine secondEngine = secondContext.getBean(AbadaEngine.class);

                assertThat(runConcurrentAttempts(
                        variableUpdateAttempt(firstEngine, instance.getId(), "fromFirstReplica", 1),
                        variableUpdateAttempt(secondEngine, instance.getId(), "fromSecondReplica", 2)))
                        .containsExactly(true, true);

                assertThat(firstEngine.getProcessInstanceById(instance.getId()).getVariables())
                        .containsEntry("initial", true)
                        .containsEntry("fromFirstReplica", 1)
                        .containsEntry("fromSecondReplica", 2);

                List<ActivityHistoryEntity> history = firstContext
                        .getBean(ActivityHistoryRepository.class)
                        .findByProcessInstanceIdOrderByOccurredAtAsc(instance.getId());
                assertThat(history)
                        .filteredOn(event -> "VARIABLES_UPDATED".equals(event.getEventType()))
                        .hasSize(2);
            }
        }
    }

    @Test
    void atomicallyAcquiresOneTimerAcrossTwoReplicasWithoutDuplicateTransition() throws Exception {
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/timer-event-test.bpmn");
            String instanceId = engine.startProcess("TimerEventProcess", "test-user", Map.of()).getId();
            TaskInstance initial = engine.getTaskManager().getTasksForProcessInstance(instanceId).getFirst();
            engine.completeTask(initial.getId(), "test-user", List.of(), Map.of());
            Thread.sleep(1100);

            try (ConfigurableApplicationContext second = startApplication()) {
                assertThat(runConcurrentAttempts(
                        () -> { first.getBean(JobScheduler.class).executeDueJobs(); return true; },
                        () -> { second.getBean(JobScheduler.class).executeDueJobs(); return true; }))
                        .containsExactly(true, true);

                assertThat(engine.getTaskManager().getTasksForProcessInstance(instanceId))
                        .extracting(TaskInstance::getTaskDefinitionKey).containsExactly("FinalTask");
                assertThat(first.getBean(JobRepository.class).findAll())
                        .singleElement().satisfies(job -> {
                            assertThat(job.getStatus().name()).isEqualTo("COMPLETED");
                            assertThat(job.getAttempts()).isEqualTo(1);
                        });
                assertThat(first.getBean(ActivityHistoryRepository.class)
                        .findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                        .filteredOn(event -> "TIMER_JOB_COMPLETED".equals(event.getEventType())).hasSize(1);
            }
        }
    }

    @Test
    void recoversExpiredTimerLeaseAfterReplicaTermination() throws Exception {
        String instanceId;
        Instant claimedAt;
        try (ConfigurableApplicationContext deadReplica = startApplication()) {
            deadReplica.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = deadReplica.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/timer-event-test.bpmn");
            instanceId = engine.startProcess("TimerEventProcess", "test-user", Map.of()).getId();
            TaskInstance initial = engine.getTaskManager().getTasksForProcessInstance(instanceId).getFirst();
            engine.completeTask(initial.getId(), "test-user", List.of(), Map.of());
            claimedAt = Instant.now().plusSeconds(2);
            assertThat(deadReplica.getBean(TimerJobCommandService.class)
                    .claimDue("dead-replica", claimedAt, 10)).hasSize(1);
        }

        try (ConfigurableApplicationContext survivor = startApplication()) {
            TimerJobCommandService commands = survivor.getBean(TimerJobCommandService.class);
            Instant recoveredAt = claimedAt.plusSeconds(121);
            var recovered = commands.claimDue("surviving-replica", recoveredAt, 10);
            assertThat(recovered).hasSize(1);
            assertThat(commands.execute(recovered.getFirst().getId(), "surviving-replica", recoveredAt)).isTrue();
            assertThat(survivor.getBean(AbadaEngine.class).getTaskManager().getTasksForProcessInstance(instanceId))
                    .extracting(TaskInstance::getTaskDefinitionKey).containsExactly("FinalTask");
        }
    }

    @Test
    void atomicallyFetchesOneExternalTaskAcrossTwoReplicasAndRecoversExpiredWorkerLock() throws Exception {
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/external-task-test.bpmn");
            String instanceId = engine.startProcess("ExternalTaskTestProcess", "worker-user", Map.of()).getId();

            try (ConfigurableApplicationContext second = startApplication()) {
                ExternalTaskCommandService firstCommands = first.getBean(ExternalTaskCommandService.class);
                ExternalTaskCommandService secondCommands = second.getBean(ExternalTaskCommandService.class);
                CountDownLatch ready = new CountDownLatch(2);
                CountDownLatch start = new CountDownLatch(1);
                try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
                    Future<List<com.abada.engine.dto.LockedExternalTask>> a = executor.submit(() -> {
                        ready.countDown(); start.await(10, TimeUnit.SECONDS);
                        return firstCommands.fetchAndLock(
                                new FetchAndLockRequest("worker-a", List.of("test-topic"), 10_000));
                    });
                    Future<List<com.abada.engine.dto.LockedExternalTask>> b = executor.submit(() -> {
                        ready.countDown(); start.await(10, TimeUnit.SECONDS);
                        return secondCommands.fetchAndLock(
                                new FetchAndLockRequest("worker-b", List.of("test-topic"), 10_000));
                    });
                    assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
                    start.countDown();
                    assertThat(a.get(10, TimeUnit.SECONDS).size() + b.get(10, TimeUnit.SECONDS).size()).isEqualTo(1);
                }
                TransactionTemplate transaction = first.getBean(TransactionTemplate.class);
                ExternalTaskRepository repository = first.getBean(ExternalTaskRepository.class);
                transaction.executeWithoutResult(ignored -> {
                    ExternalTaskEntity lockedTask = repository.findAll().getFirst();
                    lockedTask.setLockExpirationTime(Instant.now().minusSeconds(1));
                    repository.save(lockedTask);
                });
                var recovered = secondCommands.fetchAndLock(
                        new FetchAndLockRequest("recovery-worker", List.of("test-topic"), 10_000));
                assertThat(recovered).hasSize(1);
                secondCommands.complete(recovered.getFirst().id(), Map.of("recovered", true));
                assertThat(engine.getProcessInstanceById(instanceId).getVariables()).containsEntry("recovered", true);
            }
        }
    }

    @Test
    void correlatesOneMessageExactlyOnceAcrossTwoReplicas() throws Exception {
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/message-event-test.bpmn");
            String instanceId = engine.startProcess("MessageEventProcess", "test-user",
                    Map.of("correlationKey", "cluster-order")).getId();
            TaskInstance initial = engine.getTaskManager().getTasksForProcessInstance(instanceId).getFirst();
            engine.completeTask(initial.getId(), "test-user", List.of(), Map.of());

            try (ConfigurableApplicationContext second = startApplication()) {
                assertThat(runConcurrentAttempts(
                        () -> { first.getBean(EventManager.class).correlateMessage(
                                "OrderPaid", "cluster-order", Map.of("replica", "a")); return true; },
                        () -> { second.getBean(EventManager.class).correlateMessage(
                                "OrderPaid", "cluster-order", Map.of("replica", "b")); return true; }))
                        .containsExactly(true, true);
                assertThat(engine.getTaskManager().getTasksForProcessInstance(instanceId))
                        .extracting(TaskInstance::getTaskDefinitionKey).containsExactly("Task_FulfillOrder");
                assertThat(first.getBean(ActivityHistoryRepository.class)
                        .findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                        .filteredOn(event -> "EVENT_CORRELATED".equals(event.getEventType())).hasSize(1);
            }
        }
    }

    @Test
    void broadcastsOneSignalExactlyOnceAcrossTwoReplicas() throws Exception {
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/signal-event-test.bpmn");
            String instanceId = engine.startProcess("SignalEventProcess", "test-user", Map.of()).getId();
            TaskInstance initial = engine.getTaskManager().getTasksForProcessInstance(instanceId).getFirst();
            engine.completeTask(initial.getId(), "test-user", List.of(), Map.of());

            try (ConfigurableApplicationContext second = startApplication()) {
                assertThat(runConcurrentAttempts(
                        () -> { first.getBean(EventManager.class).broadcastSignal(
                                "SignalGo", Map.of("replica", "a")); return true; },
                        () -> { second.getBean(EventManager.class).broadcastSignal(
                                "SignalGo", Map.of("replica", "b")); return true; }))
                        .containsExactly(true, true);
                assertThat(engine.getTaskManager().getTasksForProcessInstance(instanceId))
                        .extracting(TaskInstance::getTaskDefinitionKey).containsExactly("FinalTask");
                assertThat(first.getBean(ActivityHistoryRepository.class)
                        .findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                        .filteredOn(event -> "EVENT_CORRELATED".equals(event.getEventType())).hasSize(1);
            }
        }
    }

    @Test
    void serializesCancellationAgainstMessageCorrelationWithoutResurrectingTheInstance() throws Exception {
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deploy(engine, "/bpmn/message-event-test.bpmn");
            String instanceId = engine.startProcess("MessageEventProcess", "test-user",
                    Map.of("correlationKey", "cancel-order")).getId();
            TaskInstance initial = engine.getTaskManager().getTasksForProcessInstance(instanceId).getFirst();
            engine.completeTask(initial.getId(), "test-user", List.of(), Map.of());

            try (ConfigurableApplicationContext second = startApplication()) {
                List<Boolean> results = runConcurrentAttempts(
                        () -> { engine.cancelProcessInstance(instanceId, "cluster cancellation"); return true; },
                        () -> {
                            try {
                                second.getBean(EventManager.class).correlateMessage(
                                        "OrderPaid", "cancel-order", Map.of("paid", true));
                                return true;
                            } catch (ProcessEngineException terminalInstance) {
                                return false;
                            }
                        });
                assertThat(results.getFirst()).isTrue();
                assertThat(engine.getProcessInstanceById(instanceId)).satisfies(cancelled -> {
                    assertThat(cancelled.getStatus()).isEqualTo(ProcessStatus.CANCELLED);
                    assertThat(cancelled.getActiveTokens()).isEmpty();
                });
                List<ActivityHistoryEntity> history = first.getBean(ActivityHistoryRepository.class)
                        .findByProcessInstanceIdOrderByOccurredAtAsc(instanceId);
                assertThat(history).filteredOn(event -> "PROCESS_CANCELLED".equals(event.getEventType())).hasSize(1);
                assertThat(history).filteredOn(event -> "EVENT_CORRELATED".equals(event.getEventType())).hasSizeLessThanOrEqualTo(1);
            }
        }
    }

    @Test
    void returnsOneDeterministicProcessStartForConcurrentDuplicateRequests() throws Exception {
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deployRestartProcess(engine);
            try (ConfigurableApplicationContext second = startApplication()) {
                CountDownLatch ready = new CountDownLatch(2);
                CountDownLatch start = new CountDownLatch(1);
                Callable<Map<String, Object>> firstCall = idempotentStart(first, ready, start);
                Callable<Map<String, Object>> secondCall = idempotentStart(second, ready, start);
                try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
                    Future<Map<String, Object>> a = executor.submit(firstCall);
                    Future<Map<String, Object>> b = executor.submit(secondCall);
                    assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
                    start.countDown();
                    assertThat(a.get(10, TimeUnit.SECONDS)).isEqualTo(b.get(10, TimeUnit.SECONDS));
                }
                assertThat(first.getBean(ProcessInstanceRepository.class).count()).isEqualTo(1);
            }
        }
    }

    @Test
    void rejectsAnIdempotencyKeyReusedForADifferentRequest() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            deployRestartProcess(engine);
            IdempotencyService idempotency = context.getBean(IdempotencyService.class);

            idempotency.execute("reused-key", "process.start", Map.of("request", 1), () ->
                    Map.of("processInstanceId", engine.startProcess(
                            "postgres-restart-recovery", "alice", Map.of()).getId()));

            assertThatThrownBy(() -> idempotency.execute(
                    "reused-key", "process.start", Map.of("request", 2), Map::of))
                    .isInstanceOf(ProcessEngineException.class)
                    .hasMessageContaining("different request");
            assertThat(context.getBean(ProcessInstanceRepository.class).count()).isEqualTo(1);
        }
    }

    @Test
    void treatsEquivalentRequestMapsAsTheSameIdempotentRequestRegardlessOfKeyOrder() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            IdempotencyService idempotency = context.getBean(IdempotencyService.class);
            Map<String, Object> firstOrder = new LinkedHashMap<>();
            firstOrder.put("alpha", 1);
            firstOrder.put("beta", 2);
            Map<String, Object> secondOrder = new LinkedHashMap<>();
            secondOrder.put("beta", 2);
            secondOrder.put("alpha", 1);

            Map<String, Object> first = idempotency.execute(
                    "canonical-request", "test.canonical", firstOrder, () -> Map.of("result", "stored"));
            Map<String, Object> replay = idempotency.execute(
                    "canonical-request", "test.canonical", secondOrder, () -> Map.of("result", "not-run"));

            assertThat(replay).isEqualTo(first).containsEntry("result", "stored");
        }
    }

    @Test
    void concurrentlyLeasesOutboxEventsWithoutOverlap() throws Exception {
        try (ConfigurableApplicationContext first = startApplication()) {
            first.getBean(DatabaseTestHelper.class).cleanup();
            AbadaEngine engine = first.getBean(AbadaEngine.class);
            deployRestartProcess(engine);
            engine.startProcess("postgres-restart-recovery", "alice", Map.of());
            try (ConfigurableApplicationContext second = startApplication()) {
                Instant now = Instant.now();
                CountDownLatch ready = new CountDownLatch(2);
                CountDownLatch start = new CountDownLatch(1);
                try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
                    Future<List<com.abada.engine.core.PublishedLifecycleEvent>> a = executor.submit(() -> {
                        ready.countDown(); start.await(10, TimeUnit.SECONDS);
                        return first.getBean(OutboxService.class).claim("replica-a", 2, now);
                    });
                    Future<List<com.abada.engine.core.PublishedLifecycleEvent>> b = executor.submit(() -> {
                        ready.countDown(); start.await(10, TimeUnit.SECONDS);
                        return second.getBean(OutboxService.class).claim("replica-b", 2, now);
                    });
                    assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
                    start.countDown();
                    var firstLease = a.get(10, TimeUnit.SECONDS);
                    var secondLease = b.get(10, TimeUnit.SECONDS);
                    HashSet<String> ids = new HashSet<>();
                    firstLease.forEach(event -> assertThat(ids.add(event.id())).isTrue());
                    secondLease.forEach(event -> assertThat(ids.add(event.id())).isTrue());
                    assertThat(ids).hasSize(firstLease.size() + secondLease.size());
                    assertThat(firstLease.size() + secondLease.size()).isGreaterThanOrEqualTo(3);
                }
            }
        }
    }

    private Callable<Map<String, Object>> idempotentStart(ConfigurableApplicationContext context,
            CountDownLatch ready, CountDownLatch start) {
        return () -> {
            ready.countDown();
            assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
            return context.getBean(IdempotencyService.class).execute("cluster-start-key", "process.start",
                    Map.of("processId", "postgres-restart-recovery", "variables", Map.of()), () -> {
                        String id = context.getBean(AbadaEngine.class)
                                .startProcess("postgres-restart-recovery", "alice", Map.of()).getId();
                        return Map.of("processInstanceId", id);
                    });
        };
    }

    private Callable<Boolean> completionAttempt(AbadaEngine engine, String taskId,
            CountDownLatch ready, CountDownLatch start) {
        return () -> {
            ready.countDown();
            assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
            try {
                engine.completeTask(taskId, "alice", List.of("operators"), Map.of());
                return true;
            } catch (ProcessEngineException alreadyCompleted) {
                return false;
            }
        };
    }

    private Callable<Boolean> claimAttempt(AbadaEngine engine, String taskId) {
        return () -> {
            try {
                engine.claim(taskId, "alice", List.of("operators"));
                return true;
            } catch (ProcessEngineException alreadyClaimed) {
                return false;
            }
        };
    }

    private Callable<Boolean> failureAttempt(AbadaEngine engine, String taskId) {
        return () -> {
            try {
                engine.failTask(taskId);
                return true;
            } catch (ProcessEngineException alreadyFailed) {
                return false;
            }
        };
    }

    private Callable<Boolean> variableUpdateAttempt(
            AbadaEngine engine, String processInstanceId, String variableName, Object value) {
        return () -> {
            engine.updateProcessVariables(processInstanceId, Map.of(variableName, value));
            return true;
        };
    }

    private List<Boolean> runConcurrentAttempts(
            Callable<Boolean> firstAttempt, Callable<Boolean> secondAttempt) throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);

        Callable<Boolean> gatedFirst = gatedAttempt(firstAttempt, ready, start);
        Callable<Boolean> gatedSecond = gatedAttempt(secondAttempt, ready, start);
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            Future<Boolean> firstResult = executor.submit(gatedFirst);
            Future<Boolean> secondResult = executor.submit(gatedSecond);
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            return List.of(
                    firstResult.get(10, TimeUnit.SECONDS),
                    secondResult.get(10, TimeUnit.SECONDS));
        }
    }

    private Callable<Boolean> gatedAttempt(Callable<Boolean> attempt,
            CountDownLatch ready, CountDownLatch start) {
        return () -> {
            ready.countDown();
            assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
            return attempt.call();
        };
    }

    private void deployRestartProcess(AbadaEngine engine) {
        try (InputStream bpmn = getClass().getResourceAsStream(
                "/bpmn/postgres-restart-recovery.bpmn")) {
            assertThat(bpmn).as("restart-recovery BPMN resource").isNotNull();
            engine.deploy(bpmn);
        } catch (Exception exception) {
            throw new AssertionError("Could not deploy restart-recovery BPMN", exception);
        }
    }

    private void deploy(AbadaEngine engine, String resource) {
        try (InputStream bpmn = getClass().getResourceAsStream(resource)) {
            assertThat(bpmn).as(resource).isNotNull();
            engine.deploy(bpmn);
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
