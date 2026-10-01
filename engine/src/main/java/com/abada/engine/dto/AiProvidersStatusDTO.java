package com.abada.engine.dto;

import java.util.List;

/**
 * Whether the given agent models can run: {@code unconfiguredModels} lists the
 * requested models no provider serves. Safe for any authenticated user.
 */
public record AiProvidersStatusDTO(
        boolean configured,
        List<String> unconfiguredModels,
        String insightProviderId,
        String insightModel) {
}
