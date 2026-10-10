package com.abada.engine.api;

import com.abada.engine.tools.ToolCredentialService;
import com.abada.engine.tools.ToolCredentialService.CredentialSummary;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Secrets named by a project's tool server documents. Write-only: responses
 * carry the name and a hint, never the value.
 */
@RestController
@RequestMapping("/v1/projects/{projectId}/tool-credentials")
public class ToolCredentialController {
    public record SaveToolCredentialRequest(String secret) {
        @Override
        public String toString() {
            return "SaveToolCredentialRequest[secret=****]";
        }
    }

    private final ToolCredentialService credentials;

    public ToolCredentialController(ToolCredentialService credentials) {
        this.credentials = credentials;
    }

    @GetMapping
    public List<CredentialSummary> list(@PathVariable String projectId) {
        return credentials.list(projectId);
    }

    @PutMapping("/{name}")
    public CredentialSummary save(@PathVariable String projectId, @PathVariable String name,
            @RequestBody SaveToolCredentialRequest request) {
        return credentials.save(projectId, name, request == null ? null : request.secret());
    }

    @DeleteMapping("/{name}")
    public ResponseEntity<Void> delete(@PathVariable String projectId, @PathVariable String name) {
        credentials.delete(projectId, name);
        return ResponseEntity.noContent().build();
    }
}
