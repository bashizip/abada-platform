# Google Africa Applied AI Lab — Application Submission

**Deadline:** August 31, 2026  
**Program:** https://labs.google/aifuturesfund/africaailab  
**Form:** https://docs.google.com/forms/d/e/1FAIpQLSeWGDlcZtSSNd4Tuz45pH3LglGJWAbjgGvtzQeobbZ6Re17Pw/viewform?usp=header

> **Live-form audit (August 31):** the application is still open. The form has
> two pages. Only the pitch-deck link is a required artifact; the demo/video is
> optional. Do not submit confidential information.

---

## Form Fields (Ready to Copy-Paste)

### Email
`bashizip@gmail.com`

### Company name
`Abada`

### Company website
`https://abadaplatform.com`

### HQ Location
`Democratic Republic of the Congo`

### Field
`Dev Tools`

### Link to latest pitch deck
`https://docs.google.com/presentation/d/1LwKcgfB1FbA7a5_Cp3kw2H1tycBs2c0-q1U0kEwhTsI/edit`

### Describe what your company does in one sentence

> Abada is an open-source platform for building, running and continuously improving AI-powered business processes, combining durable orchestration, governed AI agents, human work and evidence-based optimization.

### Link to latest product demo and/or video
*[Optional — upload Loom / YouTube / Drive and paste the public link here]*

---

## Page 2 — Founder and Company Information

### Name of Founder(s)
`Patrick Bashizi`

### Social Handles
*[Optional — founder/company LinkedIn, X, GitHub, etc.]*

### Product Development Stage
`Launched`

The selectable values are `Idea`, `Prototype`, `Pre-Launch`, and `Launched`.
`Launched` is supported by the published `1.0.0-rc.4` evaluation release and
the live website.

### ARR (USD)
*[Optional — select the truthful range; do not infer]*

### Monthly Active Users
*[Optional — select the truthful range; do not infer]*

### Total Capital Raised to Date (USD)
*[Optional — select the truthful range; do not infer]*

### Investors
*[Optional — enter only public/non-confidential information]*

### Open to raising Capital from Google now or in the near future?
`Yes`

### Privacy & Terms
*[Required — founder must review and accept the Google Terms of Service and acknowledge the Google Privacy Policy]*

---

## About Abada

### The Problem

AI prototypes produce answers, but business operations require a complete
lifecycle: durable state, deterministic decisions, human approvals, failure
recovery, auditability and controlled evolution. Teams otherwise assemble
separate tools for process design, model calls, human work, operations and
optimization.

### The Solution: One Governed Process Lifecycle

Abada lets teams create or import a process, run agents, people and systems on
one durable state machine, observe execution evidence, and turn that evidence
into validated improvements reviewed by humans.

APL (`abada.io/v1`) is Abada's native, reviewable process representation. It is
one authoring path beneath Studio, alongside visual creation, AI-assisted
authoring and supported BPMN import.

**Product proof — Lead Triage:**

A checked-in Studio process combines a webhook, a governed Gemini agent,
deterministic routing, a human review and a CRM integration. Its native APL
source is a compact implementation detail, while the operational lifecycle is
the product proof.

**What the process demonstrates:**
- **Webhook trigger** — ingest a lead via API
- **Gemini agent node** — classifies priority with `confidence_threshold`, `max_attempts`, `retry_backoff_ms`
- **Condition routing** — branches based on agent output
- **Human-in-the-loop** — high-value leads get senior review with a form (`formKey: lead-triage-review`)
- **System integration** — standard leads flow to CRM via `engine-task`
- **End-to-end durability** — PostgreSQL-backed, survives restarts, audit trail for compliance

### AI-Native Execution

Abada does not "add AI" to BPMN. AI is a first-class node type:

```yaml
- id: classifyInvoice
  type: agent
  description: Classify invoice type
  model: gemini-3.6-flash
  prompt: |
    Given this invoice text: {{invoiceText}}
    Classify it as one of: [UTILITIES, SUPPLIES, SERVICES, EQUIPMENT]
  output_schema:
    type: string
    enum: [UTILITIES, SUPPLIES, SERVICES, EQUIPMENT]
  confidence_threshold: 0.85
  max_attempts: 3
  retry_backoff_ms: 1000
  next: routeByType
```

**Key capabilities:**
- **Agent nodes** declare `prompt`, `model`, `temperature`, `output_schema`, `tools`, `max_attempts`, `retry_backoff_ms`
- **Gemini is the default/first allowed model** (`gemini-3.6-flash`)
- **Natural language → APL authoring:** Describe a workflow in plain English; the system generates valid YAML, validates it, and repairs it if invalid
- **Insight Engine:** Records execution facts, detects bounded operational
  signals, validates proposed APL changes and routes them through governed review

