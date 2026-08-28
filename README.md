# Abada

**AI-native workflow orchestration in YAML. Self-hosted, durable, open-source.**

Abada is an open-source workflow platform where AI agents, human tasks, and system integrations are first-class citizens — not bolt-ons. You define processes in **APL** (Abada Process Language), a YAML-native DSL that compiles directly to a durable execution graph. No XML. No vendor lock-in.

Built for teams that need production-grade orchestration with data sovereignty: banks, telcos, agritech, govtech, and any enterprise where deterministic control over AI-driven workflows matters.

---

## What Abada Does

```yaml
version: abada.io/v1
metadata:
  name: Lead Triage Demo
flow:
  entry: receive-lead
  nodes:
    - id: receive-lead
      type: webhook
      description: Receive a new sales lead
      next: analyze-lead

    - id: analyze-lead
      type: agent
      description: Classify the lead priority
      model: gemini-3.6-flash
      prompt: |
        Analyze the company size: ${lead.companySize}.
        Classify the lead priority.
        Return exactly one value: HIGH, MEDIUM, or LOW.
      result_variable: lead_priority
      confidence_threshold: 85
      max_attempts: 3
      next: check-priority

    - id: check-priority
      type: condition
      description: Route the lead according to the classified priority
      rules:
        - if: "${lead_priority == 'HIGH'}"
          then: senior-sales-review
        - else: standard-workflow
          then: standard-workflow

    - id: senior-sales-review
      type: human-input
      description: Senior sales director review
      formKey: lead-triage-review
      assignees: [sales-director]
      next: end

    - id: standard-workflow
      type: engine-task
      description: Trigger the standard CRM sequence
      service: trigger-crm-sequence
      next: end

    - id: end
      type: end
      description: Lead triage completed
```

**61 lines of YAML.** Equivalent BPMN XML: **~800+ lines.**

What just happened:
- A lead arrives via webhook
- A **Gemini agent** classifies priority with confidence threshold and retry logic
- A **condition** routes HIGH-priority leads to a senior reviewer
- A **human task** with a form appears for the sales director
- Standard leads flow automatically to the CRM
- The entire process is **durable, versioned, and auditable** in PostgreSQL

---

## Why Abada

| Legacy BPMN Tools | Abada |
|---|---|
| XML diagrams (2000+ lines) | YAML definitions (60 lines) |
| AI as external service call | `agent` as native node type |
| Visual-only authoring | Code + visual hybrid; diffable, reviewable |
| Cloud-only SaaS | Self-hosted, data sovereign |
| Black-box execution | Full audit trail, restart recovery |
| Developer-heavy setup | Natural language → APL authoring |

Abada is built on a simple principle: **autonomous agents may reason dynamically, but production workflows still require deterministic control** over state, sequencing, approvals, timeouts, recovery, and observability.

---

## Platform

| Component | What It Does |
|---|---|
| **Studio** | Visual + YAML authoring, dry runs, live instance inspection, AI-assisted optimization |
| **Engine** | Durable PostgreSQL execution core: process, token, task, timer, job, variable state |
| **Agent Worker** | First-party sidecar that turns `agent` nodes into durable, leased, retryable LLM calls |
| **SDK** | Typed Java clients for external workers and agent attempt/resume contracts |

```
        Abada Studio ─── APL YAML / Visual Canvas
                 │
                 ▼
         Abada Engine Core (PostgreSQL)
                 │
     ┌───────────┼───────────────┐
     ▼           ▼               ▼
  Humans      Services        AI Agents
     │        (workers)     (agent worker)
     │           │               │
     └───────────┴───────────────┘
                 │
                 ▼
   Policies • Tools • Models • APIs
```

Every component is independently deployable with Docker.

---

## Quick Start

```bash
git clone https://github.com/bashizip/abada-engine.git
cd abada-engine
./release/abada-platform doctor dev
./release/abada-platform up dev
```

The success screen prints every local URL and development starter accounts.

Add `--telemetry` for the bundled Grafana, Prometheus, Jaeger, and Loki stack.

### Versioned release bundle

```bash
curl -fsSLO https://raw.githubusercontent.com/bashizip/abada-engine/main/release/quickstart.sh
chmod +x quickstart.sh
./quickstart.sh 1.0.0-rc.3
```

See [`release/README.md`](release/README.md).

---

## What's Implemented

- **Native APL runtime** — YAML parses directly to executable graph; no XML round-trip
- **Agent nodes** — First-class LLM tasks with `gemini-3.6-flash` as default; prompt, output schema, confidence threshold, retry, backoff
- **Decision tables** — Deterministic rules executed in-transaction (the "law" that constrains agent "advice")
- **Human tasks** — Claim, assign, complete with forms and SLA tracking
- **Event handling** — Messages, signals, timers, event gateways with race semantics
- **Parallel & inclusive gateways** — Fork/join with restart-safe token bookkeeping
- **Project envelopes** — PostgreSQL-backed projects, folders, resources, role memberships
- **Insight Loop** — Engine writes execution facts; AI proposes APL improvements; governed review in Studio
- **Natural language authoring** — Describe a workflow in plain English; get valid, deployable YAML
- **BPMN compatibility** — Import existing BPMN for migration; export for interoperability
- **Production runtime** — PostgreSQL, Flyway migrations, optimistic locking, durable leases, cluster-safe work acquisition
- **Observability** — OpenTelemetry, distributed tracing, metrics, structured logging
- **Security** — OIDC JWT validation, backend RBAC, audit history

See the [BPMN support matrix](docs/reference/bpmn-support.md) for exact semantics.

---

## Documentation

- [Platform Overview](docs/platform-overview.md)
- [Architecture & Deployment](docs/architecture/overview.md)
- [APL Specification](docs/reference/apl-specification.md)
- [API Reference](docs/development/api.md)
- [Observability Guide](docs/operations/observability.md)
- [Release Notes](docs/release-notes/)

---

## Status

**Certified baseline:** `1.0.0-rc.3` — stable REST and worker contracts, direct OIDC JWT validation, backend RBAC, cluster-safe PostgreSQL runtime.

**1.1 agentic checkpoint** (in development): native APL runtime, deterministic decision tables, governed Insight Loop, project envelopes, first-party agent worker. Progress tracked in the [1.1 RC roadmap](docs/development/roadmap-to-1.1.0-rc.md).

---

## Contributing

- Read [`AGENTS.md`](AGENTS.md) for the repository working agreement
- Include tests
- Update documentation
- Keep pull requests focused
- Use Conventional Commits: `feat(runtime): ...`, `fix(api): ...`, `feat(studio): ...`

---

## License

MIT License
