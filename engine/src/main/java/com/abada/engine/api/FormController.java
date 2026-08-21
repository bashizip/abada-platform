package com.abada.engine.api;

import com.abada.engine.dto.ProjectResourceContentDTO;
import com.abada.engine.dto.ProjectResourceDTO;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.project.ProjectTreeService;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Project task forms: the FORM-kind project resources that human task nodes
 * reference through a logical {@code formKey}. A form key is a bare slug
 * (e.g. {@code loan-approval}) that resolves to {@code forms/loan-approval.json}.
 * Forms are live resources: task clients render the current revision.
 */
@RestController
@RequestMapping("/v1/projects/{projectId}/forms")
public class FormController {

    private final ProjectTreeService trees;

    public FormController(ProjectTreeService trees) {
        this.trees = trees;
    }

    @GetMapping
    public ResponseEntity<List<ProjectResourceDTO>> list(@PathVariable String projectId) {
        return ResponseEntity.ok(trees.listForms(projectId).stream()
                .map(ProjectResourceDTO::from).toList());
    }

    @GetMapping("/{formKey}")
    public ResponseEntity<ProjectResourceContentDTO> resolve(@PathVariable String projectId,
            @PathVariable String formKey) {
        ProjectResourceEntity form = trees.findFormByKey(projectId, formKey)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,
                        ApiErrorCode.RESOURCE_NOT_FOUND, "Form not found: " + formKey));
        return ResponseEntity.ok().eTag(Long.toString(form.getEntityVersion()))
                .body(ProjectResourceContentDTO.from(form));
    }
}
