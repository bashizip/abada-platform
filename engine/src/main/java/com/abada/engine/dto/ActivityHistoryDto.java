package com.abada.engine.dto;

import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;

public record ActivityHistoryDto(
        String id,
        String processInstanceId,
        String processDefinitionId,
        String activityId,
        String eventType,
        String actor,
        Instant occurredAt,
        String traceId,
        Map<String, Object> details,
        /** For a {@code FLOW_TAKEN} event, the flow the token took (also in {@code details.flow}); else null. */
        FlowTakenDto flow) {

    public static ActivityHistoryDto from(ActivityHistoryEntity entity, ObjectMapper objectMapper) {
        try {
            Map<String, Object> details = objectMapper.readValue(entity.getDetailsJson(), new TypeReference<>() {});
            return new ActivityHistoryDto(entity.getId(), entity.getProcessInstanceId(),
                    entity.getProcessDefinitionId(), entity.getActivityId(), entity.getEventType(), entity.getActor(),
                    entity.getOccurredAt(), entity.getTraceId(), details,
                    "FLOW_TAKEN".equals(entity.getEventType()) ? FlowTakenDto.from(details) : null);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored activity history details are invalid", exception);
        }
    }
}
