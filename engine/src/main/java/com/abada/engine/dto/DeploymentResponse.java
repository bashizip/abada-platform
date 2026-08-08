package com.abada.engine.dto;

import java.util.List;
import java.util.Map;

public record DeploymentResponse(
        String status,
        String processDefinitionId,
        String deploymentId,
        int version,
        String definitionFormatVersion,
        String schemaType,
        List<String> compatibilityProfiles,
        Map<String, Object> compatibilityReport) {
}
