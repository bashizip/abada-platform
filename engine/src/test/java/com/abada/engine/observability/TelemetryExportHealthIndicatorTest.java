package com.abada.engine.observability;

import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Status;

import static org.assertj.core.api.Assertions.assertThat;

class TelemetryExportHealthIndicatorTest {

    @Test
    void disabledTelemetryIsHealthyAndDoesNotGateReadiness() {
        var health = new TelemetryExportHealthIndicator(false, "").health();

        assertThat(health.getStatus()).isEqualTo(Status.UP);
        assertThat(health.getDetails()).containsEntry("mode", "disabled")
                .containsEntry("readinessDependency", false);
    }

    @Test
    void enabledTelemetryRemainsBestEffort() {
        var health = new TelemetryExportHealthIndicator(true, "http://collector:4318").health();

        assertThat(health.getStatus()).isEqualTo(Status.UP);
        assertThat(health.getDetails()).containsEntry("mode", "best-effort-otlp")
                .containsEntry("endpointHost", "collector")
                .containsEntry("readinessDependency", false);
    }
}
