package com.abada.engine.project;

import com.abada.engine.dto.WorkerHealthDTO;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.entity.ProjectWorkerBindingEntity;
import com.abada.engine.persistence.entity.WorkerHealthEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.persistence.repository.ProjectWorkerBindingRepository;
import com.abada.engine.persistence.repository.WorkerHealthRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Durable liveness and incident record for external workers per project,
 * principal and topic. Every fetch-and-lock poll (debounced) refreshes the
 * worker's heartbeat; every rejected fetch stores the rejection message and
 * bumps the consecutive-failure counter, so an unreachable or misconfigured
 * agent worker is visible in the operations surface instead of only its own
 * container logs.
 *
 * These records are operational metadata, not workflow state: writes are
 * last-writer-wins and never block nor fail a fetch.
 */
@Service
public class WorkerHealthService {

    static final Duration HEARTBEAT_DEBOUNCE = Duration.ofSeconds(10);
    static final Duration ONLINE_WINDOW = Duration.ofSeconds(60);
    static final Duration INCIDENT_RETENTION = Duration.ofHours(24);
    static final String STATUS_ONLINE = "ONLINE";
    static final String STATUS_ERROR = "ERROR";
    static final String STATUS_OFFLINE = "OFFLINE";

    private final WorkerHealthRepository health;
    private final ProjectWorkerBindingRepository bindings;
    private final PrincipalRepository principals;
    private final ProjectAccessService access;

    public WorkerHealthService(WorkerHealthRepository health,
            ProjectWorkerBindingRepository bindings, PrincipalRepository principals,
            ProjectAccessService access) {
        this.health = health;
        this.bindings = bindings;
        this.principals = principals;
        this.access = access;
    }

    @Transactional
    public void noteFetchSuccess(String projectId, String principalId, String workerId,
            List<String> topics, boolean anyLocked) {
        if (projectId == null || principalId == null) return;
        Instant now = Instant.now();
        for (String topic : normalizedTopics(topics)) {
            var row = health.findByProjectIdAndPrincipalIdAndTopic(projectId, principalId, topic)
                    .orElseGet(WorkerHealthEntity::new);
            if (row.getLastSeenAt() != null && row.getLastErrorAt() == null
                    && row.getLastSeenAt().isAfter(now.minus(HEARTBEAT_DEBOUNCE))) {
                continue;
            }
            row.setProjectId(projectId);
            row.setPrincipalId(principalId);
            row.setTopic(topic);
            row.setStatus(STATUS_ONLINE);
            row.setLastSeenAt(now);
            row.setLastSuccessAt(now);
            row.setLastErrorAt(null);
            row.setLastErrorMessage(null);
            row.setConsecutiveFailures(0);
            row.setLastWorkerId(workerId);
            health.save(row);
        }
    }

    @Transactional
    public void noteFetchFailure(String projectId, String principalId, String workerId,
            List<String> topics, String message) {
        if (projectId == null || principalId == null) return;
        Instant now = Instant.now();
        for (String topic : normalizedTopics(topics)) {
            var row = health.findByProjectIdAndPrincipalIdAndTopic(projectId, principalId, topic)
                    .orElseGet(WorkerHealthEntity::new);
            row.setProjectId(projectId);
            row.setPrincipalId(principalId);
            row.setTopic(topic);
            row.setStatus(STATUS_ERROR);
            row.setLastSeenAt(now);
            row.setLastErrorAt(now);
            row.setLastErrorMessage(message);
            row.setConsecutiveFailures(row.getConsecutiveFailures() + 1);
            row.setLastWorkerId(workerId);
            health.save(row);
        }
    }

    @Transactional(readOnly = true)
    public List<WorkerHealthDTO> healthForProject(String projectId) {
        access.require(projectId, Role.VIEWER, Role.OPERATOR, Role.OWNER);
        Map<String, Map<String, ProjectWorkerBindingEntity>> bindingByPrincipalTopic = bindings
                .findByProjectId(projectId).stream()
                .collect(Collectors.toMap(
                        ProjectWorkerBindingEntity::getPrincipalId,
binding -> normalizedTopics(List.of(binding.getTopics().split(","))).stream()
                        .collect(Collectors.toMap(topic -> topic, topic -> binding)),
                        (left, right) -> left));
        List<WorkerHealthEntity> recent = health.findByProjectIdOrderByTopicAsc(projectId).stream()
                .filter(row -> recent(row))
                .toList();

        Map<String, WorkerHealthEntity> healthByPrincipalTopic = recent.stream()
                .collect(Collectors.toMap(
                        row -> key(row.getPrincipalId(), row.getTopic()),
                        Function.identity(),
                        (left, right) -> left));

        List<WorkerHealthDTO> result = new ArrayList<>();
        bindingByPrincipalTopic.forEach((principalId, byTopic) ->
                byTopic.forEach((topic, binding) ->
                        result.add(toDto(projectId, principalId, topic, true,
                                healthByPrincipalTopic.get(key(principalId, topic))))));
        recent.stream()
                .filter(row -> !bindingByPrincipalTopic.containsKey(row.getPrincipalId())
                        || !bindingByPrincipalTopic.get(row.getPrincipalId()).containsKey(row.getTopic()))
                .forEach(row -> result.add(toDto(projectId, row.getPrincipalId(), row.getTopic(),
                        false, row)));

        result.sort(Comparator
                .comparing(WorkerHealthDTO::principalUsername, Comparator.nullsLast(String::compareTo))
                .thenComparing(WorkerHealthDTO::topic));
        return result;
    }

    private WorkerHealthDTO toDto(String projectId, String principalId, String topic,
            boolean bound, WorkerHealthEntity row) {
        String username = principals.findById(principalId).map(user -> user.getUsername()).orElse(principalId);
        if (row == null) {
            return new WorkerHealthDTO(projectId, principalId, username, topic, bound,
                    STATUS_OFFLINE, null, null, null, null, 0, null);
        }
        String status = row.getConsecutiveFailures() > 0
                || (row.getLastErrorAt() != null && (row.getLastSuccessAt() == null
                        || row.getLastErrorAt().isAfter(row.getLastSuccessAt())))
                ? STATUS_ERROR
                : row.getLastSeenAt() != null && row.getLastSeenAt().isAfter(Instant.now().minus(ONLINE_WINDOW))
                        ? STATUS_ONLINE
                        : STATUS_OFFLINE;
        return new WorkerHealthDTO(projectId, principalId, username, topic, bound, status,
                row.getLastSeenAt(), row.getLastSuccessAt(), row.getLastErrorAt(),
                row.getLastErrorMessage(), row.getConsecutiveFailures(), row.getLastWorkerId());
    }

    private boolean recent(WorkerHealthEntity row) {
        Instant now = Instant.now();
        return row.getLastSeenAt() != null && row.getLastSeenAt().isAfter(now.minus(INCIDENT_RETENTION));
    }

    private static String key(String principalId, String topic) {
        return principalId + "\u0000" + topic;
    }

    private static List<String> normalizedTopics(List<String> topics) {
        return topics == null ? List.of() : topics.stream()
                .map(String::strip)
                .filter(topic -> !topic.isBlank())
                .distinct()
                .sorted()
                .toList();
    }
}