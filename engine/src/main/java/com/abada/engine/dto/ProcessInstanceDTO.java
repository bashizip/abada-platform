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
        String processDefinitionName,
        String currentActivityId,
        ProcessStatus status,
        boolean suspended,
        Instant startDate,
        Instant endDate,
        String startedBy,
        Map<String, Object> variables) {
}
