# Studio — AI Orchestration Authoring Application

**Studio** is the authoring surface of the Abada platform: it lets workflow
designers compose agentic workflows visually, embed deterministic decision
tables, compile them into executable BPMN 2.0, deploy them to the Abada
Engine, and **run them live** — observing real decision outcomes instead of a
simulation.

This specification records what the Studio is, how it operates, what was
achieved in the 2026-08 integration phases, and the operational boundaries
that must stay honest.

---

## Position in the platform

| App | Role | Stack |
| --- | --- | --- |
| **Studio** | Author agentic workflows, compile to BPMN, deploy and run live | React 19, TypeScript, Vite |
| **Abada Engine** | BPMN runtime, persistence, REST API, security | Java 21, Spring Boot 3.5 |
| **Tenda** | End-user task application (human-in-the-loop) | React 18, TypeScript, Vite |
| **Orun** | Operations and workflow-state inspection | React 19, TypeScript, Vite |

Studio is the place where the platform's core doctrine is expressed in a
graph: **the table is the law, agents are the advice** (see
[ADR-002](../adr/ADR-002-native-decision-tables-deterministic-wall.md)).
Deterministic decision tables declared in Studio are compiled to native engine
constructs and executed in-transaction; agent steps remain external,
probabilistic work bounded by those rules.

---

## Key capabilities

1. **Visual designer** — canvas with agent, human, decision-table, gateway and
   event nodes; drag, connect, configure and delete.
2. **APL pipeline** — canvas model ⇄ APL (Abada Process Language) ⇄ BPMN 2.0
   XML with lossless round-trip fidelity.
3. **Deployment to engine** — compile and deploy with idempotent reuse of the
   latest definition version.
4. **Live run** — start an instance with a payload, poll the engine, and prove
   decision outputs applied in-transaction.
5. **Audit log panel** — streaming event log of deploy/run activity.
6. **Task inbox** — human-in-the-loop tasks from the engine.
7. **Operations view** — engine instances and state inspection.
8. **Natural-language generation** — NL prompt → BPMN via Semaflow/Vertex AI,
   transpiled back into the visual model.

---

## Strategic evolution (2026-08 integration phases)

The Studio shipped in four deliberate phases. Each phase closed one gap in the
path from "mockup" to "real execution authority".

### Phase 0 — Platform integration

Studio joined the supported local Compose family: its own service, a Keycloak
client (`abada-frontend` redirect for `http://studio.localhost/*`), CORS
alignment for the engine API, and a local development start script
(`scripts/start-engine-for-studio.sh`). Result: Studio is reachable at
`http://studio.localhost` with OIDC login, same as Tenda and Orun.

### Phase 1 — Engine: native decision tables (the strategic shift)

The engine gained a first-class deterministic decision construct:

- `bpmn:businessRuleTask` is now supported **only** with an inline
  `abada:decisionTable` extension (`abada:input` / `abada:rule` /
  `abada:output`) in the `https://abada.io/schema/bpmn` namespace.
- Evaluation happens **inside the mutation transaction**
  (`DecisionTableEvaluator`): inputs resolve from `${...}` expressions over
  instance variables, outputs are written to variables, and the step commits
  or rolls back atomically with workflow state, history and outbox.
- Hit policies `FIRST` / `UNIQUE` / `COLLECT`; `otherwise` fallback; no match
  and no fallback → loud failure, never a guess.
- Every application is audited as `DECISION_TABLE_APPLIED` with the stable
  `decisionKey`, matched rule indexes and input/output names.
- Secure, hardened XML extraction (`DecisionTableXml`: no DTDs, no external
  entities, no XInclude).
- PostgreSQL Testcontainers coverage, including in-transaction rollback when a
  decision cannot be made.

This is the "wall against hallucination": a governed decision is reproducible
from the deployed table, not re-derived from a model call.

### Phase 2 — Studio: native compiler

- The compiler (`lib/bpmn/compiler.ts`) now emits
  `bpmn:businessRuleTask` + `abada:decisionTable` directly — no external
  `abada:dmn` worker — with the `abada` namespace declared on the root.
- The transpiler (`lib/bpmn/transpiler.ts`) reads the native extension back
  into decision-table APL nodes with value coercion
  (`"true"` → `true`, `"21%"` → string, `"42"` → `42`), keeping a legacy
  fallback for pre-Phase-2 `abada:dmn` service tasks.
- `hitPolicy` narrowed to the engine-supported `FIRST | UNIQUE | COLLECT`;
  the `PRIORITY` option was removed from the property inspector.
