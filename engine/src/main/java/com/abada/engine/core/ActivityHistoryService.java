package com.abada.engine.core;

import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.api.trace.Span;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;

@Service
public class ActivityHistoryService {
    private final ActivityHistoryRepository repository;
    private final ObjectMapper objectMapper;
    private final OutboxService outboxService;
    private final com.abada.engine.persistence.repository.ProcessInstanceRepository instances;

    public ActivityHistoryService(ActivityHistoryRepository repository, ObjectMapper objectMapper,
            OutboxService outboxService, com.abada.engine.persistence.repository.ProcessInstanceRepository instances) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.outboxService = outboxService;
        this.instances = instances;
    }

    public void record(String eventType, ProcessInstance instance, String activityId, Map<String, ?> details) {
        record(eventType, instance == null ? null : instance.getId(),
                instance == null ? null : instance.getDefinition().getId(), activityId, details,
                instance == null ? null : instance.getProjectId());
    }

    public void record(String eventType, String processInstanceId, String processDefinitionId,
            String activityId, Map<String, ?> details) {
        record(eventType, processInstanceId, processDefinitionId, activityId, details, processInstanceId == null
                ? null : instances.findById(processInstanceId).map(row -> row.getProjectId()).orElse(null));
    }

    /** Event type of the history row a token writes for each sequence flow it takes. */
    public static final String FLOW_TAKEN = "FLOW_TAKEN";

    /**
     * Records the sequence flows the instance's tokens took in this command, one
     * {@code FLOW_TAKEN} row each with {@code details.flow}, in the caller's
     * transaction and in the order they were taken (strictly increasing
     * timestamps). The path is a fact for the instance's history, not a
     * lifecycle event: nothing goes to the outbox, so webhooks and workers
     * see no extra traffic.
     */
    public void recordFlows(ProcessInstance instance, List<ProcessInstance.FlowTaken> flows) {
        if (instance == null || flows.isEmpty()) return;
        List<ActivityHistoryEntity> rows = new ArrayList<>(flows.size());
        Instant at = Instant.now().truncatedTo(ChronoUnit.MICROS);
        for (ProcessInstance.FlowTaken taken : flows) {
            Map<String, Object> flow = new LinkedHashMap<>();
            flow.put("id", taken.flowId());
            flow.put("from", taken.from());
            flow.put("to", taken.to());
            flow.put("tokenId", taken.tokenId());
            flow.put("loopIteration", taken.loopIteration());
            if (taken.condition() != null) flow.put("condition", taken.condition());
            if (taken.otherwise()) flow.put("else", true);
            if (taken.routeKind() != null) {
                Map<String, Object> route = new LinkedHashMap<>();
                route.put("kind", taken.routeKind());
                if (taken.routeCode() != null) route.put("code", taken.routeCode());
                flow.put("route", route);
            }
            ActivityHistoryEntity row = entity(FLOW_TAKEN, instance.getId(), instance.getDefinition().getId(),
                    taken.from(), Map.of("flow", flow));
            row.setOccurredAt(at);
            at = at.plus(1, ChronoUnit.MICROS);
            rows.add(row);
        }
        repository.saveAll(rows);
    }

    private ActivityHistoryEntity entity(String eventType, String processInstanceId, String processDefinitionId,
            String activityId, Map<String, ?> details) {
        ActivityHistoryEntity history = new ActivityHistoryEntity();
        history.setEventType(eventType);
        history.setProcessInstanceId(processInstanceId);
        history.setProcessDefinitionId(processDefinitionId);
        history.setActivityId(activityId);
        history.setActor(IdentityContext.get().map(Identity::username).orElse("system"));
        var spanContext = Span.current().getSpanContext();
        history.setTraceId(spanContext.isValid() ? spanContext.getTraceId() : null);
        try {
            history.setDetailsJson(objectMapper.writeValueAsString(details == null ? Map.of() : details));
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Could not serialize activity history", ex);
        }
        return history;
    }

    private void record(String eventType, String processInstanceId, String processDefinitionId,
            String activityId, Map<String, ?> details, String projectId) {
        ActivityHistoryEntity history = entity(eventType, processInstanceId, processDefinitionId, activityId,
                details);
        repository.save(history);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("processInstanceId", processInstanceId);
        payload.put("processDefinitionId", processDefinitionId);
        payload.put("activityId", activityId);
        payload.put("actor", history.getActor());
        payload.put("traceId", history.getTraceId());
        payload.put("details", details == null ? Map.of() : details);
        outboxService.enqueue(eventType,
                processInstanceId == null ? "PROCESS_DEFINITION" : "PROCESS_INSTANCE",
                processInstanceId == null ? processDefinitionId : processInstanceId,
                projectId, payload);
    }
}
