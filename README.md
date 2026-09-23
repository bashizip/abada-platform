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
        Classify the lead priority as HIGH, MEDIUM or LOW.
      result_variable: lead_priority
      output_schema:
        type: object
        required: [priority]
        properties:
          priority: { enum: [HIGH, MEDIUM, LOW] }
      confidence_threshold: 85
      on_low_confidence: senior-sales-review
      max_attempts: 3
      next: check-priority

    - id: check-priority
      type: condition
      description: Route the lead according to the classified priority
      rules:
        - if: "${lead_priority.priority == 'HIGH'}"
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

**55 lines of YAML.** Equivalent BPMN XML: **~800+ lines.**

What just happened:
- A lead arrives via webhook
- A **Gemini agent** classifies priority; the **engine** checks its structured output and confidence, and sends weak answers to a person
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
curl -fsSL https://install.abadaplatform.com/install.sh | bash
```

The installer validates a Gemini key, then the first Studio login creates and
deploys the auto-layouted AI Lead Triage starter. The key stays in the local
mode-`0600` `.env.dev` and is never bundled or exposed to Studio.
Alice initializes and runs the process; a HIGH result is reviewed exclusively
by the bundled `bob` / `bob` user before the local CRM acknowledgement.

See [`release/README.md`](release/README.md).

---

## What's Implemented

- **Native APL runtime** — YAML parses directly to executable graph; no XML round-trip
- **Agent nodes** — Durable LLM steps (Gemini by default, any OpenAI-compatible model); the **engine** enforces the output schema and confidence threshold and routes weak or invalid answers to a person; agents receive only declared inputs. Single model call per step today; tool execution is on the [roadmap](docs/development/roadmap.md)
- **Decision tables and conditions** — Deterministic rules executed in-transaction with sandboxed CEL expressions that cannot reach the JVM and fail loudly
- **Human tasks** — Claim, assign, complete with forms; SLA hours are a monitoring hint until enforced SLAs ship
- **Event handling** — Messages, signals, timers, event gateways with race semantics
- **Parallel & inclusive gateways** — Fork/join with restart-safe token bookkeeping
- **Project envelopes** — PostgreSQL-backed projects, folders, resources, role memberships
- **Insight Loop** — Engine writes execution facts; AI proposes APL improvements; governed review in Studio
- **Natural language authoring** — Describe a workflow in plain English; get an LLM draft that the engine parser validates, for you to review before deploying
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

**Prepared baseline:** `1.0.0-rc.6` — M1 "truth and safety": sandboxed CEL expressions, an engine-enforced agent output contract with low-confidence, invalid-output and error routing, default-deny agent inputs, and a concurrent agent worker with lock heartbeats. Breaking changes are listed in the [release notes](docs/release-notes/1.0.0-rc.6-release-notes.md). Publication remains gated by the RC evidence workflow.

**1.1 agentic checkpoint** (in development): native APL runtime, deterministic decision tables, governed Insight Loop, project envelopes, first-party agent worker. Progress tracked in the [roadmap](docs/development/roadmap.md).

---

## Contributing

- Read [`AGENTS.md`](AGENTS.md) for the repository working agreement
- Include tests
- Update documentation
- Keep pull requests focused
- Use Conventional Commits: `feat(runtime): ...`, `fix(api): ...`, `feat(studio): ...`

---

## License

Copyright © 2025–2026 Patrick Bashizi.

Abada is free software under the [GNU Affero General Public License v3.0 only](LICENSE)
(`AGPL-3.0-only`). If you run a modified Abada as a network service, you must offer its
users the corresponding source code.

The Java worker SDK in [`sdk/java`](sdk/java) is licensed under the
[Apache License 2.0](sdk/java/LICENSE), so workers built on it carry no AGPL obligations.

Releases up to and including `1.0.0-rc.5` were published under the MIT License; that
grant still applies to those versions.
