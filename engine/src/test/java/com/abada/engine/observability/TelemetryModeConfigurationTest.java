package com.abada.engine.observability;

import com.abada.engine.config.ObservabilityConfig;
import io.micrometer.registry.otlp.OtlpMeterRegistry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

class TelemetryModeConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(ObservabilityConfig.class);

    @Test
    void telemetryIsNoopByDefaultAndCreatesNoExporterRegistry() {
        contextRunner.run(context -> {
            assertThat(context).hasSingleBean(OpenTelemetry.class);
            assertThat(context).hasSingleBean(io.opentelemetry.api.trace.Tracer.class);
            assertThat(context).doesNotHaveBean(OtlpMeterRegistry.class);
            assertThat(context.getBean(OpenTelemetry.class)).isNotInstanceOf(OpenTelemetrySdk.class);
        });
    }

    @Test
    void enabledTelemetryRequiresAnExplicitOtlpEndpoint() {
        contextRunner.withPropertyValues("abada.telemetry.enabled=true")
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void enabledTelemetryRejectsMalformedOtlpEndpoint() {
        contextRunner.withPropertyValues(
                "abada.telemetry.enabled=true",
                "abada.telemetry.otlp.endpoint=collector:4318")
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void enabledTelemetryCreatesBoundedOtlpTracingAndMetrics() {
        contextRunner.withPropertyValues(
                "abada.telemetry.enabled=true",
                "abada.telemetry.otlp.endpoint=http://127.0.0.1:4318",
                "management.tracing.sampling.probability=0.0")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(OpenTelemetry.class);
                    assertThat(context.getBean(OpenTelemetry.class)).isInstanceOf(OpenTelemetrySdk.class);
                    assertThat(context).hasSingleBean(OtlpMeterRegistry.class);
                });
    }
}
