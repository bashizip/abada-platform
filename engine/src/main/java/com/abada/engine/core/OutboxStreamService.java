package com.abada.engine.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * The project event stream (E12): every replica tails committed outbox rows
 * by {@code seq} and fans them out to its own subscribers, so any replica
 * serves any client. Events carry ids only (event type, instance, activity),
 * never payloads.
 *
 * <p>{@code seq} is assigned at insert, not at commit, so a later row can
 * become visible before an earlier one. A missing {@code seq} holds the
 * stream for up to {@code gapHold} while its transaction may still commit;
 * after that it is skipped (a rolled-back transaction leaves a permanent gap).
 */
@Service
public class OutboxStreamService implements org.springframework.context.SmartLifecycle {
    private static final Logger log = LoggerFactory.getLogger(OutboxStreamService.class);
    /** Most rows one Last-Event-ID resume replays; beyond that the client is told to reload. */
    public static final int MAX_REPLAY = 1_000;
    private static final int BATCH = 500;

    /** One event as streamed: ids only. */
    public record StreamEvent(long seq, String projectId, String eventType, String processInstanceId,
            String activityId, Instant occurredAt) {
        public Map<String, Object> data() {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("seq", seq);
            data.put("eventType", eventType);
            if (processInstanceId != null) data.put("processInstanceId", processInstanceId);
            if (activityId != null) data.put("activityId", activityId);
            data.put("occurredAt", occurredAt == null ? null : occurredAt.toString());
            return data;
        }
    }

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final boolean enabled;
    private final long pollMillis;
    private final Duration gapHold;
    private final long heartbeatMillis;
    private final Map<String, Set<Subscription>> byProject = new ConcurrentHashMap<>();
    private ScheduledExecutorService scheduler;
    private volatile Long highWater;
    private Instant gapSince;

    public OutboxStreamService(JdbcTemplate jdbc, ObjectMapper json,
            @Value("${abada.events.stream.enabled:true}") boolean enabled,
            @Value("${abada.events.stream.poll-interval-ms:500}") long pollMillis,
            @Value("${abada.events.stream.gap-hold-ms:5000}") long gapHoldMillis,
            @Value("${abada.events.stream.heartbeat-ms:15000}") long heartbeatMillis) {
        this.jdbc = jdbc;
        this.json = json;
        this.enabled = enabled;
        this.pollMillis = pollMillis;
        this.gapHold = Duration.ofMillis(gapHoldMillis);
        this.heartbeatMillis = heartbeatMillis;
    }

    private volatile boolean running;

