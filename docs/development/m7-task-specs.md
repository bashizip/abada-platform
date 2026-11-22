# M7 task specifications — Cloud and Kubernetes native

The tasks of milestone M7. The roadmap lists them; this file holds what each
one means. C1–C3 ship in a 1.2.x release (new capability, consistent with the
M5 scope freeze); C4–C8 ship in 1.3.0. Dates are set when 1.2.0 ships.

---

## Why M7

Abada's promise is sovereignty: it runs on infrastructure the customer
controls. For many regulated organisations that infrastructure is no longer a
VM but a Kubernetes cluster, on premises (OpenShift, Rancher, plain upstream)
or in a public cloud (GKE, EKS, AKS), with managed PostgreSQL and object
storage. Today Abada certifies only Docker Compose, which keeps it out of
those organisations' platform teams.

M7 adds a second distribution of the same product. It does not replace the
first.

| | Self-hosted (unchanged) | Kubernetes / cloud-native (new) |
| --- | --- | --- |
| Install | Installer or release Compose bundle | Helm chart (`charts/abada`) |
| Database | PostgreSQL in the stack or the customer's own | Customer's PostgreSQL: self-run, Cloud SQL or RDS |
| Files | RustFS in the stack | RustFS, any S3-compatible endpoint, AWS S3 or GCP Cloud Storage |
| Identity | Bundled Keycloak (server profile) or the customer's OIDC | The customer's OIDC provider |
| Secrets | `.env` file | Kubernetes Secrets or External Secrets Operator |
| Scale | One VM, one or more engine instances | Autoscaled engine and worker pods |

## Guardrails (apply to every task)

1. **The self-hosted stack is not touched.** `compose*.yaml`, `release/`, the
   installer and the RustFS defaults are not modified by M7 work. If a task
   seems to need a Compose change, it is split out and reviewed on its own.
2. **One product.** Both distributions run the same release images, the same
   Flyway migrations and the same API. No feature exists in one distribution
   only; there is no cloud edition.
3. **Opt-in adapters.** Cloud-specific code (S3, GCS, IAM database auth) is
   off by default and selected by configuration. A self-hosted installation
   gains no new required dependency and loads no cloud SDK it does not use.
4. **Nothing new contacts us.** Cloud mode reaches only the services the
   operator configures. The privacy page lists any new outbound call.
5. **Runtime invariants unchanged.** The model still runs outside the
   transaction; no object-store call inside a workflow-state transaction;
   PostgreSQL stays authoritative.
6. **Two gates.** The Compose release gate keeps running unchanged; C3 adds a
   Kubernetes gate next to it. A release needs both.

Hosted Abada Cloud (SaaS: multi-tenancy, billing, operated by us) is out of
scope here; it is M8 ([`m8-task-specs.md`](m8-task-specs.md)) and builds on
this milestone.

---

## C1 — Helm chart

**Goal.** One chart installs Abada on any conformant Kubernetes cluster
(1.29 or newer) with production defaults.

**Contents.**
- Engine: Deployment, Service, HorizontalPodAutoscaler (CPU and an optional
  custom metric on pending work), PodDisruptionBudget (`minAvailable: 1` when
  replicas > 1), topology spread across zones.
- Studio: Deployment and Service; runtime configuration (API URL, OIDC
  client, issuer) from values, no image rebuild.
- Agent worker: Deployment with its own autoscaler; model-provider keys from
  a Secret.
- Ingress (class configurable) or Gateway API `HTTPRoute`, TLS from
  cert-manager or an existing Secret.
- NetworkPolicy: the engine accepts traffic only from Studio, the ingress
  and the workers; egress limited to PostgreSQL, the object store, the OIDC
  issuer and the configured model and MCP endpoints.
- Security: non-root, read-only root filesystem, dropped capabilities,
  `seccompProfile: RuntimeDefault`, a dedicated ServiceAccount per component
  with token automount off unless workload identity needs it.
- Configuration: every credential through `existingSecret` references;
  `values.schema.json` rejects an invalid configuration at install time.
- Dependencies: PostgreSQL and OIDC are external and required. RustFS can
  be enabled as an in-cluster StatefulSet for on-premises clusters; otherwise
  an external object store is configured. No database subchart in production
  values.
