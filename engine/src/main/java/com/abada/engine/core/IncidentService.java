package com.abada.engine.core;

import com.abada.engine.persistence.entity.IncidentEntity;
import com.abada.engine.persistence.repository.IncidentRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Opens and resolves incidents inside the caller's workflow command, so an
 * incident commits or rolls back together with the state that caused it.
 */
@Service
public class IncidentService {
    public static final String RESOLVED_BY_CANCEL = "INSTANCE_CANCELLED";
    public static final String RESOLVED_BY_FAIL = "INSTANCE_FAILED";
    public static final String RESOLVED_BY_RETRY = "RETRIED";

    private final IncidentRepository incidents;

    public IncidentService(IncidentRepository incidents) {
        this.incidents = incidents;
    }

    IncidentEntity open(ProcessInstance instance, String tokenId, String activityId, IncidentEntity.Type type,
            String message) {
        IncidentEntity incident = new IncidentEntity();
        incident.setId(UUID.randomUUID().toString());
        incident.setProjectId(instance.getProjectId());
        incident.setProcessInstanceId(instance.getId());
        incident.setTokenId(tokenId);
        incident.setActivityId(activityId);
        incident.setType(type.name());
        incident.setMessage(message.length() > 1024 ? message.substring(0, 1024) : message);
        incident.setCreatedAt(Instant.now());
        return incidents.save(incident);
    }

    /** The open incident of a process instance, or a rejection naming why it cannot be acted on. */
    IncidentEntity requireOpen(String processInstanceId, String incidentId) {
        IncidentEntity incident = incidents.findById(incidentId)
                .filter(found -> found.getProcessInstanceId().equals(processInstanceId))
                .orElseThrow(() -> new com.abada.engine.core.exception.ProcessEngineException(
                        "Incident " + incidentId + " not found for process instance " + processInstanceId));
        if (incident.getResolvedAt() != null) {
            throw new com.abada.engine.core.exception.ProcessEngineException(
                    "Incident " + incidentId + " is already resolved (" + incident.getResolution() + ")");
        }
        return incident;
    }

    void resolve(IncidentEntity incident, String resolution) {
        incident.setResolvedAt(Instant.now());
        incident.setResolution(resolution);
        incidents.save(incident);
    }

    /**
     * Resolves the open incident of one kind on a token (or, for work created
     * before V23, at an activity): an operator acted on the failed work directly.
     */
    void resolveFor(String processInstanceId, String tokenId, String activityId, IncidentEntity.Type type,
            String resolution) {
        List<IncidentEntity> matching = incidents.findByProcessInstanceIdAndResolvedAtIsNull(processInstanceId)
                .stream()
                .filter(incident -> type.name().equals(incident.getType()))
                .filter(incident -> tokenId != null ? tokenId.equals(incident.getTokenId())
                        : activityId.equals(incident.getActivityId()))
                .toList();
        matching.forEach(incident -> resolve(incident, resolution));
    }

    /** Marks the open incidents of an instance resolved, e.g. when an operator cancels it. */
    void resolveAll(String processInstanceId, String resolution) {
        List<IncidentEntity> open = incidents.findByProcessInstanceIdAndResolvedAtIsNull(processInstanceId);
        Instant now = Instant.now();
        open.forEach(incident -> {
            incident.setResolvedAt(now);
            incident.setResolution(resolution);
        });
        incidents.saveAll(open);
    }
}
