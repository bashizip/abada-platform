# Abada Platform

**The observable BPMN orchestration core for next-generation organic and agentic workflows.**

Abada is a modular, cloud-native workflow platform built with **Java 21** and **Spring Boot 3**. It provides a lightweight BPMN execution engine for coordinating humans, services, business rules, events, and emerging AI-agent workloads within durable, auditable processes.

Abada is designed around a simple principle: autonomous agents may reason and act dynamically, but production workflows still require deterministic control over state, sequencing, permissions, timeouts, approvals, recovery, and observability.

The open-source platform currently includes the BPMN execution core, task
management, operational monitoring, a release-candidate container deployment,
and optional workflow-aware telemetry.

> **🚧 Agentic development status**
>
> The next-generation **agentic orchestration capabilities** currently under active development are **not yet open sourced**. They are being built on top of the public Abada BPMN core and will be released progressively as the architecture, APIs, and SDKs mature.

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

Rather than replacing BPMN with AI agents, Abada combines both:

- **Agents reason**
- **BPMN orchestrates a documented, tested subset**
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

The BPMN engine remains the authoritative execution model while AI agents become intelligent participants within the workflow.

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
| **admin/** | Administration UI (external repository) |
| **semaflow/** | Natural Language → BPMN tooling (external repository) |

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
./quickstart.sh 1.0.0-rc.1
```

Windows:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/bashizip/abada-engine/main/release/quickstart.ps1 -OutFile quickstart.ps1
.\quickstart.ps1 -Version 1.0.0-rc.1
```

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

---

# Current Status (v0.11.0-alpha)

Abada 0.11 adds stable REST and external-worker contracts, direct OIDC JWT
validation, backend RBAC and a Java worker SDK to the durable, cluster-safe
PostgreSQL runtime.
Two or more replicas can contend safely for timers, external tasks, messages,
signals and user-task transitions. Public mutation retries can use
`Idempotency-Key` for a deterministic response.

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

The exact guaranteed semantics are published in the
[BPMN support matrix](docs/reference/bpmn-support.md). Unsupported constructs
are rejected at deployment instead of being silently ignored.

## Planned

- ⏳ Additional BPMN compatibility profiles
- ⏳ TypeScript and Python SDKs
- ⏳ DMN
- ⏳ CMMN
- ⏳ Public Agentic Runtime
- ⏳ AI Worker SDK
- ⏳ Agent Memory Integrations
- ⏳ Policy Engine

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

Health endpoint:

```
/api/v1/info
```

Swagger:

```
/api/swagger-ui.html
```

---

# Roadmap

The public roadmap covers the progression from the current BPMN execution engine toward a fully featured cloud-native orchestration platform.

The **agentic orchestration layer** is currently under active private development and **is intentionally not yet open sourced**. It builds on top of the public BPMN core and will be released progressively as its APIs, runtime model, and SDKs stabilize.

See the complete roadmap:

- [Roadmap to 1.0](docs/development/roadmap-to-1.0.md)

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
