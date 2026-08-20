package com.abada.engine.dto;

import java.util.List;
import com.abada.engine.core.model.assignment.AssignmentStrategy;

public record UserTaskPayload(
        String taskDefinitionKey,
        String name,
        String assignee,
        List<String> candidateUsers,
        List<String> candidateGroups,
        String formKey,
        AssignmentStrategy assignmentStrategy
) {}
