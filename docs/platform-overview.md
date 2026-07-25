# Abada platform overview

Abada combines a durable PostgreSQL-backed BPMN engine with Tenda for human
tasks and Orun for operational inspection. The supported deployment family is
defined by `compose.yaml`, a development or production profile, and an
optional telemetry overlay.

Development includes local Keycloak and HTTP routing. Production uses exact
versioned images, TLS and an external OIDC provider. Telemetry is disabled by
default; the optional stack includes OpenTelemetry Collector, Prometheus,
Jaeger, Loki, Promtail and Grafana. Consul is not part of the supported
platform.

Start with the [user guide](../documentation/src/content/docs/user/index.mdx),
then use the [architecture overview](architecture/overview.md),
[deployment matrix](reference/deployment-support.md) and
[roadmap](development/roadmap-to-1.0.md) as the detailed boundaries.
