# Google Africa Applied AI Lab — Application Submission

**Deadline:** August 31, 2026  
**Program:** https://labs.google/aifuturesfund/africaailab  
**Form:** https://docs.google.com/forms/d/e/1FAIpQLSeWGDlcZtSSNd4T9uz45pH3LglGJWAbjgGvtzQeobbZ6Re17Pw/viewform

---

## Form Fields (Ready to Copy-Paste)

### Email
`bashizip@gmail.com`

### Company name
`Abada`

### Company website
`https://abada.studio`

### HQ Location
*[Fill in your city/country]*

### Field
*[Select from dropdown — likely "Developer Tools / Infrastructure" or "Enterprise Software"]*

### Link to latest pitch deck
*[Upload to Google Slides / Canva / Drive and paste link here]*

### Describe what your company does in one sentence

> Abada is an open-source, AI-native workflow orchestration platform that lets teams build and run durable business processes in YAML — where Gemini-powered agents, human tasks, and system integrations are first-class citizens, compiled directly to a PostgreSQL-backed execution graph without XML.

### Link to latest product demo and/or video
*[Upload Loom / YouTube / Drive and paste link here]*

---

## About Abada

### The Problem

African enterprises (banks, telcos, agritech, govtech) need workflow automation but face three structural barriers:

1. **BPMN XML is hostile to developers.** A moderately complex process requires 2,000+ lines of XML. Version control is painful. Code review is impossible. AI models struggle to generate or edit it reliably.
2. **Developer scarcity.** There are not enough senior backend engineers to hand-craft orchestration logic in XML or low-code drag-and-drop tools.
3. **AI is a bolt-on, not a native primitive.** Existing platforms treat LLM calls as external service tasks. There is no first-class concept of an "agent" that can reason, retry, validate output schema, and participate in the process state machine.

### The Solution: APL (Abada Process Language)

Abada replaces BPMN XML with **APL** — a YAML-native process definition language (`abada.io/v1`) that compiles directly to an executable graph. No XML round-trip. No visual designer lock-in.

**Example — Lead Triage Process (61 lines of YAML):**

A real-world sales workflow where a Gemini agent classifies incoming leads, routes high-value ones to a senior reviewer, and sends the rest to a CRM — all in 61 lines of readable YAML:

```yaml
version: abada.io/v1

metadata:
  key: lead_triage_demo
  name: Lead Triage Demo
  owner: sales-team
  category: sales

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
      profile: abada.agent/v1
      model: gemini-3.6-flash
      prompt: |
        Analyze the company size: ${lead.companySize}.
        Classify the lead priority.

        Return exactly one value:
        HIGH, MEDIUM, or LOW.
      result_variable: lead_priority
      confidence_threshold: 85
      temperature: 0.1
      max_attempts: 3
      retry_backoff_ms: 2000
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
      assignees:
        - sales-director
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

Equivalent BPMN XML: **~800+ lines.**

**What this demonstrates:**
- **Webhook trigger** — ingest a lead via API
- **Gemini agent node** — classifies priority with `confidence_threshold`, `max_attempts`, `retry_backoff_ms`
- **Condition routing** — branches based on agent output
- **Human-in-the-loop** — high-value leads get senior review with a form (`formKey: lead-triage-review`)
- **System integration** — standard leads flow to CRM via `engine-task`
- **End-to-end durability** — PostgreSQL-backed, survives restarts, audit trail for compliance

### AI-Native by Design

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
- **Insight engine:** Analyzes runtime metrics and proposes APL optimizations via LLM

### Production Runtime

- **PostgreSQL-backed** — durable state, restart recovery, transactional outbox
- **Versioned, immutable definitions** — redeployment never changes running instances
- **Durable jobs with leases** — safe against duplicate execution, network partitions
- **Self-hosted** — data sovereignty, works on-prem or cloud
- **BPMN compatibility layer** — import existing BPMN for migration; export to BPMN for interoperability

### Traction

- Version **1.0.0-rc.x** — feature-complete for certified production topology
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
| **Natural Language Process Refinement** | Enhance the Insight engine with Gemini to suggest optimizations based on runtime metrics |
| **APL ↔ BPMN Bidirectional** | Generate BPMN XML from APL for interoperability; import BPMN to APL for migration |

---

## Pitch Deck Outline

Create a 10-12 slide deck (Google Slides or Canva):

| Slide | Content |
|---|---|
| 1 | **Hook:** "What if business processes were written in YAML, not XML — and AI agents were first-class citizens?" |
| 2 | **Problem:** African enterprises waste months wiring together workflows with legacy BPMN tools that require XML expertise, expensive consultants, and don't natively support AI |
| 3 | **Solution:** Abada — open-source, self-hosted workflow orchestration with APL, a YAML-native DSL where agent, human-input, decision-table, and engine-task nodes compile directly to a durable execution graph |
| 4 | **The APL Difference:** Show lead-triage YAML (~61 lines) vs equivalent BPMN XML (~800+ lines). Emphasize: no XML round-trip, AI-native by design |
| 5 | **AI-Native Architecture:** Agent nodes use Gemini by default. Natural language → APL authoring. Insight engine proposes optimizations |
| 6 | **Traction:** 1.0.0-rc, PostgreSQL-backed, Testcontainers-verified, restart-recovery tested, BPMN compatibility layer |
| 7 | **Market:** African enterprises (banks, telcos, agritech, govtech) need workflow automation but lack developer density for complex BPMN |
| 8 | **Business Model:** Open-source core + managed hosting / enterprise support (future) |
| 9 | **Team:** Technical founder with deep backend and AI integration experience |
| 10 | **Google AI Lab Ask:** 3 months to build Gemini Function Calling, multimodal agents, and African language support |
| 11 | **Roadmap:** Lab → Demo Day → Seed funding → African enterprise pilots |
| 12 | **Contact:** bashizip@gmail.com, abada.studio |

---

## Product Demo Script

Record a 2-3 minute Loom or screen recording showing:

1. **Open Abada Studio** (or the authoring interface)
2. **Show APL authoring:** Type or paste the lead-triage YAML, deploy it
3. **Start a process instance** via webhook/API with a sample lead payload
4. **Show the runtime:** Token reaches the `analyze-lead` agent node
5. **Show the agent node:** Trigger the agent that calls Gemini, show `lead_priority` populated with HIGH/MEDIUM/LOW
6. **Show conditional routing:** HIGH priority routes to `senior-sales-review` human task with form; standard routes to CRM
7. **Show restart recovery:** Stop the engine, restart, show the process resumes from the exact same state

**Alternative (if no running demo):** Code walkthrough — screen-share the APL parser, show how lead-triage YAML compiles to `ParsedProcessDefinition`, show `AplAuthoringService` generating APL from natural language, show the `LeadTriageHumanInputTest` passing.

**Upload to:** Loom (free), YouTube (unlisted), or Google Drive (shareable link)

---

## Quick Checklist

- [ ] Fill in HQ Location
- [ ] Select Field from dropdown
- [ ] Create pitch deck (Google Slides / Canva)
- [ ] Upload pitch deck and get shareable link
- [ ] Record product demo (Loom / screen recording)
- [ ] Upload demo and get shareable link
- [ ] Copy-paste one-sentence description into form
- [ ] Submit form before August 31, 2026

---

*This submission package was prepared on August 27, 2026.*