- Profiles: `values-onprem.yaml`, `values-gke.yaml`, `values-eks.yaml`, and
  `values-dev.yaml` (in-cluster PostgreSQL and Keycloak for kind, never for
  production).

**Publication.** Chart published as an OCI artifact on
`ghcr.io/bashizip/charts/abada`, chart version and `appVersion` equal to the
release version. `k8s/base` is removed in the same change and its README
points to the chart.

**Acceptance tests.**
- `helm lint` and `helm template` pass for every values profile.
- The schema rejects a missing issuer, a missing database Secret and a
  plain-text password in values.
- `kubeconform` validates the rendered manifests.
- `helm install` on kind with `values-dev.yaml` reaches ready, and Studio
  sign-in works.

**Documentation.** New `docs/operations/kubernetes.md`; a *Install on
Kubernetes* page in the user guide; the deployment support matrix gains a
"Kubernetes (Helm)" row marked implemented, not certified, until C8.

---

## C2 — Engine on Kubernetes

**Goal.** The engine behaves correctly when Kubernetes starts, stops, scales
and replaces it.

**Work.**
- **Graceful shutdown.** On SIGTERM the pod becomes unready, stops acquiring
  work, finishes in-flight commands within
  `terminationGracePeriodSeconds`, and releases its leases so another pod
  picks them up at once instead of waiting for expiry. Spring graceful
  shutdown plus an explicit lease-release step.
- **Migrations as a Job.** A Helm `pre-install,pre-upgrade` hook Job runs
  Flyway with the engine image (`ABADA_MODE=migrate`); engine pods run with
  migration off and Hibernate `validate`. Compose keeps migrating on start.
- **No local state.** Remove the dependency on `/app/data` and `/app/logs`;
  logs go to stdout only in the Kubernetes profile. The pod runs with a
  read-only root filesystem and an `emptyDir` for `/tmp`.
- **Schedulers.** Audit every `@Scheduled` job for N replicas. File sweep,
  insight and job scheduling are already lease-guarded; model discovery and
  the price catalog must be lease-guarded or proven idempotent and cheap.
- **Probes.** Startup probe for slow first starts; readiness keeps
  `db` and `objectStore`; liveness never depends on an external system.

**Acceptance tests (PostgreSQL Testcontainers and kind).**
- Three replicas, 50 agent tasks in flight, one pod deleted: every task
  completes once, no duplicate model call, no lease waits for expiry.
- Rolling upgrade from the previous chart version with work in flight: no
  failed command, no duplicate state transition.
- The migration Job runs once per upgrade; a pod started before the Job
  finishes stays unready instead of failing schema validation in a loop.
- Each scheduler runs its body once per period with three replicas.

**Documentation.** `runtime-semantics.md` (shutdown and lease release),
`runtime-state.md` (migration ownership per distribution).

---

## C3 — Kubernetes gate in CI

**Goal.** Every release candidate proves the chart, not only the Compose
stack.

**Work.** A GitHub Actions workflow that, for each candidate: lints and
renders the chart for every profile; creates a kind cluster; installs the
candidate images with `values-dev.yaml`; runs the existing release end-to-end
test against the cluster's ingress; runs the C2 pod-kill and rolling-upgrade
scenarios; uploads the results as a gate artifact.
`1.0-rc-publication-gates.md` gains a Kubernetes section; the Compose gate is
unchanged.

**Acceptance.** The workflow fails when the chart is broken, when the
end-to-end test fails on Kubernetes, or when a scenario produces a duplicate
transition, and passes on the 1.2.x candidate.

---

## C4 — Cloud object stores

**Goal.** Process files can live in AWS S3 or GCP Cloud Storage as well as in
RustFS.

**Work.** Two implementations of the existing `ObjectStore` interface,
selected by `ABADA_FILES_STORE=rustfs|s3|gcs` (default `rustfs`):
- `s3`: AWS SDK v2; any S3-compatible endpoint; SSE-S3 or SSE-KMS required
  (the readiness check refuses an unencrypted bucket as it does for RustFS);
  credentials from IRSA / EKS Pod Identity or a Secret.