- Shared helpers `normalizeTableInputs` and `resolveRuleOutcome` keep the
  vision's canonical YAML shape and the flattened form in sync.

### Phase 3 — Studio: live Run panel (real execution)

- The fake walkthrough simulation was replaced by a real
  **deploy → start → poll** loop (`handleRunLive` in `App.tsx`).
- A new **Run on Engine** panel (`features/run/RunPanel.tsx`) provides a JSON
  payload editor pre-filled from the workflow's DMN input expressions
  (`deriveDefaultPayload`), a **Run Live** button, and results: status badge,
  instance ID, definition version, **DECISION OUTPUTS · APPLIED
  IN-TRANSACTION** cards, and raw instance variables.
- Node statuses on the canvas are derived **only from engine-visible facts**
  (`applyInstanceState`): terminal status, decision outputs present in
  instance variables, and the human task the instance is waiting on.
- Human-in-the-loop detection polls `GET /tasks?status=AVAILABLE` and matches
  the engine task name (the BPMN `userTask` name = the node **description**)
  against human nodes.

### Proof evidence (all green)

| Verification | Result |
| --- | --- |
| `npm run build` + `npm run lint` (Studio) | 0 errors |
| Round-trip XML ⇄ APL ⇄ XML | inputs, rules, otherwise, outputs identical |
| Real deploy (local engine, PostgreSQL + Keycloak) | HTTP 200, version bump on change |
| Minimal workflow `start → decision-table → end` | instance **COMPLETED**, variables `risk: LOW`, `auto: true` written in-transaction |
| Live-run helpers against real engine data | `extractDecisionOutputs` detects the decision; `applyInstanceState` maps COMPLETED/ACTIVE |
| Human-gate detection | verified against engine semantics: `TaskStatus.AVAILABLE` enum, task name = node description (`/tasks` is user-scoped, so visibility depends on the authenticated user) |

Real bugs caught by code review during Phase 3: the waiting-task detection
initially compared the node **title** to the task name (the compiler emits the
**description**) and used a non-existent `CREATED` status instead of the
engine's `AVAILABLE` enum. Both were fixed and proven against the live engine.

---

## Feature specifications

### 1. Designer canvas

**Route/view:** `designer` (default)

- Node palette (sidebar): **AI Agent**, **Human Task**, **Decision Table**,
  **Gateway**, **Trigger Event**; nodes are added to the canvas and connected
  with labeled edges.
- Node types map to BPMN as follows (compiler):
  - `event` (start) → `bpmn:startEvent`
  - `event` (end) → `bpmn:endEvent`
  - `agent` → `bpmn:serviceTask` with topic `abada:agent` and
    `camunda:properties` (model, prompt, confidence threshold)
  - `human` → `bpmn:userTask` with `camunda:candidateGroups`; **the task name
    is the node description** (not the title) — a fact the Run panel relies on
  - `dmn` → `bpmn:businessRuleTask` + `abada:decisionTable` (native, in-transaction)
  - `gateway` → `bpmn:exclusiveGateway` with conditional flows and a default
- Canvas node badges reflect **real run state only**: `idle`, `running`,
  `completed`, `failed`, `waiting` — applied from engine facts after a live
  run; sample workflows no longer carry hardcoded statuses.

### 2. APL pipeline

APL is specified in [`docs/reference/apl-specification.md`](../reference/apl-specification.md);
the canonical production example lives in [`examples/apl/kyc-onboarding.apl.yaml`](../../examples/apl/kyc-onboarding.apl.yaml).

```
WorkflowFile (React Flow model)
   │  workflowToAPL (lib/apl/parser.ts)
   ▼
APLDocument (Abada Process Language, version abada.io/v1)
   │  compileAPLToBPMN (lib/bpmn/compiler.ts)
   ▼
BPMN 2.0 XML  ──►  engine deploy (strict=false)
   │  transpileBPMNToAPL (lib/bpmn/transpiler.ts)   [imports & NL generation]
   ▼
APLDocument  ──►  aplToWorkflow  ──►  WorkflowFile
```

- **Compiler** emits a single process with sequence flows, gateway conditions
  as formal expressions, and the native `abada:decisionTable` extension;
  boolean attributes are rendered explicitly (`isExecutable="true"`) so the
  XML stays well-formed.
- **Transpiler** reads standard BPMN back into APL. It recognizes native
  decision tables, agents (topic `abada:agent` or name heuristic), engine
  tasks, user tasks, gateways and events, and keeps the legacy `abada:dmn`
  service-task fallback.
