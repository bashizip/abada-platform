package com.abada.engine.observability;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

import java.net.URI;

/**
 * Reports telemetry configuration independently from workflow readiness.
 *
 * Export is deliberately best-effort: this indicator never probes or gates on
 * a remote collector, so an observability outage cannot make the engine
 * unavailable or roll back a workflow command.
 */
@Component("telemetryExportHealthIndicator")
public class TelemetryExportHealthIndicator implements HealthIndicator {

    private final boolean enabled;
    private final String endpoint;

    public TelemetryExportHealthIndicator(
            @Value("${abada.telemetry.enabled:false}") boolean enabled,
            @Value("${abada.telemetry.otlp.endpoint:}") String endpoint) {
        this.enabled = enabled;
        this.endpoint = endpoint;
    }

    @Override
    public Health health() {
        Health.Builder health = Health.up()
                .withDetail("enabled", enabled)
                .withDetail("readinessDependency", false);
        if (enabled) {
            health.withDetail("mode", "best-effort-otlp")
                    .withDetail("endpointHost", endpointHost(endpoint));
        } else {
            health.withDetail("mode", "disabled");
        }
        return health.build();
    }

    private static String endpointHost(String value) {
        try {
            return URI.create(value).getHost();
        } catch (IllegalArgumentException exception) {
            return "invalid";
        }
    }
}
