# Abada Platform

**Durable agentic orchestration: APL-native authoring on a PostgreSQL
execution core.**

Abada is a modular, self-hosted workflow platform built with **Java 21** and
**Spring Boot 3**. Native `abada.io/v1` APL YAML and backward-compatible BPMN
definitions compile into the same durable runtime state machine for humans,
services, deterministic decisions, events, and AI-agent work.

Abada is designed around a simple principle: autonomous agents may reason and
act dynamically, but production workflows still require deterministic control
over state, sequencing, permissions, timeouts, approvals, recovery, and
observability.

The open-source platform includes:

- **Abada Studio** — the visual, APL-native authoring environment: diagram
  and YAML editing, local dry runs with animated tokens, governed AI
  optimization proposals, and live instance inspection with the engine-truthful
  taken path.
- **Abada Engine** — the durable PostgreSQL execution core that owns process,
  token, task, subscription, timer, job, variable, worker and Insight state.
- **Tenda** and **Orun** — human task and operations applications.
- **Agent worker** — a first-party Java sidecar that turns `abada:agent` nodes
  into durable, leased, retryable LLM calls.
- **Java worker SDK** — typed clients for service workers and the agent
  attempt/resume contract.
- A self-contained release bundle (`release/`) and optional telemetry overlay.

> **🚧 1.1 agentic checkpoint**
>
> The 1.1 roadmap work is present in this repository and progressing: native
> APL runtime, deterministic decision tables, the governed Insight Loop,
> project envelopes, and the first-party agent worker are implemented. The
> `1.0.0-rc.2` release line remains the certified production baseline until the
> remaining 1.1 agentic and infrastructure evidence closes. Progress is
> tracked in the
> [1.1 RC roadmap](docs/development/roadmap-to-1.1.0-rc.md).

📚 **Documentation**

- [Platform Overview](docs/platform-overview.md)
- [Architecture & Deployment Guide](docs/architecture/overview.md)
- [API Documentation](docs/development/api.md)
- [APL Specification](docs/reference/apl-specification.md)
- [Observability Guide](docs/operations/observability.md)
- [Release Notes](docs/release-notes/)

---

# Why Abada?

Large Language Models and AI agents are excellent at reasoning, selecting tools, and adapting to incomplete information.

Production systems, however, still require:

- deterministic execution
- durable state
- approvals and human oversight
- auditability
- retries and compensation
- event correlation
- observability
- operational safety

Abada provides that execution layer.

Rather than letting model calls own process state, Abada combines:

- **Agents reason**
- **Studio authors APL; the durable engine orchestrates**
- **Humans supervise**
- **Telemetry explains everything**

---

# Organic & Agentic Workflows

Abada introduces the concept of **Organic Workflows**.

An Organic Workflow is a business process where execution can naturally involve:

- Humans
- Services
- Events
- Business Rules
- AI Agents
- External Systems

Unlike rigid workflow engines, execution can evolve dynamically while remaining deterministic and fully observable.

Examples include:

- AI proposes → Human approves
- Human delegates → Agent executes
- Event triggers → Workflow continues
- Policy blocks → Human intervention
- Agent fails → Compensation path executes

PostgreSQL and the engine state machine remain authoritative while AI agents
participate through leased, retryable external work. Agents never advance
BPMN state outside engine commands: the versioned `abada.agent/v1` profile and
the agent worker keep model attempts, results and failures in the durable
worker and history contracts.

Agents also serve the platform itself through the **Insight Loop**: the engine
writes terminal execution facts transactionally to PostgreSQL, analyzes
non-overlapping windows without a streaming stack, and proposes governed APL
improvements that Studio presents for diff review. Proposals are approved by
policy lanes — never auto-applied.

---

# Optional observability

Telemetry export is disabled by default and never participates in workflow
correctness. Add the bundled overlay or point the engine at an external OTLP
collector when observability is required.

The engine emits **workflow-aware telemetry** using **OpenTelemetry**, allowing operators to follow execution from API request to BPMN activity, event correlation, task lifecycle, persistence layer, and infrastructure. Trace context is preserved across engine commands and agent execution.

## Features

- ✅ Native OpenTelemetry instrumentation
- ✅ Process-aware distributed tracing
- ✅ Metrics for workflows, tasks, events and jobs
- ✅ Full-stack trace correlation
- ✅ Centralized structured logging
- ✅ Grafana dashboards
- ✅ Jaeger distributed tracing
- ✅ Prometheus metrics
- ✅ Loki log aggregation

Current telemetry includes:

- Process instances started
- Process completion
- Process failures
- Process duration
- Task creation
- Task waiting time
- Task processing time
- Task completion
- Message correlation
- Signal broadcasting
- Job execution
- Job failures

Agent execution already keeps durable attempt, result and failure metadata in
the history contracts. Remaining telemetry items — tool-call spans, token
usage and decision latency metrics — land with the executable tool adapters.

See the [Observability Guide](docs/operations/observability.md).

---

# Platform Architecture

Abada is a modular monorepo.

