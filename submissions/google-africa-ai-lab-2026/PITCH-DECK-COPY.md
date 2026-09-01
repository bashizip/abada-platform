# Abada — Google Africa Applied AI Lab Pitch Deck Copy

Audience-facing copy for the 10-slide English deck. APL is a supporting
implementation mechanism; the product story is the complete, governed process
lifecycle.

## 1 — Build processes that improve with every execution

**Abada**

Build, run, observe and continuously improve AI-powered business processes —
with durable orchestration and human-governed change.

Patrick Bashizi · Democratic Republic of the Congo · abadaplatform.com

## 2 — AI workflows need an operational lifecycle

An AI response takes seconds. A business process may run for days.

Production operations need durable state, deterministic decisions, human
approvals, failure recovery, auditability and controlled evolution.

Abada connects those requirements in one lifecycle.

## 3 — One platform for the full process lifecycle

**Create or import** — Design visually, author with AI, use native source, or
bring a supported BPMN process.

**Run** — Coordinate agents, people, decisions and enterprise systems.

**Observe** — Persist execution history, agent attempts, latency and outcomes.

**Improve** — Turn evidence into validated proposals reviewed by people.

## 4 — Create intelligent processes from scratch

Start visually, describe a process in plain language, or author a reviewable
APL document.

Agents, human tasks, decision tables, timers, messages, signals and integrations
are first-class building blocks. Dry Run explores behavior locally before an
immutable version is deployed.

APL (`abada.io/v1`) is the native, diffable representation beneath Studio.

## 5 — Gemini becomes a governed workflow participant

The workflow declares model, prompt, selected inputs, output schema, confidence
threshold and retry policy.

The engine creates durable agent work. The worker calls Gemini outside the
workflow transaction, validates the result, persists attempt metadata and
returns accepted output to deterministic routing.

Model calls remain explicitly at-least-once.

## 6 — Insight Engine: execution evidence becomes improvement

**Facts → Findings → Validated proposal → Human review → New immutable version**

The current engine detects external-task failure rate, p95 latency regression
and decision-table fallback thrash. Proposals are parser-validated, checksum
bound and governed by parallel or sequential reviewer policies.

**No silent self-modification. No running instance is rewritten.**

## 7 — Reliable and accountable by design

**1.0.0-rc.4** published evaluation release candidate

**323 tests** passed in the recorded release gate

PostgreSQL authoritative state · restart recovery · durable leases · immutable
versions · transactional outbox · backend RBAC · audit history

## 8 — Create natively. Import when needed. Interoperate always.

Abada can execute supported BPMN directly, import BPMN into Studio for review,
and round-trip supported process shapes between BPMN and APL.

Standard BPMN, Abada-native extensions and a documented Camunda 7 profile are
available. Unsupported execution semantics fail explicitly instead of being
silently guessed.

## 9 — Built for high-stakes operations in Africa

**Banking** — KYC, credit exceptions and fraud review

**Telecom** — onboarding, network incidents and escalation

**Agritech** — producer cases, documents and field-data routing

**Govtech** — citizen requests and auditable approvals

Open-source core today; managed hosting and enterprise support are future
commercial layers. Self-hosting keeps deployment and data-location choices
with the operator.

## 10 — Why Google Africa Applied AI Lab

With the Lab, Abada will turn Gemini capabilities into reliable workflow
primitives for African operations.

**Three-month focus** — governed function calling · multimodal agent nodes ·
evaluation and adaptation for African languages

**Patrick Bashizi** · Founder · Democratic Republic of the Congo

bashizip@gmail.com · abadaplatform.com · github.com/bashizip/abada-engine

## Source Notes for Speaker Notes

- Insight contract: `docs/reference/insight-loop.md`.
- Runtime and persistence: `docs/reference/runtime-semantics.md` and
  `docs/architecture/runtime-state.md`.
- Agent worker: `docs/reference/agent-worker.md`.
- BPMN boundaries: `docs/reference/bpmn-support.md` and
  `docs/bpmn/compatibility-profiles.md`.
- Release evidence: `docs/development/1.0-rc.4-gate-report-2026-08-30.md`.
- Program: https://labs.google/aifuturesfund/africaailab
