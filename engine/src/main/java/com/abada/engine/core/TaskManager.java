package com.abada.engine.core;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.core.model.assignment.AssignmentStrategy;
import com.abada.engine.observability.EngineMetrics;
import com.abada.engine.observability.TraceLogContext;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.TaskRepository;
import io.micrometer.core.instrument.Timer;
import io.micrometer.tracing.annotation.SpanTag;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.instrumentation.annotations.WithSpan;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Stateless task domain and query service.
 *
 * <p>Task objects returned by this service are command-local snapshots. Mutable
 * task state is always loaded from and persisted to PostgreSQL; this component
 * deliberately owns no runtime-wide task map.</p>
 */
@Component
public class TaskManager {

    private static final List<TaskStatus> ACTIVE_STATUSES =
            List.of(TaskStatus.AVAILABLE, TaskStatus.CLAIMED);
    private static final List<TaskStatus> TERMINAL_STATUSES =
            List.of(TaskStatus.COMPLETED, TaskStatus.FAILED);
    private static final String EMPTY_GROUP_SENTINEL = "__abada_no_group__";

    private final TaskRepository taskRepository;
    private final EngineMetrics engineMetrics;
    private final Tracer tracer;

    public TaskManager(TaskRepository taskRepository, EngineMetrics engineMetrics, Tracer tracer) {
        this.taskRepository = taskRepository;
        this.engineMetrics = engineMetrics;
        this.tracer = tracer;
    }

