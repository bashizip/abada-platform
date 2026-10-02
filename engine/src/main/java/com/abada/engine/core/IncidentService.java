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
