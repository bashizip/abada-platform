package com.abada.engine.config;

import io.micrometer.registry.otlp.OtlpConfig;
import io.micrometer.registry.otlp.OtlpMeterRegistry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.propagation.ContextPropagators;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.sdk.trace.samplers.Sampler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import java.time.Duration;
import java.net.URI;

/** Configures bounded OTLP export or safe no-op telemetry. */
@Configuration
public class ObservabilityConfig {

    @Bean
    @Primary
    @ConditionalOnProperty(name = "abada.telemetry.enabled", havingValue = "false", matchIfMissing = true)
    OpenTelemetry disabledOpenTelemetry() {
        return OpenTelemetry.noop();
    }

    @Bean(destroyMethod = "close")
    @Primary
    @ConditionalOnProperty(name = "abada.telemetry.enabled", havingValue = "true")
    OpenTelemetrySdk enabledOpenTelemetry(
            @Value("${spring.application.version:1.0.0-rc.1}") String appVersion,
            @Value("${app.project:abada}") String project,
            @Value("${spring.application.name:abada-engine}") String serviceName,
            @Value("${abada.telemetry.environment:${spring.profiles.active:default}}") String environment,
            @Value("${management.tracing.sampling.probability:0.1}") double samplingProbability,
            @Value("${abada.telemetry.otlp.endpoint:}") String otlpEndpoint) {
        String endpoint = requireEndpoint(otlpEndpoint);
        Resource resource = Resource.getDefault().merge(Resource.create(Attributes.builder()
                .put("service.name", serviceName)
                .put("service.version", appVersion)
                .put("deployment.environment", environment)
                .put("service.namespace", "abada")
                .put("project", project)
                .build()));

        var spanExporter = io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter.builder()
                .setEndpoint(endpoint + "/v1/traces")
                .setTimeout(Duration.ofSeconds(5))
                .build();
        var spanProcessor = BatchSpanProcessor.builder(spanExporter)
                .setMaxQueueSize(2048)
                .setMaxExportBatchSize(512)
                .setScheduleDelay(Duration.ofSeconds(2))
                .setExporterTimeout(Duration.ofSeconds(5))
                .build();
        SdkTracerProvider tracerProvider = SdkTracerProvider.builder()
                .setResource(resource)
                .setSampler(Sampler.traceIdRatioBased(samplingProbability))
                .addSpanProcessor(spanProcessor)
                .build();

        return OpenTelemetrySdk.builder()
                .setTracerProvider(tracerProvider)
                .setPropagators(ContextPropagators.create(W3CTraceContextPropagator.getInstance()))
                .build();
    }

    @Bean
    Tracer tracer(OpenTelemetry openTelemetry,
            @Value("${spring.application.name:abada-engine}") String serviceName,
            @Value("${spring.application.version:1.0.0-rc.1}") String appVersion) {
        return openTelemetry.getTracer(serviceName, appVersion);
    }

    @Bean(destroyMethod = "close")
    @ConditionalOnProperty(name = "abada.telemetry.enabled", havingValue = "true")
    OtlpMeterRegistry otlpMeterRegistry(
            @Value("${abada.telemetry.otlp.endpoint:}") String otlpEndpoint,
            @Value("${management.otlp.metrics.export.step:10s}") String configuredStep,
            @Value("${spring.application.version:1.0.0-rc.1}") String appVersion,
            @Value("${app.project:abada}") String project,
            @Value("${spring.application.name:abada-engine}") String serviceName,
            @Value("${abada.telemetry.environment:${spring.profiles.active:default}}") String environment) {
        String metricsUrl = requireEndpoint(otlpEndpoint) + "/v1/metrics";
        Duration step = parseDuration(configuredStep);
        OtlpConfig config = new OtlpConfig() {
            @Override
            public String get(String key) {
                return "url".equals(key) || "otlp.url".equals(key) ? metricsUrl : null;
            }

            @Override
            public Duration step() {
                return step;
            }

            @Override
            public java.util.Map<String, String> resourceAttributes() {
                return java.util.Map.of(
                        "service.name", serviceName,
                        "service.version", appVersion,
                        "service.namespace", "abada",
                        "deployment.environment", environment,
                        "project", project);
            }

            @Override
            public io.micrometer.registry.otlp.HistogramFlavor histogramFlavor() {
                return io.micrometer.registry.otlp.HistogramFlavor.EXPLICIT_BUCKET_HISTOGRAM;
            }
        };
        return new OtlpMeterRegistry(config, io.micrometer.core.instrument.Clock.SYSTEM);
    }

    private static String requireEndpoint(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                    "ABADA_TELEMETRY_OTLP_ENDPOINT is required when ABADA_TELEMETRY_ENABLED=true");
        }
        String endpoint = value.replaceAll("/+$", "");
        URI uri;
        try {
            uri = URI.create(endpoint);
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("ABADA_TELEMETRY_OTLP_ENDPOINT must be a valid HTTP(S) URL", exception);
        }
        if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                || uri.getHost() == null) {
            throw new IllegalStateException("ABADA_TELEMETRY_OTLP_ENDPOINT must be a valid HTTP(S) URL");
        }
        return endpoint;
    }

    private static Duration parseDuration(String value) {
        if (value == null || value.isBlank()) {
            return Duration.ofSeconds(10);
        }
        String normalized = value.trim().toLowerCase(java.util.Locale.ROOT);
        if (normalized.endsWith("ms")) {
            return Duration.ofMillis(Long.parseLong(normalized.substring(0, normalized.length() - 2)));
        }
        if (normalized.endsWith("s")) {
            return Duration.ofSeconds(Long.parseLong(normalized.substring(0, normalized.length() - 1)));
        }
        return Duration.parse(value);
    }
}