### Governed Continuous Improvement

The Insight Engine persists terminal execution facts in PostgreSQL and detects
external-task failure rate, p95 latency regression and decision-table fallback
thrash. It produces parser-validated proposals bound to the exact target
checksum. Authorized reviewers approve or reject through parallel or sequential
policies; adoption creates a new immutable definition version.

Insight never rewrites a running instance and does not silently apply changes.

### Production Runtime

- **PostgreSQL-backed** — durable state, restart recovery, transactional outbox
- **Versioned, immutable definitions** — redeployment never changes running instances
- **Durable jobs with leases** — safe against duplicate execution, network partitions
- **Self-hosted** — data sovereignty, works on-prem or cloud
- **BPMN interoperability** — execute supported BPMN directly, import it into
  Studio and round-trip the documented subset; unsupported execution semantics
  fail explicitly

### Traction

- Version **1.0.0-rc.4** — published evaluation release candidate for the certified production topology
- Full Testcontainers coverage for PostgreSQL persistence, migration, locking, concurrency
- Restart-recovery and duplicate-request tests validated
- Open-source under active development

---

## What We'll Build During the 3-Month Program

| Initiative | Description |
|---|---|
| **Gemini Function Calling for Agent Tools** | Expand `agent` node `tools` to use Gemini Function Calling for structured external API invocations within workflows |
| **Multimodal Agent Nodes** | Image/document understanding as workflow steps (KYC, invoice processing, medical imaging routing) |
| **African Language Prompt Tuning** | Optimize prompts for Swahili, Yoruba, Amharic, etc. in agent nodes |
| **Natural Language Process Refinement** | Extend governed Insight proposals with Gemini while preserving parser validation and human review |

---

## Pitch Deck Outline

Create a 10-slide deck:

| Slide | Content |
|---|---|
| 1 | **Hook:** Build processes that improve with every execution |
| 2 | **Problem:** AI workflows need an operational lifecycle |
| 3 | **Platform:** Create or import → Run → Observe → Improve |
| 4 | **Creation:** Visual Studio, AI authoring, APL, Dry Run and first-class nodes |
| 5 | **Gemini:** Durable, validated, observable agent execution |
| 6 | **Insight:** Facts → findings → proposal → review → new immutable version |
| 7 | **Trust:** PostgreSQL reliability, RBAC, audit and reviewer policies |
| 8 | **Interoperability:** Native creation plus bounded BPMN import/export |
| 9 | **Africa and business model:** High-stakes use cases; OSS core plus future hosting/support |
| 10 | **Founder and Lab ask:** Patrick Bashizi; function calling, multimodal and African languages |

---

## Product Demo Script

Record a 75–90 second walkthrough showing:

1. **Creation paths:** Empty workflow, supported BPMN import and Paste APL
2. **Created process:** Gemini agent, deterministic decision, human task and integration
3. **Governed agent properties:** model, output contract, confidence and retry
4. **Durable execution:** deploy, start and inspect persisted agent telemetry
5. **Governed improvement:** real Insight proposal, diff and Approve/Reject controls

**Recorded proof:** the local demo uses real Gemini 3.6 Flash classifications,
persisted HIGH and LOW executions, human review, a clearly labelled local CRM
adapter and an LLM-generated Insight proposal that remains unapproved.

**Upload to:** Loom (free), YouTube (unlisted), or Google Drive (shareable link)

---

## Quick Checklist — Required Before Submission

- [x] Correct the broken form URL
- [x] Confirm HQ country: `Democratic Republic of the Congo`
- [x] Select Field: `Dev Tools`
- [x] Create and visually verify the local 10-slide PPTX
- [x] Import the deck into native Google Slides
- [x] Preserve and verify the existing read-only Google Slides link
- [ ] Copy-paste one-sentence description into form
- [x] Provide exact founder name: `Patrick Bashizi`
- [x] Select Product Development Stage: `Launched`
- [x] Open to raising capital from Google: `Yes`
- [ ] Review and accept Privacy & Terms
- [ ] Optionally answer ARR, MAU, capital raised, investors, and social handles
- [x] Record and verify the optional product demo locally
- [ ] Upload the optional product demo after separate authorization
- [ ] Test every submitted link in a signed-out/incognito window
- [ ] Submit only after Patrick gives explicit, action-time authorization

---

*This submission package was prepared on August 27, 2026.*
