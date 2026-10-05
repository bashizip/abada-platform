package com.abada.engine.dto;

import com.abada.engine.core.model.ProcessStatus;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ProcessInstanceDTO(
        String projectId,
        String id,
        String processDefinitionId,
        String processDefinitionDeploymentId,
        String processDefinitionName,
        String currentActivityId,
        ProcessStatus status,
        boolean suspended,
        Instant startDate,
        Instant endDate,
        String startedBy,
        Map<String, Object> variables,
        // E20a (additive): set for a child started by a call-process node.
        String parentInstanceId,
        String parentActivityId,
        String rootInstanceId) {

    public ProcessInstanceDTO(String projectId, String id, String processDefinitionId,
            String processDefinitionDeploymentId, String processDefinitionName, String currentActivityId,
            ProcessStatus status, boolean suspended, Instant startDate, Instant endDate, String startedBy,
            Map<String, Object> variables) {
        this(projectId, id, processDefinitionId, processDefinitionDeploymentId, processDefinitionName,
                currentActivityId, status, suspended, startDate, endDate, startedBy, variables, null, null, null);
    }
}
