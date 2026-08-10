package com.abada.engine.api;

import com.abada.engine.dto.ProjectTreeNodeDTO;
import com.abada.engine.project.ProjectTreeService;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/projects/{projectId}/tree")
public class ProjectTreeController {
    private final ProjectTreeService trees;

    public ProjectTreeController(ProjectTreeService trees) { this.trees = trees; }

    @GetMapping
    public ResponseEntity<List<ProjectTreeNodeDTO>> tree(@PathVariable String projectId) {
        return ResponseEntity.ok(trees.tree(projectId));
    }
}