| Component | Description |
|-----------|-------------|
| **engine/** | Durable APL/BPMN execution runtime with project envelopes, agent worker gateway and Insight Loop |
| **studio/** | APL-native visual and YAML authoring environment with dry runs and live run inspection |
| **tenda/** | Human task application |
| **orun/** | Operations & workflow-state application |
| **agent-worker/** | First-party Java `abada:agent` sidecar (multiprovider LLM gateway) |
| **sdk/java/** | Java external-worker SDK with agent attempt metadata |
| **documentation/** | Curated Starlight documentation site |
| **release/** | Self-contained versioned deployment bundle |

```
        Abada Studio ─── APL / BPMN documents
                 │
                 ▼
         Abada Engine Core (PostgreSQL-authoritative)
                 │
     ┌───────────┼───────────────┬────────────────┐
     ▼           ▼               ▼                ▼
  Humans      Services     AI Agents       Insight Loop
     │        (worker)    (agent worker)   (governed APL
     │           │            │            proposals)
     │           │            │                │
     └───────────┴────────────┴────────────────┘
                 │
                 ▼
   Policies • Tools • Models • APIs
                 │
                 ▼
   OpenTelemetry Execution Graph
```

Every public component is independently deployable using Docker.

For runtime topology, deployment strategies and system architecture, see the [Architecture Guide](docs/architecture/overview.md).

---

# Quick Start

## Clone and launch development

```bash
git clone https://github.com/bashizip/abada-engine.git
cd abada-engine
./release/abada-platform doctor dev
./release/abada-platform up dev
```

The success screen prints every local URL and the development-only starter
accounts: `alice` / `alice` in Tenda and Studio, `orun-admin` / `orun-admin`
in Orun, `admin` / `admin` in Keycloak.

Add `--telemetry` for the bundled Grafana, Prometheus, Jaeger, Loki, Grafana
Alloy and OpenTelemetry Collector stack.

## Versioned release bundle

```bash
curl -fsSLO https://raw.githubusercontent.com/bashizip/abada-engine/main/release/quickstart.sh
chmod +x quickstart.sh
./quickstart.sh 1.0.0-rc.2
```

Windows:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/bashizip/abada-engine/main/release/quickstart.ps1 -OutFile quickstart.ps1
.\quickstart.ps1 -Version 1.0.0-rc.2
```

The bundle is self-contained: it has no build contexts and does not require a
repository clone. See [`release/README.md`](release/README.md).

## Container platforms

Abada's release-image contract covers both `linux/amd64` and `linux/arm64`.
The publication workflow builds both variants and rejects an image tag unless
its manifest contains both platforms.

The original `1.0.0-rc.1` images predate that gate and contain only
`linux/amd64`. When the repository launcher detects those exact images on an
ARM64 Docker host, it prints a notice and uses Docker's `amd64` compatibility
mode. This keeps the published tag immutable while allowing Apple Silicon and
other ARM64 users to launch the release. Subsequent release images run
natively on both supported architectures.

---

# Development

Build the local Engine and Studio images, then start the full stack with local
images (no pulls from GHCR):

```bash
./scripts/dev/rebuild.sh           # build + restart engine + studio
./scripts/dev/up.sh                # start the full dev stack
```

Start the stack with the first-party agent worker enabled:

```bash
./scripts/dev/up.sh --agent
```

Validate the deployment without starting it:

```bash
./release/abada-platform doctor dev
```

Stop and wipe all data:

```bash
./scripts/dev/clean.sh
```

The development scripts under [`scripts/dev/`](scripts/dev/) cover:
- `up.sh` — start the dev stack (flags: `--agent`, `--telemetry`)
- `rebuild.sh` — rebuild and restart Engine + Studio (`--no-cache`)
- `clean.sh` — stop and remove all volumes (`-y`)
- `logs.sh` — tail logs for services
- `build-agent-worker.sh`, `provision-agent-worker.sh`

---

# Local Services

| Service | URL |
|---------|-----|
| Gateway | http://localhost |
| Engine API | http://api.localhost/api |
| Swagger | http://api.localhost/api/swagger-ui.html |
| Tenda | http://tenda.localhost |
| Orun | http://orun.localhost |
| Studio | http://studio.localhost |
| Keycloak | http://keycloak.localhost |
| Grafana (telemetry overlay) | http://127.0.0.1:3000 |

Development uses separate starter identities so task work and operational
access remain visibly distinct:

| Application | Username | Password | Purpose |
| --- | --- | --- | --- |
| Tenda / Studio | `alice` | `alice` | Deploy, start and complete workflow tasks; author and run APL |
| Orun | `orun-admin` | `orun-admin` | Inspect workflow history and operations |
| Keycloak admin | `admin` | `admin` | Manage the development realm |

If Tenda has already signed you in as Alice, Orun may reuse that Keycloak
session. Choose **Sign out and switch account**, then sign in as
`orun-admin`. These credentials are development-only.

---

# Current Status

## Certified baseline: `1.0.0-rc.2`

Abada 1.0 RC combines stable REST and external-worker contracts, direct OIDC
JWT validation, backend RBAC and a Java worker SDK with the durable,
cluster-safe PostgreSQL runtime.
Two or more replicas can contend safely for timers, external tasks, messages,
signals and user-task transitions. Public mutation retries can use
`Idempotency-Key` for a deterministic response.

`1.0.0-rc.2` is a published evaluation release candidate backed by the
validated Docker Compose distribution and PostgreSQL/Testcontainers evidence.
Public-cloud production certification is not claimed; that infrastructure
work is tracked in the
[1.1 RC roadmap](docs/development/roadmap-to-1.1.0-rc.md).

## 1.1 agentic checkpoint (in development)

The agentic loop is executable against the real engine: Studio dry runs
animate token paths locally, while live runs show only engine-reported
progress; the first-party agent worker persists model attempts through the
durable worker contract; and the governed Insight Loop proposes APL changes
that are reviewed lane by lane in Studio.

The BPMN execution core is operational, while APIs and platform capabilities continue to evolve.

## Implemented

- ✅ BPMN execution engine
- ✅ Native `abada.io/v1` APL parser, immutable definitions and deterministic decision tables
- ✅ Project envelopes: PostgreSQL-backed projects, folders, resources, file tree and role memberships
- ✅ Process persistence
- ✅ User, Service and Script Tasks
- ✅ Message and Signal Events
- ✅ Parallel and Exclusive Gateways
- ✅ REST APIs (global + project-scoped)
- ✅ PostgreSQL (H2 for local convenience)
- ✅ OpenTelemetry, Prometheus, Grafana, Jaeger, Loki
- ✅ Docker, Traefik, Keycloak Authentication
- ✅ Stable API v1 and worker protocol v1
- ✅ Java external-worker SDK
- ✅ OIDC JWT validation and backend RBAC
- ✅ Versioned `abada.agent/v1` profile and first-party Java agent sidecar
- ✅ Operator-defined agent model allow-list at deployment and authoring validation
- ✅ PostgreSQL-authoritative Insight Loop with governed Studio review
- ✅ Local dry-run simulation and live-instance path animation (engine-truthful)
- ✅ Studio APL authoring with AI-assisted review and Apply/Discard workflow

The exact guaranteed semantics are published in the
[BPMN support matrix](docs/reference/bpmn-support.md). Unsupported constructs
are rejected at deployment instead of being silently ignored.

## Planned

- ⏳ Restart/retry/cancellation evidence for the agent worker, then model/tool metadata in live views
- ⏳ Executable tool adapters, policy enforcement and durable tool payloads
- ⏳ Administrative user & roles workspace with `ADMIN_ROOT` bootstrap
- ⏳ TypeScript and Python SDKs
- ⏳ Agent Memory Integrations
- ⏳ Realtime co-editing and project bundle import/export
- ⏳ Production cloud certification for the 1.1 agentic runtime

---

# Deployment and High Availability

PostgreSQL is authoritative, definitions are versioned immutably, and runtime
records use deliberate row locking, optimistic versions and durable leases.
The 0.10 PostgreSQL topology is certified for multiple engine replicas.

Current capabilities include:

- Durable PostgreSQL runtime state
- Cluster-safe timer/external-task acquisition and durable event subscriptions
- Deterministic mutation replay through `Idempotency-Key`
- Global worker capabilities: secured workers register engine-wide topics (and model capabilities) and poll project-agnostically
- Traefik load balancing
- PostgreSQL persistence
- Connection pooling
- Health checks
- Environment-specific deployments
- Containerized runtime
- Workflow-aware telemetry

See the [deployment support matrix](docs/reference/deployment-support.md) before
choosing a production topology.

---

# Performance

No performance or scalability number is a 1.0 guarantee until its harness,
hardware, database configuration and results are published reproducibly.

Current optimization work focuses on:

- Database I/O
- Event correlation
- Job execution
- Horizontal scaling
- Insight fact-write and analysis-window overhead at the published scale target

---

# API

Documentation:

- [API Reference](docs/development/api.md)
- [Machine-readable v1 contract](docs/reference/api-v1.md)

Service information:

```
/api/v1/info
```

Operational health probes:

```
/api/actuator/health/liveness
/api/actuator/health/readiness
```

Swagger:

```
/api/swagger-ui.html
```

---

# Roadmap

The public roadmaps separate the certified 1.0 core from the 1.1 agentic and
infrastructure evidence still required:

- [Roadmap to 1.0](docs/development/roadmap-to-1.0.md)
- [Roadmap to 1.1 RC](docs/development/roadmap-to-1.1.0-rc.md)
- [Studio application specification](docs/development/studio-app-spec.md)
- [Agent worker contract](docs/reference/agent-worker.md)

---

# Contributing

This repository contains the public components of the Abada Platform.

Contributions are welcome.

Please:

- Read [`AGENTS.md`](AGENTS.md) for the repository-wide working agreement
- Include tests
- Update documentation
- Keep pull requests focused
- Specify the affected component in Conventional Commit style:
  `feat(runtime): ...`, `fix(api): ...`, `feat(studio): ...`,
  `test(release): ...`, `docs(architecture): ...`

---

# License

MIT License