- **APL YAML** is stringified in the vision's canonical shape (`inputs` as a
  map, `otherwise: { then: {...} }`) so AI-generated rule PRs use one stable
  form; both shapes are accepted on parse.

### 3. Deployment to engine

**Trigger:** "Deploy to Engine" button in the header.

1. `workflowToAPL` → `compileAPLToBPMN` → multipart form (`file`, `strict=false`).
2. `POST /v1/processes/deploy` with the Keycloak bearer token.
3. Result logged to the audit panel: process definition id, version,
   deployment id.

Definitions are **immutable and versioned**: redeploying identical XML reuses
the current version; any change bumps the version. The Run panel reuses the
latest deployed version when present (`GET /v1/processes?key=...`), so
repeated runs do not spam versions.

### 4. Run panel (live execution)

**Trigger:** "Run" button in the header (opens the panel).

**Input payload editor**

- Pre-filled by `deriveDefaultPayload`: each DMN input expression
  `${order.jurisdiction}` creates a path in a starter payload with a
  type-appropriate default (`NUMBER: 14200`, `STRING: 'EU'`, `BOOLEAN: false`,
  ...), chosen so the sample workflows' first rules fire on the first run.
- JSON validated before running; "Reset defaults" re-derives the payload.

**Run Live sequence** (`handleRunLive`, max 45 s):

1. Find the deployed definition by process key; deploy only if absent
   (idempotent reuse of the latest version otherwise).
2. `POST /v1/processes/start?processId=...&username=<keycloak-username>` with
   the payload. The engine identity comes from the authenticated token
   (`getUserFromToken(keycloak.tokenParsed)`).
3. Poll `GET /v1/processes/instances/{id}` every 1.5 s until: a terminal
   status (`COMPLETED` / `FAILED` / `CANCELLED`), a visible human task, or the
   deadline.
4. Every poll, re-extract decision outputs: when a DMN node's declared outputs
   all appear in the instance variables, the table was applied
   in-transaction — log a success line with output chips.
5. Every third poll, query `GET /v1/tasks?status=AVAILABLE` (best-effort) and
   match `t.name` against human nodes' `description || title`; on a match the
   run reports `waiting at <task>`.
6. Final snapshot: status badge, duration, decision-output cards, raw
   variables, and canvas node states via `applyInstanceState`.

**Result surface**

- Status badge: `COMPLETED` (green), `ACTIVE` (amber), `FAILED`/`CANCELLED`
  (red); duration; instance id; definition + version; "waiting at" when
  applicable.
- **DECISION OUTPUTS · APPLIED IN-TRANSACTION** cards: one per executed table
  (`decisionKey`, node title, `name = value` chips) — the visible proof of the
  deterministic wall.
- Collapsible **INSTANCE VARIABLES** block.
- Honest ACTIVE messaging: the flow has paused awaiting a human task or an
  external agent worker (there is no agent worker in the current stack).

### 5. Audit log panel

Streaming log of deploy/run events with per-event type (event / dmn / agent /
human), status color, timestamp, and decision-output chips. Used to narrate
live runs (compile, deploy, start, decision applied, terminal state).

### 6. Task inbox (human-in-the-loop)

**Route/view:** `inbox` — lists engine tasks visible to the authenticated
user, i.e. assigned or claimable tasks (the engine's `/tasks` endpoint is
user-scoped). Completing a task from here advances the corresponding instance.

### 7. Operations view

**Route/view:** `operations` — process instances from the engine with status
and inspection, complementing Orun inside the Studio context.

### 8. Natural-language generation

**Trigger:** `NLInputBar` prompt → Semaflow (`api/semaflow.ts`) → BPMN
XML from Vertex AI → `transpileBPMNToAPL` → `aplToWorkflow` → new canvas tab.
Generated models flow through the same deterministic pipeline as hand-authored
ones (decision tables survive the round trip via the native transpiler path).

---

## Technical implementation

### Module map (`studio/src`)

