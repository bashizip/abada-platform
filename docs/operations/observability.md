# Optional telemetry operations

Telemetry is diagnostic and is never part of a workflow-state transaction.
`ABADA_TELEMETRY_ENABLED=false` and `OTEL_SDK_DISABLED=true` are the defaults.
In that mode the engine registers a no-op `Tracer`, creates no OTLP exporters,
makes no collector connection attempt and has no collector readiness
dependency. Structured container logs and rolling JSON files remain available.

## Bundled telemetry

Add `compose.telemetry.yaml` after either supported profile:

```bash
docker compose -f compose.yaml -f compose.dev.yaml \
  -f compose.telemetry.yaml up -d
```

The overlay contains pinned versions of OpenTelemetry Collector, Prometheus,
Jaeger, Loki, Promtail and Grafana. It removes the former Consul dependency.
Promtail reads the named `engine_logs` volume; it has neither a repository log
mount nor Docker socket access. Grafana datasources and dashboards are
provisioned from `docker/grafana/` and Grafana is bound to loopback by default.
The internal `telemetry-health` probe verifies the Collector, Jaeger,
Prometheus, Loki, Promtail and Grafana readiness endpoints; it is diagnostic
and is not a dependency of engine readiness.

The RC bundle retains Promtail to satisfy the 1.0-RC compatibility contract.
Promtail reached upstream end of life on 2026-03-02, so replacing it with
[Grafana Alloy](https://grafana.com/docs/loki/latest/send-data/alloy/) is a
post-RC maintenance item rather than a silent change to this release profile.

Trace export uses a 2,048-span queue, 512-span batch, two-second schedule and
five-second timeout. OTLP metrics use bounded periodic publication. Logs carry
`traceId` and `spanId` MDC fields so Grafana can correlate Loki records with
Jaeger traces.

## External collector

Omit the telemetry overlay and configure:

```dotenv
ABADA_TELEMETRY_ENABLED=true
ABADA_TELEMETRY_OTLP_ENDPOINT=https://collector.example.net:4318
OTEL_SDK_DISABLED=false
```

Only HTTP(S) base URLs are accepted. The engine appends `/v1/traces` and
`/v1/metrics`. A missing or malformed endpoint fails startup when telemetry is
explicitly enabled.

## Health and failure semantics

- `/api/actuator/health/readiness` reports workflow readiness from application
  and database state; telemetry is excluded from this health group.
- `/api/actuator/health/telemetryExport` reports whether export is disabled or
  configured. It deliberately does not probe a collector and never gates
  readiness.
- The collector has its own container health check and the aggregate bundled
  stack has an independent `telemetry-health` check.
- Queue overflow or collector/backend failure may drop diagnostic data but
  cannot roll back a command or make the workflow engine unavailable.

Terminate the collector during the release smoke workflow and prove that a
user-task completion still commits. Restart it and verify correlated metrics,
traces and logs in Grafana within two minutes.