- `gcs`: native Google Cloud Storage client; CMEK or Google-managed
  encryption; credentials from GKE Workload Identity or a Secret. Decide at the
  start of the task whether the native client is worth it over GCS's S3
  interoperability mode with HMAC keys; record the decision.

The cloud SDKs are optional dependencies loaded only when selected; the
self-hosted image size and start-up do not regress.

**Acceptance tests.** The existing object-store contract suite runs against
RustFS, LocalStack (S3) and the GCS emulator; upload, attach, download
through the worker lease, sweep and orphan cleanup behave identically; an
unencrypted bucket fails readiness; no object call inside a workflow-state
transaction.

**Documentation.** `process-files.md` (store choice, encryption, backup per
store).

---

## C5 — Managed PostgreSQL

**Goal.** Certify the two managed databases customers ask for first.

**Work.**
- Cloud SQL for PostgreSQL (via the Cloud SQL Auth Proxy sidecar or private
  IP) and Amazon RDS for PostgreSQL, on the PostgreSQL versions Abada
  supports.
- PgBouncer: run the concurrent-acquisition and lease-recovery suites behind
  PgBouncer in transaction mode. If advisory or session-level locks break,
  either make them transaction-scoped or document "session mode required".
- Optional IAM database authentication (Cloud SQL IAM, RDS IAM) behind a
  configuration switch.

**Acceptance.** The 0.10 concurrency, failover and duplicate-request suites
pass against each managed database from the reference cluster; the PgBouncer
result is recorded either way.

**Documentation.** Deployment support matrix rows; `kubernetes.md` database
section.

---

## C6 — Identity and secrets

**Goal.** Abada signs users in with the identity providers cloud customers
already run, and never needs a secret in chart values.

**Work.**
- Certify OIDC with Microsoft Entra ID, Amazon Cognito and Google Identity
  Platform: issuer discovery, role or group claims mapped to Abada roles,
  token refresh in Studio. Keycloak remains the reference provider.
- Support External Secrets Operator: the chart can render `ExternalSecret`
  objects for GCP Secret Manager, AWS Secrets Manager and Vault.

**Acceptance.** Per provider: sign-in, role mapping, expired and
wrong-audience tokens rejected (the negative tests required by `AGENTS.md`).
A rendered chart with ESO enabled contains no secret value.

**Documentation.** One configuration page per provider.

---

## C7 — Observability on Kubernetes

**Goal.** Platform teams see Abada in the monitoring they already run.

**Work.** Optional `ServiceMonitor` and `PodMonitor` for the Prometheus
Operator; OTLP export to a cluster collector (endpoint in values); the
bundled Grafana dashboards packaged as an optional ConfigMap with the
sidecar label. Telemetry stays off by default.

**Acceptance.** On kind with kube-prometheus-stack, engine and worker metrics
are scraped and the dashboards load; with telemetry off nothing is exported.

---

## C8 — Supply chain and certification

**Goal.** Turn "implemented" into "certified" for the Kubernetes
distribution, with the evidence regulated buyers ask for.

**Work.**
- Images and chart signed with cosign (keyless, GitHub OIDC); SBOM (SPDX)
  attached to every image; verification commands in the docs.
- A GKE Autopilot reference cluster (Cloud SQL, GCS, Workload Identity)
  running the C3 gate for each 1.3.0 candidate.
- Deployment support matrix: Kubernetes rows (on-premises/kind, GKE with
  Cloud SQL and GCS, EKS with RDS and S3 if C5 RDS is not cut) moved to
  certified only with recorded evidence.
- Migration guide from a Compose installation to Kubernetes: PostgreSQL dump
  and restore or replication, RustFS to S3/GCS object copy with sha256
  verification, cut-over checklist.
- 1.3.0 release notes and gate report.

**Acceptance.** `cosign verify` succeeds for every published image and the
chart; the reference cluster passes the gate; the migration guide is executed
once end to end from the public demo VM's data to the reference cluster.

---

## Exit demo

The same release images are installed with Compose on a VM and with the Helm
chart on kind and on GKE Autopilot. The same end-to-end test passes on all
three. An engine pod is killed while an agent task is running; another pod
finishes the work with no duplicate model call, and the audit trail shows it.
The Compose stack and the installer needed no change.