```
src/
├── api/
│   ├── engine.ts        # EngineAPI client (deploy, start, instance, tasks, definitions)
│   └── semaflow.ts      # NL → BPMN generation client
├── auth/
│   └── keycloakClient.ts# OIDC (Keycloak) init, token, getUserFromToken
├── config/
│   └── runtime.ts       # runtime-config (public/config.js) API URL etc.
├── data/
│   └── sampleWorkflows.ts # starter workflows (no hardcoded run statuses)
├── features/
│   ├── designer/        # Canvas, NodeRenderer (status badges)
│   ├── run/RunPanel.tsx # live run panel
│   ├── inbox/TaskInbox.tsx
│   ├── operations/ProcessOperations.tsx
│   └── ai/ ...          # NL generation plumbing
├── lib/
│   ├── apl/             # APL types, parser (workflowToAPL, aplToWorkflow,
│   │                    #   parseAPLYaml, stringifyAPLYaml, normalizeTableInputs,
│   │                    #   resolveRuleOutcome)
│   ├── bpmn/            # compiler.ts (APL → BPMN), transpiler.ts (BPMN → APL)
│   └── run/liveRun.ts   # deriveDefaultPayload, extractDecisionOutputs,
│                        #   applyInstanceState, mapTerminalStatus, sleep
├── components/          # Header, Sidebar, PropertiesInspector, SimulationPanel,
│                        #   NLInputBar, NewWorkflowModal
├── App.tsx              # state hub: handleRunLive, handleDeploy, handleGenerateWorkflow
└── types.ts             # WorkflowFile, WorkflowNode, SimulationLog, ...
```

### Engine API client surface

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `deployWorkflow(wf)` | `POST /v1/processes/deploy` | compile + multipart deploy |
| `findProcessDefinition(key)` | `GET /v1/processes?key=` | idempotent reuse of latest version |
| `startProcess(id, vars)` | `POST /v1/processes/start?processId=&username=` | start with authenticated user |
| `getInstance(id)` | `GET /v1/processes/instances/{id}` | status + variables polling |
| `getInstances()` | `GET /v1/processes/instances?size=20` | operations view |
| `getTasks(status?)` | `GET /v1/tasks?status=` | waiting-task detection |
| `completeTask(id, vars)` | `POST /v1/tasks/{id}/complete` | human-in-the-loop |
| `failInstance(id)` | `POST /v1/processes/instance/{id}/fail` | incident handling |

### Authentication

- OIDC via Keycloak (`abada-frontend` client, realm `abada-dev` in dev),
  `studio.localhost` allowed as redirect origin.
- All engine calls carry `Authorization: Bearer <token>`.
- The engine receives the real Keycloak username on start so audit trails
  record the actual actor.

---

## Operations

### Local development

```bash
# bring up engine + postgres + keycloak + studio (dev profile)
./scripts/start-engine-for-studio.sh
# or, with the stack already running:
cd studio && npm ci && npm run dev
```

- Studio runs at `http://studio.localhost` (Compose) or the Vite dev URL.
- Demo user: `alice` / `alice`.

### Rebuilding the served image

```bash
cd studio && docker build -f Dockerfile.prod -t abada-studio:local .
cd .. && ABADA_STUDIO_IMAGE=abada-studio:local \
  docker compose -f compose.yaml -f compose.dev.yaml up -d abada-studio
```

### Verification

```bash
cd studio
npm run lint
npm run build
```

---

## Known boundaries (kept honest)

- **Agents wait for an external worker.** Agent steps compile to
  `serviceTask` topic `abada:agent`; with no worker running, a run stops there
  and reports ACTIVE. This is by design — agents must not advance BPMN state
  outside engine commands (1.1 track).
- **`/tasks` is user-scoped.** Waiting-task detection only fires when the
  authenticated user is a candidate; otherwise the run reports a neutral
  ACTIVE message.
- **Decision-output detection is a presence heuristic.** `extractDecisionOutputs`
  declares a table applied when all its output names appear in the instance
  variables. It is proven correct for the current engine behavior but is not a
  substitute for the engine's own `DECISION_TABLE_APPLIED` history records
  (operations RBAC restricts direct history access).
- **Human task name = node description.** The compiler emits the description
  as the BPMN `userTask` name; title-based matching would silently fail.
- **hitPolicy is intentionally limited** to `FIRST | UNIQUE | COLLECT`; the
  engine rejects anything else at deployment (loud failure, not a guess).

---

## Future enhancements

- Render the engine's `DECISION_TABLE_APPLIED` history events directly in the
  audit panel (requires operations RBAC or a dedicated endpoint).
- Wire a real agent worker (external-worker protocol) so agent steps complete
  live from the Studio.
- Per-run diff of instance variables (before/after each decision table).
- Decision-table outcome preview before deploy (client-side evaluation of the
  compiled table against the current payload).
- Mirror this specification into the Starlight user/developer guide.

---

## Conclusion

Studio is the authoring surface where Abada's doctrine becomes executable:
deterministic decision tables declared visually are compiled to native engine
constructs and proven live in-transaction, while probabilistic agents remain
bounded, external work. The 2026-08 phases took Studio from a mockup to a
real execution authority, and this specification records both the operations
and the honest boundaries that keep that claim true.
