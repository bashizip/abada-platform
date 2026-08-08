package com.abada.engine.api;

import com.abada.engine.core.EventManager;
import com.abada.engine.dto.MessageEventRequest;
import com.abada.engine.dto.SignalEventRequest;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.project.ProjectAccessService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/projects/{projectId}/events")
public class ProjectEventController {
    private final EventManager events;
    private final ProjectAccessService access;

    public ProjectEventController(EventManager events, ProjectAccessService access) {
        this.events = events;
        this.access = access;
    }

    @PostMapping("/messages")
    public ResponseEntity<Void> message(@PathVariable String projectId,
            @RequestBody MessageEventRequest request) {
        // Existing instances may consume events after their project is archived.
        access.require(projectId, Role.OPERATOR, Role.OWNER);
        events.correlateMessage(projectId, request.messageName(), request.correlationKey(),
                request.variables());
        return ResponseEntity.accepted().build();
    }

    @PostMapping("/signals")
    public ResponseEntity<Void> signal(@PathVariable String projectId,
            @RequestBody SignalEventRequest request) {
        access.require(projectId, Role.OPERATOR, Role.OWNER);
        events.broadcastSignal(projectId, request.signalName(), request.variables());
        return ResponseEntity.accepted().build();
    }
}
