# Abada Platform

**APL-native workflow authoring on a durable PostgreSQL orchestration core.**

Abada is a modular, self-hosted workflow platform built with **Java 21** and
**Spring Boot 3**. Native `abada.io/v1` YAML and backward-compatible BPMN
definitions compile into the same durable runtime state machine for humans,
services, deterministic decisions, events, and AI-agent work.

Abada is designed around a simple principle: autonomous agents may reason and act dynamically, but production workflows still require deterministic control over state, sequencing, permissions, timeouts, approvals, recovery, and observability.

The open-source platform includes the PostgreSQL execution core, task and
operations applications, Abada Studio, a Java worker SDK and agent sidecar,
release-candidate container deployment, and optional telemetry.

> **🚧 1.1 agentic development status**
>
> Native APL, the governed Insight Loop, and the first-party agent worker are
> present in this repository but are not yet a production-certified 1.1
> release. The 1.0 release line remains the certified BPMN/PostgreSQL core.

📚 **Documentation**

- [Platform Overview](docs/platform-overview.md)
- [Architecture & Deployment Guide](docs/architecture/overview.md)
- [API Documentation](docs/development/api.md)
- [Observability Guide](docs/operations/observability.md)

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
- **APL authors; the durable engine orchestrates**
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
participate through leased, retryable external work.

---

# Optional observability

Telemetry export is disabled by default and never participates in workflow
correctness. Add the bundled overlay or point the engine at an external OTLP
collector when observability is required.

The engine emits **workflow-aware telemetry** using **OpenTelemetry**, allowing operators to follow execution from API request to BPMN activity, event correlation, task lifecycle, persistence layer, and infrastructure.

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

Future releases will extend telemetry to include:

- AI model invocations
- Tool execution
- Token usage
- Decision latency
- Agent retries
- Human intervention
- Agent-to-agent delegation

See the [Observability Guide](docs/operations/observability.md).

---

# Platform Architecture

Abada is a modular monorepo.

| Component | Description |
|-----------|-------------|
| **engine/** | Durable BPMN execution engine |
| **tenda/** | Human task application |
| **orun/** | Operations & observability dashboard |
| **studio/** | APL-native visual and YAML authoring environment |
| **admin/** | Administration UI (external repository) |

```
                Users / Systems / Events
                         │
                         ▼
                 Abada BPMN Core
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
      Humans         Services       AI Agents
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
./release/abada-platform up dev
```

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

Build and launch the complete stack.

```bash
./scripts/dev/build-and-run-dev.sh
```

Start previously built images.

```bash
./scripts/dev/start-dev.sh
```

Validate the deployment without starting it.

```bash
./release/abada-platform doctor dev
```

---

# Local Services

| Service | URL |
|---------|-----|
| Gateway | http://localhost |
| Engine API | http://api.localhost/api |
| Swagger | http://api.localhost/api/swagger-ui.html |
| Tenda | http://tenda.localhost |
| Orun | http://orun.localhost |
| Keycloak | http://keycloak.localhost |
| Grafana (telemetry overlay) | http://127.0.0.1:3000 |

Development uses separate starter identities so task work and operational
access remain visibly distinct:

| Application | Username | Password | Purpose |
| --- | --- | --- | --- |
| Tenda | `alice` | `alice` | Deploy, start and complete workflow tasks |
| Orun | `orun-admin` | `orun-admin` | Inspect workflow history and operations |
| Keycloak admin | `admin` | `admin` | Manage the development realm |

If Tenda has already signed you in as Alice, Orun may reuse that Keycloak
session. Choose **Sign out and switch account**, then sign in as
`orun-admin`. These credentials are development-only.

---

# Current Status (v1.0.0-rc.2)

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

The curated architecture and developer documentation is built with Astro 7,
Starlight 0.41, MDX and Mermaid under [`documentation/`](documentation/).
Browse the [published documentation](https://abada-engine-docs.vercel.app), or
run `cd documentation && npm ci && npm run dev` to browse it locally. The site
now includes deployment, telemetry, first-workflow, backup, upgrade and
troubleshooting user guides for the 1.0 release candidate. Certification
evidence is tracked in the
[1.0 roadmap](docs/development/roadmap-to-1.0.md).

The BPMN execution core is operational, while APIs and platform capabilities continue to evolve.

## Implemented

- ✅ BPMN execution engine
- ✅ Process persistence
- ✅ User Tasks
- ✅ Service Tasks
- ✅ Script Tasks
- ✅ Message Events
- ✅ Signal Events
- ✅ Parallel Gateways
- ✅ Exclusive Gateways
- ✅ REST APIs
- ✅ PostgreSQL
- ✅ H2
- ✅ OpenTelemetry
- ✅ Prometheus
- ✅ Grafana
- ✅ Jaeger
- ✅ Loki
- ✅ Docker
- ✅ Traefik
- ✅ Keycloak Authentication
- ✅ Stable API v1 and worker protocol v1
- ✅ Java external-worker SDK
- ✅ OIDC JWT validation and backend RBAC
- ✅ Native APL parser and immutable APL definitions
- ✅ Native deterministic decision tables
- ✅ PostgreSQL-authoritative Insight Loop with governed Studio review
- ✅ Versioned `abada.agent/v1` profile and Java agent sidecar

The exact guaranteed semantics are published in the
[BPMN support matrix](docs/reference/bpmn-support.md). Unsupported constructs
are rejected at deployment instead of being silently ignored.

## Planned

- ⏳ Additional BPMN compatibility profiles
- ⏳ TypeScript and Python SDKs
- ⏳ ❌ CMMN (superseded by agentic adaptive subprocesses)
- ⏳ Production certification for the 1.1 agentic runtime
- ⏳ Agent Memory Integrations
- ⏳ Executable tool adapters and policy enforcement

---

# Deployment and High Availability

PostgreSQL is authoritative, definitions are versioned immutably, and runtime
records use deliberate row locking, optimistic versions and durable leases.
The 0.10 PostgreSQL topology is certified for multiple engine replicas.

Current capabilities include:

- Durable PostgreSQL runtime state
- Cluster-safe timer/external-task acquisition and durable event subscriptions
- Deterministic mutation replay through `Idempotency-Key`
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
- Redis integration
- Kafka integration

---

# API

Documentation:

- [API Reference](docs/development/api.md)

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
infrastructure evidence still required.

See the complete roadmap:

- [Roadmap to 1.0](docs/development/roadmap-to-1.0.md)
- [Roadmap to 1.1 RC](docs/development/roadmap-to-1.1.0-rc.md)

---

# Contributing

This repository contains the public components of the Abada Platform.

Contributions are welcome.

Please:

- Include tests
- Update documentation
- Keep pull requests focused
- Specify the affected component (`engine`, `tenda`, `orun`, etc.)

Example commit messages:

```
engine: add timer persistence
engine: improve message correlation
observability: add workflow latency dashboard
tenda: improve task claiming
```

---

# License

MIT License
