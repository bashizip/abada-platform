package com.abada.engine.dto;

import java.util.List;

/**
 * Whether the given agent models can run: {@code unconfiguredModels} lists the
 * requested models no provider serves. {@code insightProviderId} and
 * {@code insightModel} are what Insight, authoring and new agent nodes use;
 * {@code requestedInsightProviderId} is the default chosen in Studio and
 * {@code insightFallback} is true when that choice cannot run (for example no
 * key) and another provider stands in. Safe for any authenticated user.
 */
public record AiProvidersStatusDTO(
        boolean configured,
        List<String> unconfiguredModels,
        String insightProviderId,
        String insightModel,
        String requestedInsightProviderId,
        boolean insightFallback) {
}
