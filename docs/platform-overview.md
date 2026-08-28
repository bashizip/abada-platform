# Abada platform overview

Abada combines a durable PostgreSQL-backed BPMN engine with Studio, the single
operator UI for agentic workflow authoring, human tasks, operational inspection
and live runs. See the
[Studio application specification](development/studio-app-spec.md) for the
authoring pipeline (APL → BPMN → engine) and live Run panel. The supported deployment family is
defined by `compose.yaml`, a development or production profile, and an
optional telemetry overlay.

## Studio as the consolidated UI surface

**Studio is the only operator UI shipped in supported deployments.** The
Studio shell bundles four feature panels:

- **TaskInbox** — human task list, claim/unclaim/complete, the formerly-Tenda
  capability reachable from the same SPA.
- **Operations** — instance / variable / incident view and worker health, the
  formerly-Orun capability. Accepts an optional `projectId`; when omitted, the
  panel auto-selects an active project and surfaces a project picker.
- **Administration** — IdP and project administration (users, groups,
  projects), gated on the `abada-admin` JWT group claim.
- **Insight** — proposal review pipeline (approve, reject, comment).

Tenda and Orun remain in the repository as reference front-ends only. They are
**not built, published, or started by any supported Compose profile or release
image set**. See
[`studio-app-spec.md`](development/studio-app-spec.md) for the consolidation
rationale and the deferred surface area (audit trail UI, multi-tenant
project picker polish).

## Backstage

Development includes local Keycloak and HTTP routing. Production uses exact
versioned images, TLS and an external OIDC provider. Telemetry is disabled by
default; the optional stack includes OpenTelemetry Collector, Prometheus,
Jaeger, Loki, Grafana Alloy and Grafana. Consul is not part of the supported
platform.

Start with the [user guide](../documentation/src/content/docs/user/index.mdx),
then use the [architecture overview](architecture/overview.md),
[deployment matrix](reference/deployment-support.md) and
[roadmap](development/roadmap-to-1.0.md) as the detailed boundaries.
