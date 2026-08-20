package com.abada.engine.dto;

import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.core.model.TaskStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Represents the detailed view of a single user task, including its associated process variables.
 * This is the payload returned by the `GET /v1/tasks/{id}` endpoint.
 */
@Schema(description = "Detailed view of a user task with process context")
public record TaskDetailsDto(
    @Schema(description = "Unique task identifier", example = "task_789")
    String id,
    @Schema(
        description = "BPMN task definition key from the process XML",
        example = "review-order"
    )
    String taskDefinitionKey,
    @Schema(description = "Human-readable task name", example = "Review Order")
    String name,
    @Schema(
        description = "User assigned to this task (null if unassigned)",
        example = "alice"
    )
    String assignee,
    @Schema(description = "Current task status", example = "CLAIMED")
    TaskStatus status,
    @Schema(
        description = "When the task was created",
        example = "2024-01-01T12:00:00Z"
    )
    Instant startDate,
    @Schema(
        description = "When the task was completed (null if still active)",
        example = "2024-01-01T14:30:00Z"
    )
    Instant endDate,
    @Schema(description = "Users who can claim this task", example = "[]")
    List<String> candidateUsers,
    @Schema(
        description = "Groups whose members can claim this task",
        example = "[\"managers\"]"
    )
    List<String> candidateGroups,
    @Schema(
        description = "Form key referencing the form file (e.g., forms/leads.json)",
        example = "forms/lead-form.json"
    )
    String formKey,
    @Schema(
        description = "ID of the process instance containing this task",
        example = "process-instance-456"
    )
    String processInstanceId,
    @Schema(
        description = "BPMN process definition ID",
        example = "order-processing"
    )
    String processDefinitionId,
    @Schema(
        description = "Human-readable process name",
        example = "Order Processing"
    )
    String processDefinitionName,
    @Schema(
        description = "Current status of the process instance",
        example = "RUNNING"
    )
    ProcessStatus processStatus,
    @Schema(
        description = "Whether the process instance is suspended",
        example = "false"
    )
    Boolean processSuspended,
    @Schema(
        description = "When the process instance started",
        example = "2024-01-01T11:50:00Z"
    )
    Instant processStartDate,
    @Schema(
        description = "When the process instance ended (null if still running)",
        example = "null"
    )
    Instant processEndDate,
    @Schema(
        description = "Current active BPMN element ID in the process. " +
            "When multiple tokens exist (parallel paths), returns the first active token.",
        example = "review-order"
    )
    String currentActivityId,
    @Schema(
        description = "Project ID that owns this task",
        example = "project-123"
    )
    String projectId,
    @Schema(description = "All process variables visible to this task")
    Map<String, Object> variables
) {
    public static TaskDetailsDto from(
        TaskInstance task,
        ProcessInstance processInstance
    ) {
        String processDefinitionId = null;
        String processDefinitionName = null;
        ProcessStatus processStatus = null;
        Boolean processSuspended = null;
        Instant processStartDate = null;
        Instant processEndDate = null;
        String currentActivityId = null;
        Map<String, Object> variables = Map.of();

        if (processInstance != null) {
            processDefinitionId =
                processInstance.getDefinition() != null
                    ? processInstance.getDefinition().getId()
                    : null;
            processDefinitionName =
                processInstance.getDefinition() != null
                    ? processInstance.getDefinition().getName()
                    : null;
            processStatus = processInstance.getStatus();
            processSuspended = processInstance.isSuspended();
            processStartDate = processInstance.getStartDate();
            processEndDate = processInstance.getEndDate();
            currentActivityId = processInstance.getActiveTokens().isEmpty()
                ? null
                : processInstance.getActiveTokens().get(0);
            variables = processInstance.getVariables();
        }

        return new TaskDetailsDto(
            task.getId(),
            task.getTaskDefinitionKey(),
            task.getName(),
            task.getAssignee(),
            task.getStatus(),
            task.getStartDate(),
            task.getEndDate(),
            task.getCandidateUsers(),
            task.getCandidateGroups(),
            task.getFormKey(),
            task.getProcessInstanceId(),
            processDefinitionId,
            processDefinitionName,
            processStatus,
            processSuspended,
            processStartDate,
            processEndDate,
            currentActivityId,
            processInstance != null ? processInstance.getProjectId() : null,
            variables
        );
    }
}
