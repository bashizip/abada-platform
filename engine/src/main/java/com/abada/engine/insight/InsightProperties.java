package com.abada.engine.insight;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Insight Loop tuning knobs. The worker is opt-in: it never runs unless
 * {@code abada.insight.enabled=true} (default off), matching the
 * out-of-band posture of the ADR-003 pipeline. Thresholds are global v1
 * defaults; definition-specific baselines evolve over completed windows.
 */
@Component
public class InsightProperties {

    @Value("${abada.insight.enabled:false}")
    private boolean enabled;

    @Value("${abada.insight.worker-id:insight-1}")
    private String workerId;

    @Value("${abada.insight.interval-ms:600000}")
    private long intervalMs;

    @Value("${abada.insight.drift-seconds:60}")
    private long driftSeconds;

    @Value("${abada.insight.lease-seconds:60}")
    private long leaseSeconds;

    @Value("${abada.insight.initial-lookback-hours:24}")
    private long initialLookbackHours;

    @Value("${abada.insight.min-attempts:5}")
    private int minAttempts;

    @Value("${abada.insight.min-fallback-samples:8}")
    private int minFallbackSamples;

    @Value("${abada.insight.failure-rate-threshold:0.15}")
    private double failureRateThreshold;

    @Value("${abada.insight.fallback-ratio-threshold:0.5}")
    private double fallbackRatioThreshold;

    @Value("${abada.insight.latency-factor:2.0}")
    private double latencyFactor;

    @Value("${abada.insight.llm.base-url:${ABADA_LLM_BASE_URL:}}")
    private String llmBaseUrl;

    @Value("${abada.insight.llm.api-key:${ABADA_LLM_API_KEY:}}")
    private String llmApiKey;

    @Value("${abada.insight.llm.model:${ABADA_LLM_MODEL:gemini-3.6-flash}}")
    private String llmModel;

    @Value("${abada.insight.llm.timeout-ms:30000}")
    private long llmTimeoutMs;

    @Value("${abada.insight.llm.provider-type:openai-compatible}")
    private String llmProviderType;

    @Value("${abada.insight.llm.openrouter.enabled:${ABADA_LLM_OPENROUTER_ENABLED:true}}")
    private boolean openRouterEnabled;

    @Value("${abada.insight.llm.openrouter.referer:https://studio.localhost}")
    private String openRouterReferer;

    @Value("${abada.insight.llm.openrouter.title:Abada Studio}")
    private String openRouterTitle;

    public boolean isEnabled() {
        return enabled;
    }

    public String getWorkerId() {
        return workerId;
    }

    public Duration getInterval() {
        return Duration.ofMillis(intervalMs);
    }

    public Duration getDrift() {
        return Duration.ofSeconds(driftSeconds);
    }

    public Duration getLease() {
        return Duration.ofSeconds(leaseSeconds);
    }

    public Duration getInitialLookback() {
        return Duration.ofHours(initialLookbackHours);
    }

    public int getMinAttempts() {
        return minAttempts;
    }

    public int getMinFallbackSamples() {
        return minFallbackSamples;
    }

    public double getFailureRateThreshold() {
        return failureRateThreshold;
    }

    public double getFallbackRatioThreshold() {
        return fallbackRatioThreshold;
    }

    public double getLatencyFactor() {
        return latencyFactor;
    }

    public String getLlmBaseUrl() {
        return llmBaseUrl;
    }

    public String getLlmApiKey() {
        return llmApiKey;
    }

    public String getLlmModel() {
        return llmModel;
    }

    public Duration getLlmTimeout() {
        return Duration.ofMillis(llmTimeoutMs);
    }

    public String getLlmProviderType() {
        return llmProviderType;
    }

    public boolean isOpenRouterEnabled() {
        return openRouterEnabled;
    }

    public String getOpenRouterReferer() {
        return openRouterReferer;
    }

    public String getOpenRouterTitle() {
        return openRouterTitle;
    }

    /** True when the OpenAI-compatible endpoint is configured and usable. */
    public boolean isLlmConfigured() {
        return llmBaseUrl != null && !llmBaseUrl.isBlank()
                && llmApiKey != null && !llmApiKey.isBlank();
    }
}