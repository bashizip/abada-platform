package com.abada.engine.api;

import com.abada.engine.core.EventManager;
import com.abada.engine.core.IdempotencyService;
import com.abada.engine.dto.MessageEventRequest;
import com.abada.engine.dto.SignalEventRequest;
import com.abada.engine.project.ProjectConstants;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestHeader;
import java.util.Map;

@RestController
@RequestMapping("/v1/events")
public class EventController {

    private final EventManager eventManager;
    private final IdempotencyService idempotency;

    public EventController(EventManager eventManager, IdempotencyService idempotency) {
        this.eventManager = eventManager;
        this.idempotency = idempotency;
    }

    /**
     * Correlates a message event to a waiting process instance.
     */
    @PostMapping("/messages")
    public ResponseEntity<Void> correlateMessage(@RequestBody MessageEventRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        idempotency.execute(idempotencyKey, "event.message", request, () -> {
            eventManager.correlateMessage(ProjectConstants.DEFAULT_PROJECT_ID,
                    request.messageName(), request.correlationKey(), request.variables());
            return Map.of("status", "Accepted");
        });
        return ResponseEntity.accepted().build();
    }

    /**
     * Broadcasts a signal event to all waiting process instances.
     */
    @PostMapping("/signals")
    public ResponseEntity<Void> broadcastSignal(@RequestBody SignalEventRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        idempotency.execute(idempotencyKey, "event.signal", request, () -> {
            eventManager.broadcastSignal(ProjectConstants.DEFAULT_PROJECT_ID,
                    request.signalName(), request.variables());
            return Map.of("status", "Accepted");
        });
        return ResponseEntity.accepted().build();
    }
}
