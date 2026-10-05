package com.abada.engine.core;

import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.api.trace.Span;
import org.springframework.stereotype.Service;

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

    private void record(String eventType, String processInstanceId, String processDefinitionId,
            String activityId, Map<String, ?> details, String projectId) {
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
