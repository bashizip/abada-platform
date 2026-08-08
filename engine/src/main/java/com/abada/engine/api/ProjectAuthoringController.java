package com.abada.engine.api;

import com.abada.engine.authoring.AplAuthoringService;
import com.abada.engine.authoring.AplAuthoringService.Mode;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.project.ProjectAccessService;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/projects/{projectId}/authoring")
public class ProjectAuthoringController {
    public record GenerateAplRequest(String prompt, String mode, String baseAplSource) {}
    public record GenerateAplResponse(String aplSource, String provider, String model,
                                      int attempts, List<String> warnings) {}

    private final AplAuthoringService authoring;
    private final ProjectAccessService access;

    public ProjectAuthoringController(AplAuthoringService authoring, ProjectAccessService access) {
        this.authoring = authoring;
        this.access = access;
    }

    @PostMapping("/generate")
    public ResponseEntity<GenerateAplResponse> generate(@PathVariable String projectId,
            @RequestBody GenerateAplRequest request) {
        access.requireActive(projectId, Role.OWNER, Role.MAINTAINER);
        var membership = access.membership(projectId);
        if (membership == null || membership.getRoles().stream()
                .noneMatch(role -> role == Role.OWNER || role == Role.MAINTAINER)) {
            throw new ApiException(HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                    "Project OWNER or MAINTAINER membership is required for APL authoring");
        }
        if (request == null) throw invalid("Request body is required");
        Mode mode;
        try {
            mode = Mode.valueOf(request.mode() == null ? "" : request.mode().toUpperCase());
        } catch (IllegalArgumentException exception) {
            throw invalid("mode must be CREATE or REFINE");
        }
        try {
            var candidate = authoring.generate(projectId, mode, request.prompt(), request.baseAplSource());
            return ResponseEntity.ok(new GenerateAplResponse(candidate.aplSource(),
                    candidate.provider().name(), candidate.model(), candidate.attempts(), candidate.warnings()));
        } catch (IllegalArgumentException exception) {
            throw invalid(exception.getMessage());
        }
    }

    private ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, message);
    }
}
