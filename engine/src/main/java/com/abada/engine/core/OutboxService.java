package com.abada.engine.core;

import com.abada.engine.persistence.entity.OutboxEventEntity;
import com.abada.engine.persistence.repository.OutboxEventRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
public class OutboxService {
    private static final Duration LEASE_DURATION = Duration.ofSeconds(30);
    private final OutboxEventRepository repository;
    private final ObjectMapper objectMapper;

    public OutboxService(OutboxEventRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    public void enqueue(String eventType, String aggregateType, String aggregateId, Map<String, ?> payload) {
        enqueue(eventType, aggregateType, aggregateId, null, payload);
    }

    /** As {@link #enqueue(String, String, String, Map)}, tagged with its project for the event stream. */
    public void enqueue(String eventType, String aggregateType, String aggregateId, String projectId,
            Map<String, ?> payload) {
        OutboxEventEntity event = new OutboxEventEntity();
        event.setProjectId(projectId);
        event.setEventType(eventType);
        event.setAggregateType(aggregateType);
        event.setAggregateId(aggregateId == null ? "global" : aggregateId);
        try {
            event.setPayloadJson(objectMapper.writeValueAsString(payload == null ? Map.of() : payload));
        } catch (Exception exception) {
            throw new IllegalStateException("Could not serialize lifecycle event " + eventType, exception);
        }
        repository.save(event);
    }

    @AtomicRuntimeCommand
    public List<PublishedLifecycleEvent> claim(String owner, int batchSize, Instant now) {
        return repository.findDispatchableForUpdate(now, batchSize).stream().map(event -> {
            event.setLeaseOwner(owner);
            event.setLeaseExpiresAt(now.plus(LEASE_DURATION));
            repository.save(event);
            return toPublishedEvent(event);
        }).toList();
    }

    @AtomicRuntimeCommand
    public void markPublished(String id, String owner, Instant publishedAt) {
        OutboxEventEntity event = requireOwned(id, owner);
        event.setPublishedAt(publishedAt);
        event.setLeaseOwner(null);
        event.setLeaseExpiresAt(null);
        event.setLastError(null);
        repository.save(event);
    }

    @AtomicRuntimeCommand
    public void markFailed(String id, String owner, String error, Instant now) {
        OutboxEventEntity event = requireOwned(id, owner);
        event.setAttempts(event.getAttempts() + 1);
        event.setLastError(error);
        event.setLeaseOwner(null);
        event.setLeaseExpiresAt(null);
        long delaySeconds = Math.min(300, 1L << Math.min(event.getAttempts(), 8));
        event.setNextAttemptAt(now.plusSeconds(delaySeconds));
        repository.save(event);
    }

    private OutboxEventEntity requireOwned(String id, String owner) {
        OutboxEventEntity event = repository.findByIdForUpdate(id)
                .orElseThrow(() -> new IllegalStateException("Outbox event not found: " + id));
        if (!owner.equals(event.getLeaseOwner()) || event.getPublishedAt() != null) {
            throw new IllegalStateException("Outbox event is not leased by " + owner + ": " + id);
        }
        return event;
    }

    private PublishedLifecycleEvent toPublishedEvent(OutboxEventEntity event) {
        return new PublishedLifecycleEvent(event.getId(), event.getAggregateType(), event.getAggregateId(),
                event.getEventType(), event.getPayloadJson(), event.getOccurredAt());
    }
}
