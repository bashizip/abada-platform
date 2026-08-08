package com.abada.engine.core;

import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.dto.UserStatsDto;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.TaskRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import com.abada.engine.project.ProjectConstants;

@Service
public class UserStatsService {

    private final TaskManager taskManager;
    private final AbadaEngine abadaEngine;
    private final TaskRepository taskRepository;

    public UserStatsService(
        TaskManager taskManager,
        AbadaEngine abadaEngine,
        TaskRepository taskRepository
    ) {
        this.taskManager = taskManager;
        this.abadaEngine = abadaEngine;
        this.taskRepository = taskRepository;
    }

    public UserStatsDto getUserStats(String username, List<String> userGroups) {
        return getUserStats(ProjectConstants.DEFAULT_PROJECT_ID, username, userGroups);
    }

    public UserStatsDto getUserStats(String projectId, String username, List<String> userGroups) {
        // Get all tasks for the user (both assigned and available)
        List<TaskEntity> userTasks = taskRepository.findTasksForUser(username).stream()
                .filter(task -> belongsToProject(task, projectId)).toList();

        // Quick stats
        UserStatsDto.QuickStats quickStats = calculateQuickStats(
            username,
            userGroups,
            userTasks,
            projectId
        );

        // Recent tasks (last 10)
        List<UserStatsDto.RecentTask> recentTasks = getRecentTasks(projectId, username);

        // Tasks by status
        Map<TaskStatus, Integer> tasksByStatus = calculateTasksByStatus(
            userTasks
        );

        // Overdue tasks (CLAIMED for more than 7 days)
        List<UserStatsDto.OverdueTask> overdueTasks = getOverdueTasks(projectId, username);

        // Process activity
        UserStatsDto.ProcessActivity processActivity = calculateProcessActivity(
            username,
            userTasks
        );

        return new UserStatsDto(
            quickStats,
            recentTasks,
            tasksByStatus,
            overdueTasks,
            processActivity
        );
    }

    private UserStatsDto.QuickStats calculateQuickStats(
        String username,
        List<String> userGroups,
        List<TaskEntity> userTasks,
        String projectId
    ) {
        // Active tasks (CLAIMED by user)
        long activeTasks = userTasks
            .stream()
            .filter(
                task ->
                    username.equals(task.getAssignee()) &&
                    task.getStatus() == TaskStatus.CLAIMED
            )
            .count();

        // Completed tasks (COMPLETED by user)
        long completedTasks = userTasks
            .stream()
            .filter(
                task ->
                    username.equals(task.getAssignee()) &&
                    task.getStatus() == TaskStatus.COMPLETED
            )
            .count();

        // Running processes (processes that have tasks for the user)
        Set<String> processInstanceIds = userTasks
            .stream()
            .map(TaskEntity::getProcessInstanceId)
            .collect(Collectors.toSet());

        long runningProcesses = processInstanceIds
            .stream()
            .map(abadaEngine::getProcessInstanceById)
            .filter(Objects::nonNull)
            .filter(pi -> pi.getStatus() == ProcessStatus.RUNNING)
            .count();

        // Available tasks (tasks user can claim)
        List<TaskEntity> availableTasks = taskManager
            .getVisibleTasksForUser(projectId, username, userGroups, TaskStatus.AVAILABLE)
            .stream()
            .map(this::convertToTaskEntity)
            .collect(Collectors.toList());

        return new UserStatsDto.QuickStats(
            (int) activeTasks,
            (int) completedTasks,
            (int) runningProcesses,
            availableTasks.size()
        );
    }

    private List<UserStatsDto.RecentTask> getRecentTasks(String projectId, String username) {
        return taskRepository
            .findRecentTasksByAssignee(username)
            .stream()
            .filter(task -> belongsToProject(task, projectId))
            .limit(10)
            .map(this::convertToRecentTask)
            .collect(Collectors.toList());
    }

    private Map<TaskStatus, Integer> calculateTasksByStatus(
        List<TaskEntity> userTasks
    ) {
        return userTasks
            .stream()
            .collect(
                Collectors.groupingBy(
                    TaskEntity::getStatus,
                    Collectors.collectingAndThen(
                        Collectors.counting(),
                        Math::toIntExact
                    )
                )
            );
    }

