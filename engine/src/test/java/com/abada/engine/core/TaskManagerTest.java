package com.abada.engine.core;

import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.core.model.assignment.AssignmentStrategy;
import com.abada.engine.observability.EngineMetrics;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.TaskRepository;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TaskManagerTest {

    @Mock
    private TaskRepository taskRepository;
    @Mock
    private EngineMetrics engineMetrics;
    @Mock
    private Tracer tracer;
    @Mock
    private Span span;
    @Mock
    private io.opentelemetry.api.trace.SpanBuilder spanBuilder;

    private TaskManager taskManager;

    @BeforeEach
    void setUp() {
        lenient().when(tracer.spanBuilder(anyString())).thenReturn(spanBuilder);
        lenient().when(spanBuilder.startSpan()).thenReturn(span);
        lenient().when(span.makeCurrent()).thenReturn(() -> { });
        taskManager = new TaskManager(taskRepository, engineMetrics, tracer);
    }

    @Test
    void createsCommandLocalSnapshotWithoutPublishingRuntimeState() {
        String processInstanceId = UUID.randomUUID().toString();

        TaskInstance task = taskManager.createTaskSnapshot(
                "approveTask", "Approve Request", processInstanceId,
                null, List.of("user1"), List.of("group1"), null, AssignmentStrategy.CLAIM);

        assertThat(task.getTaskDefinitionKey()).isEqualTo("approveTask");
        assertThat(task.getProcessInstanceId()).isEqualTo(processInstanceId);
        assertThat(task.getStatus()).isEqualTo(TaskStatus.AVAILABLE);
        verifyNoInteractions(taskRepository);
    }

    @Test
    void unclaimClearsAssigneeButPreservesCandidates() {
        TaskInstance task = new TaskInstance();
        task.setStatus(TaskStatus.CLAIMED);
        task.setAssignee("alice");
        task.getCandidateUsers().add("alice");
        task.getCandidateGroups().add("finance");

        taskManager.unclaimTask(task, "alice");

        assertThat(task.getStatus()).isEqualTo(TaskStatus.AVAILABLE);
        assertThat(task.getAssignee()).isNull();
        assertThat(task.getCandidateUsers()).containsExactly("alice");
        assertThat(task.getCandidateGroups()).containsExactly("finance");
    }

    @Test
    void claimsAnAuthoritativeCommandSnapshot() {
        TaskInstance task = taskManager.materialize(taskEntity(
                "reviewTask", "Review Document", TaskStatus.AVAILABLE,
                null, List.of("user2"), List.of("group2")));

        taskManager.claimTask(task, "user2", List.of("group2"));

        assertThat(task.getStatus()).isEqualTo(TaskStatus.CLAIMED);
        assertThat(task.getAssignee()).isEqualTo("user2");
    }

    @Test
    void completesAnAuthoritativeCommandSnapshot() {
        TaskInstance task = taskManager.materialize(taskEntity(
                "signOffTask", "Final Sign Off", TaskStatus.CLAIMED,
                "user3", List.of(), List.of()));

        taskManager.checkCanComplete(task, "user3", List.of());
        taskManager.completeTask(task);

        assertThat(task.getStatus()).isEqualTo(TaskStatus.COMPLETED);
        assertThat(task.getEndDate()).isNotNull();
    }

    @Test
    void readsVisibleTasksFromRepositoryInsteadOfMemory() {
        TaskEntity entity = taskEntity(
                "validateInvoice", "Validate Invoice", TaskStatus.AVAILABLE,
                null, List.of("user4"), List.of("group4"));
        when(taskRepository.findVisibleTasks(
                eq("user4"), eq(List.of("group4")), eq(true), anyCollection(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(entity)));
        when(taskRepository.findById(entity.getId())).thenReturn(Optional.of(entity));

        assertThat(taskManager.getVisibleTasksForUser("user4", List.of("group4")))
                .extracting(TaskInstance::getId)
                .containsExactly(entity.getId());
        assertThat(taskManager.getTask(entity.getId()))
                .isPresent()
                .get()
                .extracting(TaskInstance::getName)
                .isEqualTo("Validate Invoice");
    }

    private TaskEntity taskEntity(String definitionKey, String name, TaskStatus status,
            String assignee, List<String> candidateUsers, List<String> candidateGroups) {
        TaskEntity entity = new TaskEntity();
        entity.setId(UUID.randomUUID().toString());
        entity.setProcessInstanceId(UUID.randomUUID().toString());
        entity.setTaskDefinitionKey(definitionKey);
        entity.setName(name);
        entity.setStatus(status);
        entity.setAssignee(assignee);
        entity.setCandidateUsers(candidateUsers);
        entity.setCandidateGroups(candidateGroups);
        entity.setStartDate(Instant.now());
        return entity;
    }
}