    @Override
    public void start() {
        running = true;
        if (!enabled) return;
        scheduler = Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().daemon().name("abada-event-stream")
                .factory());
        scheduler.scheduleWithFixedDelay(this::pollQuietly, pollMillis, pollMillis, TimeUnit.MILLISECONDS);
        scheduler.scheduleWithFixedDelay(this::heartbeat, heartbeatMillis, heartbeatMillis, TimeUnit.MILLISECONDS);
    }

    /**
     * Ends every stream before the web server's graceful shutdown (a higher
     * phase stops first): open streams would otherwise hold it to its timeout.
     * Clients reconnect, with their Last-Event-ID, to another replica.
     */
    @Override
    public void stop() {
        running = false;
        if (scheduler != null) scheduler.shutdownNow();
        byProject.values().forEach(subscriptions -> subscriptions.forEach(Subscription::complete));
        byProject.clear();
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return Integer.MAX_VALUE;
    }

    /** The newest seq this replica has streamed; the start of a client without Last-Event-ID. */
    public synchronized long highWater() {
        if (highWater == null) {
            Long max = jdbc.queryForObject("select max(seq) from outbox_events", Long.class);
            highWater = max == null ? 0L : max;
        }
        return highWater;
    }

    private void pollQuietly() {
        try {
            poll();
        } catch (RuntimeException exception) {
            log.warn("Event stream poll failed: {}", exception.getMessage());
        }
    }

    /** Streams the rows committed since the last poll, in seq order, holding a fresh gap. */
    public synchronized void poll() {
        long from = highWater();
        List<StreamEvent> rows = jdbc.query("select seq, project_id, event_type, aggregate_type, aggregate_id,"
                + " payload_json, occurred_at from outbox_events where seq > ? order by seq limit " + BATCH,
                rowMapper(), from);
        Instant now = Instant.now();
        for (StreamEvent event : rows) {
            if (event.seq() != highWater + 1) {
                // An earlier seq is not visible: its transaction may still commit.
                if (gapSince == null) gapSince = now;
                if (Duration.between(gapSince, now).compareTo(gapHold) < 0) return;
            }
            gapSince = null;
            highWater = event.seq();
            publish(event);
        }
    }

    /** The project's events after {@code afterSeq} up to what this replica streamed, oldest first. */
    public List<StreamEvent> replay(String projectId, long afterSeq) {
        return jdbc.query("select seq, project_id, event_type, aggregate_type, aggregate_id, payload_json,"
                + " occurred_at from outbox_events where project_id = ? and seq > ? and seq <= ? order by seq limit "
                + (MAX_REPLAY + 1), rowMapper(), projectId, afterSeq, highWater());
    }

    /**
     * Opens a subscription that buffers live events until {@link Subscription#replayed}
     * flushes them after the resume, so a client never sees an event twice or out of order.
     */
    public Subscription subscribe(String projectId, SseEmitter emitter) {
        Subscription subscription = new Subscription(projectId, emitter);
        byProject.computeIfAbsent(projectId, key -> ConcurrentHashMap.newKeySet()).add(subscription);
        emitter.onCompletion(() -> remove(subscription));
        emitter.onTimeout(() -> remove(subscription));
        emitter.onError(error -> remove(subscription));
        return subscription;
    }

    public int subscribers(String projectId) {
        return byProject.getOrDefault(projectId, Set.of()).size();
    }

    private void publish(StreamEvent event) {
        if (event.projectId() == null) return;
        for (Subscription subscription : byProject.getOrDefault(event.projectId(), Set.of())) {
            subscription.deliver(event);
        }
    }

    private void heartbeat() {
        byProject.values().forEach(subscriptions -> subscriptions.forEach(Subscription::heartbeat));
    }

    private void remove(Subscription subscription) {
        Set<Subscription> subscriptions = byProject.get(subscription.projectId);
        if (subscriptions != null) subscriptions.remove(subscription);
    }

    private RowMapper<StreamEvent> rowMapper() {
        return (row, index) -> {
            String aggregateType = row.getString("aggregate_type");
            String instanceId = "PROCESS_INSTANCE".equals(aggregateType) ? row.getString("aggregate_id") : null;
            Timestamp occurred = row.getTimestamp("occurred_at");
            return new StreamEvent(row.getLong("seq"), row.getString("project_id"), row.getString("event_type"),
                    instanceId, activityOf(row.getString("payload_json")),
                    occurred == null ? null : occurred.toInstant());
        };
    }

    private String activityOf(String payload) {
        try {
            JsonNode activity = json.readTree(payload).get("activityId");
            return activity == null || activity.isNull() ? null : activity.asText();
        } catch (IOException | RuntimeException exception) {
            return null;
        }
    }

    /** One client of the stream. Sends are serialized; anything already sent is never sent again. */
    public final class Subscription {
        private final String projectId;
        private final SseEmitter emitter;
        private final List<StreamEvent> pending = new ArrayList<>();
        private boolean replaying = true;
        private long lastSent;

        private Subscription(String projectId, SseEmitter emitter) {
            this.projectId = projectId;
            this.emitter = emitter;
        }

        /** Sends the resume backlog, then whatever arrived live meanwhile, then streams live. */
        public synchronized void replayed(List<StreamEvent> backlog, long startAfter) {
            lastSent = startAfter;
            backlog.forEach(this::send);
            pending.sort(Comparator.comparingLong(StreamEvent::seq));
            pending.forEach(this::send);
            pending.clear();
            replaying = false;
        }

        /** Tells the client its resume point is too old: reload, then stream from now. */
        public synchronized void reset(long now) {
            try {
                emitter.send(SseEmitter.event().id(Long.toString(now)).name("reset").data(Map.of("seq", now)));
            } catch (IOException | IllegalStateException exception) {
                fail();
            }
        }

        synchronized void deliver(StreamEvent event) {
            if (replaying) {
                pending.add(event);
                return;
            }
            send(event);
        }

        private void send(StreamEvent event) {
            if (event.seq() <= lastSent) return;
            try {
                emitter.send(SseEmitter.event().id(Long.toString(event.seq())).name(event.eventType())
                        .data(event.data()));
                lastSent = event.seq();
            } catch (IOException | IllegalStateException exception) {
                fail();
            }
        }

        synchronized void heartbeat() {
            try {
                emitter.send(SseEmitter.event().comment("heartbeat"));
            } catch (IOException | IllegalStateException exception) {
                fail();
            }
        }

        private void fail() {
            remove(this);
            try {
                emitter.complete();
            } catch (RuntimeException ignored) {
                // Already closed by the client.
            }
        }

        void complete() {
            try {
                emitter.complete();
            } catch (RuntimeException ignored) {
                // Already closed.
            }
        }
    }
}