    private List<UserStatsDto.OverdueTask> getOverdueTasks(String projectId, String username) {
        Instant sevenDaysAgo = Instant.now().minus(7, ChronoUnit.DAYS);

        return taskRepository
            .findOverdueTasksByAssignee(
                username,
                TaskStatus.CLAIMED,
                sevenDaysAgo
            )
            .stream()
            .filter(task -> belongsToProject(task, projectId))
            .map(task -> {
                long daysOverdue = ChronoUnit.DAYS.between(
                    task.getStartDate(),
                    Instant.now()
                );
                return new UserStatsDto.OverdueTask(
                    task.getId(),
                    task.getName(),
                    task.getTaskDefinitionKey(),
                    task.getStartDate(),
                    daysOverdue,
                    task.getProcessInstanceId()
                );
            })
            .collect(Collectors.toList());
    }

    private UserStatsDto.ProcessActivity calculateProcessActivity(
        String username,
        List<TaskEntity> userTasks
    ) {
        // Get unique process instance IDs for user's tasks
        Set<String> processInstanceIds = userTasks
            .stream()
            .map(TaskEntity::getProcessInstanceId)
            .collect(Collectors.toSet());

        // Recently started processes (last 10)
        List<UserStatsDto.RecentProcess> recentlyStartedProcesses =
            processInstanceIds
                .stream()
                .map(abadaEngine::getProcessInstanceById)
                .filter(Objects::nonNull)
                .sorted((p1, p2) ->
                    p2.getStartDate().compareTo(p1.getStartDate())
                )
                .limit(10)
                .map(pi -> {
                    String processDefinitionId =
                        pi.getDefinition() != null
                            ? pi.getDefinition().getId()
                            : null;
                    String processDefinitionName =
                        pi.getDefinition() != null
                            ? pi.getDefinition().getName()
                            : null;
                    return new UserStatsDto.RecentProcess(
                        pi.getId(),
                        processDefinitionId,
                        processDefinitionName,
                        pi.getStartDate(),
                        pi.getActiveTokens().isEmpty()
                            ? null
                            : pi.getActiveTokens().get(0)
                    );
                })
                .collect(Collectors.toList());

        // Active process count
        long activeProcessCount = processInstanceIds
            .stream()
            .map(abadaEngine::getProcessInstanceById)
            .filter(Objects::nonNull)
            .filter(pi -> pi.getStatus() == ProcessStatus.RUNNING)
            .count();

        // Completion rate (simplified: completed processes / total processes for user)
        long totalProcesses = processInstanceIds.size();
        long completedProcesses = processInstanceIds
            .stream()
            .map(abadaEngine::getProcessInstanceById)
            .filter(Objects::nonNull)
            .filter(pi -> pi.getStatus() == ProcessStatus.COMPLETED)
            .count();

        double completionRate =
            totalProcesses > 0
                ? (double) completedProcesses / totalProcesses
                : 0.0;

        return new UserStatsDto.ProcessActivity(
            recentlyStartedProcesses,
            (int) activeProcessCount,
            completionRate
        );
    }

    private TaskEntity convertToTaskEntity(
        com.abada.engine.core.model.TaskInstance taskInstance
    ) {
        TaskEntity entity = new TaskEntity();
        entity.setId(taskInstance.getId());
        entity.setProcessInstanceId(taskInstance.getProcessInstanceId());
        entity.setAssignee(taskInstance.getAssignee());
        entity.setTaskDefinitionKey(taskInstance.getTaskDefinitionKey());
        entity.setName(taskInstance.getName());
        entity.setStatus(taskInstance.getStatus());
        entity.setStartDate(taskInstance.getStartDate());
        entity.setEndDate(taskInstance.getEndDate());
        entity.setCandidateUsers(taskInstance.getCandidateUsers());
        entity.setCandidateGroups(taskInstance.getCandidateGroups());
        return entity;
    }

    private UserStatsDto.RecentTask convertToRecentTask(TaskEntity task) {
        // Get process instance to fetch process definition details
        ProcessInstance processInstance = abadaEngine.getProcessInstanceById(
            task.getProcessInstanceId()
        );
        String processDefinitionId = task.getProcessInstanceId(); // fallback to instance ID
        String processDefinitionName = null;

        if (
            processInstance != null && processInstance.getDefinition() != null
        ) {
            processDefinitionId = processInstance.getDefinition().getId();
            processDefinitionName = processInstance.getDefinition().getName();
        }

        return new UserStatsDto.RecentTask(
            task.getId(),
            task.getName(),
            task.getTaskDefinitionKey(),
            task.getStatus(),
            task.getStartDate(),
            task.getProcessInstanceId(),
            processDefinitionId,
            processDefinitionName,
            task.getAssignee()
        );
    }

    private boolean belongsToProject(TaskEntity task, String projectId) {
        ProcessInstance instance = abadaEngine.getProcessInstanceById(task.getProcessInstanceId());
        return instance != null && projectId.equals(instance.getProjectId());
    }
}
