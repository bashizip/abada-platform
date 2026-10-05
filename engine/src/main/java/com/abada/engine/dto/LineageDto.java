package com.abada.engine.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

/**
 * Where a process instance sits in a call-process tree: its ancestors from the
 * root down to its parent, and its direct children (any status).
 */
public record LineageDto(String instanceId, String rootInstanceId, int depth, List<Link> ancestors,
        List<Link> children) {

    /**
     * One related instance. {@code parentActivityId} is the call activity of
     * the instance above it that started it (null for the root).
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Link(String instanceId, String processDefinitionId, String status, String parentActivityId,
            Integer depth, Instant startDate, Instant endDate) {}
}
