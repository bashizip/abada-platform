package com.abada.engine.api;

import com.abada.engine.core.OutboxStreamService;
import com.abada.engine.project.ProjectAccessService;
import java.time.Duration;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * {@code GET /v1/projects/{projectId}/events/stream}: the project's lifecycle
 * events as Server-Sent Events (E12), ids only. {@code Last-Event-ID} (or
 * {@code ?lastEventId=}) resumes after a seq; a comment heartbeat keeps idle
 * connections open. Clients reconnect when the stream times out.
 */
@RestController
public class ProjectEventStreamController {
    private static final long TIMEOUT_MILLIS = Duration.ofMinutes(30).toMillis();

    private final OutboxStreamService stream;
    private final ProjectAccessService access;

    public ProjectEventStreamController(OutboxStreamService stream, ProjectAccessService access) {
        this.stream = stream;
        this.access = access;
    }

    @GetMapping(path = "/v1/projects/{projectId}/events/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable String projectId,
            @RequestHeader(value = "Last-Event-ID", required = false) String lastEventHeader,
            @RequestParam(value = "lastEventId", required = false) String lastEventParam) {
        // Checked on the request thread: the identity is not available to the stream's threads.
        access.requireVisible(projectId);
        long now = stream.highWater();
        Long after = parse(lastEventHeader != null ? lastEventHeader : lastEventParam);
        SseEmitter emitter = new SseEmitter(TIMEOUT_MILLIS);
        try {
            // Flushes the headers now, so a client knows the stream is open before the first event or heartbeat.
            emitter.send(SseEmitter.event().comment("connected"));
        } catch (java.io.IOException exception) {
            throw new java.io.UncheckedIOException(exception);
        }
        OutboxStreamService.Subscription subscription = stream.subscribe(projectId, emitter);
        if (after == null || after >= now) {
            subscription.replayed(List.of(), now);
        } else {
            List<OutboxStreamService.StreamEvent> backlog = stream.replay(projectId, after);
            if (backlog.size() > OutboxStreamService.MAX_REPLAY) {
                subscription.reset(now);
                subscription.replayed(List.of(), now);
            } else {
                subscription.replayed(backlog, after);
            }
        }
        return emitter;
    }

    private static Long parse(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return Long.parseLong(value.strip());
        } catch (NumberFormatException exception) {
            return null;
        }
    }
}