    /** Creates a command-local task snapshot. The caller persists it atomically. */
    @WithSpan("abada.task.create")
    public TaskInstance createTaskSnapshot(
            @SpanTag("task.definition.key") String taskDefinitionKey,
            @SpanTag("task.name") String name,
            @SpanTag("process.instance.id") String processInstanceId,
            String assignee,
            List<String> candidateUsers,
            List<String> candidateGroups,
            AssignmentStrategy assignmentStrategy) {

        Timer.Sample waitingTimeSample = engineMetrics.startTaskWaitingTimer();
        Span span = tracer.spanBuilder("abada.task.create").startSpan();

        try (var scope = TraceLogContext.open(span)) {
            TaskInstance task = new TaskInstance();
            task.setId(UUID.randomUUID().toString());
            task.setTaskDefinitionKey(taskDefinitionKey);
            task.setName(name);
            task.setProcessInstanceId(processInstanceId);
            task.setAssignee(assignee);
            task.setAssignmentStrategy(assignmentStrategy);
            task.setStartDate(Instant.now());
            task.setStatus(assignee == null || assignee.isEmpty()
                    ? TaskStatus.AVAILABLE
                    : TaskStatus.CLAIMED);

            if (candidateUsers != null) {
                task.getCandidateUsers().addAll(candidateUsers);
            }
            if (candidateGroups != null) {
                task.getCandidateGroups().addAll(candidateGroups);
            }

            span.setAttribute("task.id", task.getId());
            span.setAttribute("task.definition.key", taskDefinitionKey);
            span.setAttribute("task.name", name);
            span.setAttribute("process.instance.id", processInstanceId);
            span.setAttribute("task.status", task.getStatus().toString());
            span.setAttribute("task.assignee", assignee != null ? assignee : "");
            span.setAttribute("task.candidate.users.count", candidateUsers != null ? candidateUsers.size() : 0);
            span.setAttribute("task.candidate.groups.count", candidateGroups != null ? candidateGroups.size() : 0);

            engineMetrics.recordTaskCreated(taskDefinitionKey);
            task.setWaitingTimeSample(waitingTimeSample);
            return task;
        } catch (Exception exception) {
            span.recordException(exception);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR, exception.getMessage());
            throw exception;
        } finally {
            span.end();
        }
    }

    @WithSpan("abada.task.claim")
    public void claimTask(
            TaskInstance task,
            @SpanTag("user.name") String user,
            List<String> userGroups) {
        Span span = tracer.spanBuilder("abada.task.claim").startSpan();

        try (var scope = TraceLogContext.open(span)) {
            if (task.getStatus() != TaskStatus.AVAILABLE) {
                throw new ProcessEngineException(
                        "Task is not available to be claimed. Current status: " + task.getStatus());
            }
            if (!isUserEligible(task, user, userGroups)) {
                throw new ProcessEngineException(
                        "User " + user + " is not eligible to claim task " + task.getId());
            }

            task.setAssignee(user);
            task.setStatus(TaskStatus.CLAIMED);

            span.setAttribute("task.id", task.getId());
            span.setAttribute("task.definition.key", task.getTaskDefinitionKey());
            span.setAttribute("task.name", task.getName());
            span.setAttribute("user.name", user);
            span.setAttribute("process.instance.id", task.getProcessInstanceId());

            engineMetrics.recordTaskClaimed(task.getTaskDefinitionKey());
            if (task.getWaitingTimeSample() != null) {
                engineMetrics.recordTaskWaitingTime(task.getWaitingTimeSample(), task.getTaskDefinitionKey());
            }
            task.setProcessingTimeSample(engineMetrics.startTaskProcessingTimer());
        } catch (Exception exception) {
            span.recordException(exception);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR, exception.getMessage());
            throw exception;
        } finally {
            span.end();
        }
    }

    public void unclaimTask(TaskInstance task, String user) {
        if (task.getStatus() != TaskStatus.CLAIMED || task.getAssignee() == null)
            throw new ProcessEngineException("Task is not currently assigned");
        if (user == null || !user.equals(task.getAssignee()))
            throw new ProcessEngineException("Only the current assignee may unclaim the task");
        task.setAssignee(null);
        task.setStatus(TaskStatus.AVAILABLE);
    }

    public void checkCanComplete(TaskInstance task, String user, List<String> userGroups) {
        if (task.getStatus() == TaskStatus.COMPLETED) {
            throw new ProcessEngineException("Task is already completed.");
        }
        if (task.getStatus() == TaskStatus.FAILED) {
            throw new ProcessEngineException("Task has failed and cannot be completed.");
        }

        boolean isAssignee = user != null && user.equals(task.getAssignee());
        boolean isEligibleAndAvailable = task.getStatus() == TaskStatus.AVAILABLE
                && isUserEligible(task, user, userGroups);

        if (!isAssignee && !isEligibleAndAvailable) {
            throw new ProcessEngineException(
                    "User " + user + " is not authorized to complete task " + task.getId());
        }
    }

    @WithSpan("abada.task.complete")
    public void completeTask(TaskInstance task) {
        Span span = tracer.spanBuilder("abada.task.complete").startSpan();

        try (var scope = TraceLogContext.open(span)) {
            task.setStatus(TaskStatus.COMPLETED);
            task.setEndDate(Instant.now());

            span.setAttribute("task.id", task.getId());
            span.setAttribute("task.definition.key", task.getTaskDefinitionKey());
            span.setAttribute("task.name", task.getName());
            span.setAttribute("user.name", task.getAssignee() != null ? task.getAssignee() : "");
            span.setAttribute("process.instance.id", task.getProcessInstanceId());

            engineMetrics.recordTaskCompleted(task.getTaskDefinitionKey());
            if (task.getProcessingTimeSample() != null) {
                engineMetrics.recordTaskProcessingTime(task.getProcessingTimeSample(), task.getTaskDefinitionKey());
            }
        } catch (Exception exception) {
            span.recordException(exception);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR, exception.getMessage());
            throw exception;
        } finally {
            span.end();
        }
    }

    @WithSpan("abada.task.fail")
    public void failTask(TaskInstance task) {
        Span span = tracer.spanBuilder("abada.task.fail").startSpan();

        try (var scope = TraceLogContext.open(span)) {
            if (task.getStatus() == TaskStatus.COMPLETED || task.getStatus() == TaskStatus.FAILED) {
                throw new ProcessEngineException(
                        "Task is already in a terminal state: " + task.getStatus());
            }
            task.setStatus(TaskStatus.FAILED);
            task.setEndDate(Instant.now());

            span.setAttribute("task.id", task.getId());
            span.setAttribute("task.definition.key", task.getTaskDefinitionKey());
            span.setAttribute("task.name", task.getName());
            span.setAttribute("user.name", task.getAssignee() != null ? task.getAssignee() : "");
            span.setAttribute("process.instance.id", task.getProcessInstanceId());
            engineMetrics.recordTaskFailed(task.getTaskDefinitionKey());
        } catch (Exception exception) {
            span.recordException(exception);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR, exception.getMessage());
            throw exception;
        } finally {
            span.end();
        }
    }

    @Transactional(readOnly = true)
    public List<TaskInstance> getVisibleTasksForUser(String user, List<String> groups) {
        return getVisibleTasksForUser(user, groups, null);
    }

    @Transactional(readOnly = true)
    public List<TaskInstance> getVisibleTasksForUser(String user, List<String> groups, TaskStatus status) {
        Pageable ordered = Pageable.unpaged(
                Sort.by("startDate").ascending().and(Sort.by("id").ascending()));
        return getVisibleTasksForUser(user, groups, status, ordered).getContent();
    }

    @Transactional(readOnly = true)
    public Page<TaskInstance> getVisibleTasksForUser(
            String user,
            List<String> groups,
            TaskStatus status,
            Pageable pageable) {
        List<String> effectiveGroups = groups == null || groups.isEmpty()
                ? List.of(EMPTY_GROUP_SENTINEL)
                : List.copyOf(groups);
        boolean hasGroups = groups != null && !groups.isEmpty();
        Collection<TaskStatus> statuses = status == null ? ACTIVE_STATUSES : List.of(status);

        if (status != null && !ACTIVE_STATUSES.contains(status)) {
            return Page.empty(pageable);
        }

        return taskRepository.findVisibleTasks(user, effectiveGroups, hasGroups, statuses, pageable)
                .map(this::materialize);
    }

    @Transactional(readOnly = true)
    public Optional<TaskInstance> getTask(String taskId) {
        return taskRepository.findById(taskId).map(this::materialize);
    }

    @Transactional(readOnly = true)
    public List<TaskInstance> getTasksForProcessInstance(String processInstanceId) {
        return taskRepository
                .findByProcessInstanceIdAndStatusNotIn(processInstanceId, TERMINAL_STATUSES)
                .stream()
                .map(this::materialize)
                .toList();
    }

    TaskInstance materialize(TaskEntity entity) {
        TaskInstance task = new TaskInstance();
        task.setId(entity.getId());
        task.setProcessInstanceId(entity.getProcessInstanceId());
        task.setTaskDefinitionKey(entity.getTaskDefinitionKey());
        task.setName(entity.getName());
        task.setAssignee(entity.getAssignee());
        task.setAssignmentStrategy(entity.getAssignmentStrategy());
        task.setCandidateUsers(new ArrayList<>(entity.getCandidateUsers()));
        task.setCandidateGroups(new ArrayList<>(entity.getCandidateGroups()));
        task.setStatus(entity.getStatus());
        task.setStartDate(entity.getStartDate());
        task.setEndDate(entity.getEndDate());
        task.setEntityVersion(entity.getEntityVersion());
        return task;
    }

    boolean isUserEligible(TaskInstance task, String user, Collection<String> groups) {
        if (task.getAssignee() != null) {
            return task.getAssignee().equals(user);
        }
        return task.getCandidateUsers().contains(user)
                || (groups != null && groups.stream().anyMatch(task.getCandidateGroups()::contains));
    }
}
