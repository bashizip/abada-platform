package com.abada.engine.dto;

import com.abada.engine.persistence.entity.IncidentEntity;
import java.time.Instant;

/** An operator-visible runtime incident, e.g. a loop that reached its limit with no exhaustion route. */
public record IncidentDTO(
        String id,
        String projectId,
        String processInstanceId,
        String tokenId,
        String activityId,
        String type,
        String message,
        Instant createdAt,
        Instant resolvedAt,
        String resolution) {

    public static IncidentDTO from(IncidentEntity entity) {
        return new IncidentDTO(entity.getId(), entity.getProjectId(), entity.getProcessInstanceId(),
                entity.getTokenId(), entity.getActivityId(), entity.getType(), entity.getMessage(),
                entity.getCreatedAt(), entity.getResolvedAt(), entity.getResolution());
    }
}
