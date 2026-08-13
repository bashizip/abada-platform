# APL Node Reference — every node type and its properties

- Status: **Implemented** — matches the engine `AplParser` contract and the
  Studio canvas (`abada.io/v1`).
- Purpose: the plain-language, node-by-node guide to the Abada Process
  Language (APL). It is the shared reference for **three audiences**:
  1. **Studio authors** — what each node does and what you must configure.
  2. **Studio developers** — the property panel contract: every property below
     is something the panel should let the author edit for its node.
  3. **Engine users** — the user-facing APL documentation alongside the formal
     [technical specification](apl-specification.md).

The formal grammar, validation rules and error codes live in
[`apl-specification.md`](apl-specification.md). This document explains the
same nodes in plain language and is deliberately non-grammatical: it tells you
*what to fill in*, not the full parser rules.

---

## 1. How to read this document

Each node section contains:

- **What it does** — a plain-language description.
- **When to use it** — the situation it is designed for.
- **BPMN equivalent** — the standard BPMN element it compiles to, or the
  pattern it replaces.
- **Properties** — a table of the node's configuration fields. `Required`
  means the engine rejects the deployment if the field is missing or empty.
  Optional fields have sensible engine defaults when omitted.
- **Example** — a minimal YAML snippet.

The vocabulary table in §2 gives the one-glance summary; §3 covers the
properties every node shares; §4 walks each node type; §5 summarizes the
gateway fork/join forms.

---

## 2. Node vocabulary — APL ↔ BPMN equivalent

This is the complete node vocabulary of `abada.io/v1`. The right-hand column
is the BPMN construct each APL node compiles to — or, where noted, the common
BPMN *pattern* it replaces with a simpler, safer shape.

| APL node | Studio palette | BPMN equivalent | What it replaces / notes |
| --- | --- | --- | --- |
| `webhook` | Start Event | Start Event (webhook trigger) | The process trigger — one per process |
| `end` | End Event | End Event | — |
| `agent` | AI Agent Node | Service Task (external task on `abada:agent`) | The "AI/LLM service task" pattern: probabilistic work as a durable external task |
| `engine-task` | Engine Task | Service Task (external task on a worker topic) | Camunda external task / generic service task |
| `script` | Script Step | Script Task | Embedded Java delegate (`camunda:class`) — in-transaction server-side JavaScript |
| `approval-gate` | Approval Gate | User Task | Human review task with candidate groups |
| `decision-table` | DMN Rule Table | Business Rule Task (DMN table) | Camunda DMN table binding — executed by the engine in-transaction |
| `condition` | Exclusive Gateway | Exclusive Gateway | BPMN exclusive gateway (exactly one branch, with a default flow) |
| `inclusive` | Inclusive Gateway | Inclusive Gateway | BPMN inclusive gateway (every matching branch, zero or more) |
| `parallel` | Parallel Gateway | Parallel Gateway | BPMN parallel gateway (fork/join, all branches) |
| `event-gateway` | Event Gateway | Event-Based Gateway | BPMN event-based gateway (first competing event wins, siblings cancelled) |
| `message-catch` | Message Catch | Intermediate Catch Event (message) | BPMN message catch — wait for a correlated message |
| `timer` | Timer Catch | Intermediate Catch Event (timer, duration form) | BPMN timer catch — wait for a duration |
| `signal` | Signal Catch | Intermediate Catch Event (signal) | BPMN signal catch — wait for a broadcast |

> **What "replaced" means.** APL is not a BPMN dialect; it is the canonical
> authoring format. The Studio canvas serializes to APL and the engine parses
> APL natively — BPMN XML remains an *import/export* format. When a node is
> listed as "replaces" a BPMN pattern, it means the same intent expressed in
> BPMN would require that element (or that combination of elements), and APL
> gives you a simpler, stricter, one-block form.

---

## 3. Properties shared by every node

All 14 node types share these base fields:

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `id` | string | yes | Unique name of the node inside the process. Becomes the BPMN element id. Letters, numbers and underscores are safe. |
| `type` | string | yes | The node kind (one of the left column of §2). |
| `description` | string | no | A human-readable name for the node. Becomes the BPMN element `name`. **For an approval gate this is the task name people see.** |
| `next` | nodeId | depends | The id of the node that runs next. Required on linear nodes; forbidden on branching nodes (`condition`, `event-gateway`, and `parallel`/`inclusive` forks). |
| `ui` | `{ x, y }` | no | Canvas layout hint (where Studio draws the node). Ignored by the engine. |

---

## 4. Node-by-node reference

### 4.1 Start Event — `webhook`

**What it does.** The entry point of your process. A process instance starts
when this trigger fires — in practice an incoming API call or the "start
process" action from an application. The payload of that call becomes the
instance's initial variables.

**When to use it.** Every process needs exactly one. It is the node the flow
begins at.

**BPMN equivalent.** Start Event (webhook trigger). APL declares a single
start node per process; the engine enforces this (a second `webhook` is a
deployment error).

**Properties.**

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `next` | nodeId | yes | The first executable step of the process. |

The webhook node itself has **no URL property** — the engine does not generate
a per-process inbound URL. External applications start the process by calling
the engine's REST API with the process key; the request body becomes the
instance's initial variables:

- Project-scoped: `POST /api/v1/projects/{projectId}/processes/{processKey}/start`
- Global: `POST /api/v1/processes/start?processId={processKey}`

Both accept an optional `Idempotency-Key` header so retries do not create
duplicate instances, and both require the caller to be authenticated with
permission to start the process. If you need a stable inbound URL that an
external system (a SaaS webhook, a partner service) can POST to without
knowing the API, that is a separate inbound-webhook feature, not part of the
`webhook` node.

**Example.**

```yaml
- id: onStart
  type: webhook
  description: Loan application received
  next: extractAgent
```

---

### 4.2 End Event — `end`

**What it does.** The finish line. When a token reaches an end node, that
branch of the process is done; when the last token arrives, the process
instance completes.

**When to use it.** At every point where the flow may finish. A process can
have several end nodes (one per outcome branch).

**BPMN equivalent.** End Event.

**Properties.**

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| — | — | — | No extra properties. `next` is forbidden — an end node has no successor. |

**Example.**

```yaml
- id: done
  type: end
  description: Onboarding concluded
```

---

### 4.3 AI Agent — `agent`

**What it does.** A step that delegates probabilistic work to an AI model —
reading, extracting, judging, drafting. The agent runs on an **external
worker** (a separate process that picks the job up, calls the model, and
reports back). The engine never advances the process from inside the agent; a
worker completion is what moves the flow on. This keeps AI work honest:
probabilistic output can never silently corrupt the workflow state.

**When to use it.** Any step where the "right answer" is not deterministic —
e.g. extracting fields from an unstructured document, or a judgment call.

**BPMN equivalent.** Service Task executed as an external task on the reserved
topic `abada:agent`. APL replaces the ad-hoc "LLM service task" pattern with a
typed node plus a versioned worker profile (`abada.agent/v1`).

**Properties.**

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `profile` | string | no | Worker profile version. Default and only supported value: `abada.agent/v1`. |
| `model` | string | no | The model to use. Omitted → the worker's default model. Must be on the engine's allowed-model list. |
| `prompt` | string | no | The instructions given to the model. Multi-line YAML blocks are fine. |
| `inputs` | map | no | Named bindings from process variables to prompt inputs, e.g. `payload: ${payload}`. |
| `result_variable` | string | no | The variable the agent's output is written to. Defaults to `<nodeId>_result`. |
| `output_schema` | map | no | Expected JSON shape of the response. The worker validates against it. |
| `tools` | string[] | no | Tool identifiers the agent may use (e.g. `database.read`). Enforced against the worker allowlist. |
| `confidence_threshold` | number | no | 0–100. Below this confidence the output is treated as a low-confidence result. |
| `temperature` | number | no | 0–2. Higher = more creative, lower = more deterministic. Default 0.2. |
| `max_tokens` | integer | no | Cap on the model response size. Default 2048. |
| `timeout_ms` | integer | no | Worker call timeout. Default 60 000. |
| `max_attempts` | integer | no | Durable retries before the job fails. Default 3. |
| `retry_backoff_ms` | integer | no | Pause between retries. Default 2 000. |
| `next` | nodeId | yes | The step that runs after the agent completes. |

**Example.**

```yaml
- id: extractAgent
  type: agent
  description: Extract structured application data
  model: gemini-3.6-flash
  prompt: |
    Extract {income, creditScore, requestedAmount} from the payload.
    Return strict JSON only.
  inputs:
    payload: ${payload}
  result_variable: extracted
  confidence_threshold: 85
  next: creditRules
```

---

### 4.4 Engine Task — `engine-task`

**What it does.** A step that hands work to an external system on a named
**topic**. Workers subscribe to that topic, pick the durable job up, do the
work, and report back. This is the standard "call an integration / webhook
sink / microservice" step — the deterministic sibling of the AI agent.

**When to use it.** Any service call your own workers (or partner workers)
perform: persisting records, calling a webhook, integrating with an ERP, etc.

**BPMN equivalent.** Service Task executed as an external task on the declared
topic. APL replaces the Camunda external-task pattern with a typed node.

**Properties.**

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `service` | string | yes | The topic workers subscribe to, e.g. `decision.record`. |
| `on_error` | nodeId | no | A node to route to on failure. Studio draws it as an error edge. |
| `next` | nodeId | yes | The step that runs after the task completes. |

**Example.**

```yaml
- id: persist
  type: engine-task
  description: Persist decision record
  service: decision.record
  next: done
```

---

### 4.5 Script Step — `script`

**What it does.** A small server-side JavaScript snippet the engine runs
**inside the workflow transaction** — no worker, no network call. All instance
variables are available by name, plus a `variables` map. This is the APL form
of an embedded Java delegate.

**When to use it.** Fast, deterministic, in-process work: derive a value,
transform data, compute a flag. Do **not** use it for slow or unreliable calls
(that is what `engine-task` is for) — the transaction stays open while the
script runs.

**BPMN equivalent.** Script Task. APL replaces `camunda:class` Java delegates
with inline JavaScript.

**Properties.**

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `script` | string | yes | The JavaScript body. A blank body is rejected at deployment. |
| `format` | string | no | Script engine name. Default `javascript`. |
| `next` | nodeId | yes | The step that runs after the script. |

**Example.**

```yaml
- id: deriveTier
  type: script
  description: Derive the shipping tier
  script: |
    variables.put('shippingTier', variables.orderValue >= 100 ? 'premium' : 'standard');
  next: done
```

---

### 4.6 Approval Gate — `approval-gate`

**What it does.** A human review step. The engine creates a task that a person
(or the listed groups) must complete before the flow continues. The task name
people see is the node's `description`.

**When to use it.** Any step that requires human judgment, sign-off or data
entry: approving a loan, reviewing a claim, filling in a missing field.

**BPMN equivalent.** User Task with candidate groups.

**Properties.**

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `assignees` | string[] | yes | The groups (or users) who may claim the task, e.g. `[risk-officers]`. At least one is required. |
| `mode` | `serial` \| `parallel` | no | Authoring hint. `parallel` with more than one assignee implies a double sign-off. |
| `sla_hours` | number | no | Service-level target for monitoring (e.g. 24 = resolve within 24 h). |
| `next` | nodeId | yes | The step that runs after the task is completed. |

**Example.**

```yaml
- id: approvalGate
  type: approval-gate
  description: Senior credit officer sign-off
  assignees: [risk-officers]
  mode: serial
  sla_hours: 24
  next: routing
```

---

### 4.7 DMN Rule Table — `decision-table`

**What it does.** A deterministic decision table — the same idea as a DMN
table, but executed by the engine itself **inside the workflow transaction**.
You declare inputs (expressions over instance variables), a list of ordered
rules, and the outputs each rule produces. No AI involved: the same inputs
always give the same decision, and every application is audited.

**When to use it.** Any policy that can be written as if-then rules: credit
scoring, risk classification, entitlement checks. This is the "law" that
constrains AI agents in the Abada doctrine.

**BPMN equivalent.** Business Rule Task with a DMN table. APL replaces the
external DMN-table binding with a native in-transaction table.

**Properties.**

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `decisionKey` | string | no | Stable audit key for the table. Defaults to `DMN_<nodeId>`. |
| `hitPolicy` | `FIRST` \| `UNIQUE` \| `COLLECT` | no | How to apply matching rules. Default `FIRST`. |
| `inputs` | array \| map | no | The inputs the rules test against, each bound to a variable expression, e.g. `score: "${applicant.creditScore}"`. |
| `rules` | array | yes | The ordered rules (§4.7.1). At least one is required. |
| `next` | nodeId | yes | The step that runs after the decision is applied. |

**Hit policies, simply:**

| Policy | What it means |
| --- | --- |
| `FIRST` | The first matching rule (top to bottom) wins. |
| `UNIQUE` | Exactly one rule may match. More than one → the step fails and rolls back. |
| `COLLECT` | Every matching rule's outputs are merged (later rules win name conflicts). |

**4.7.1 Rules.** Each rule is either a `when` rule or the fallback:

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `when` | string | yes* | The condition, evaluated against the resolved input names, e.g. `score >= 750 and income >= 60000`. |
| `otherwise` | boolean \| map | no | Marks the fallback rule — applied when no `when` rule matches. At most one per table. |
| `then` | map | yes | The outputs written to instance variables, e.g. `{ riskLevel: LOW, autoApprove: true }`. |

\* required unless the rule is the `otherwise` fallback.

**Example.**

```yaml
- id: creditRules
  type: decision-table
  description: Credit risk classification
  decisionKey: DMN_CREDIT_V1
  hitPolicy: FIRST
  inputs:
    score: "${applicant.creditScore}"
    income: "${applicant.annualIncome}"
  rules:
    - when: "score >= 750 and income >= 60000"
      then: { riskLevel: LOW, autoApprove: true }
    - otherwise: true
      then: { riskLevel: HIGH, autoApprove: false }
  next: approvalGate
```

---

### 4.8 Exclusive Gateway — `condition`

**What it does.** An **either/or** router. The flow arrives, the conditions
are evaluated in order, and **exactly one** branch is taken. If no condition
matches, the flow takes the default branch (the `else` rule — or the last
rule when no `else` is declared).

**When to use it.** Routing on a single value or decision: "if low risk →
notify, otherwise → screen for fraud".

**BPMN equivalent.** Exclusive Gateway with a default flow.

**Properties.** Routes via `rules` — `next` must not be set.

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `rules[].if` | string | yes* | The condition expression, e.g. `${riskLevel == 'LOW'}`. |
| `rules[].else` | nodeId | no | The id of the default branch target — taken when no condition matches. |
| `rules[].then` | nodeId | yes | The id of the node this branch routes to. |

\* required unless the rule is the `else` default.

**Example.**

```yaml
- id: routing
  type: condition
  description: Route by risk
  rules:
    - if: "${riskLevel == 'LOW'}"
      then: notify
    - else: persist
      then: persist
```

---

### 4.9 Parallel Gateway — `parallel`

**What it does.** A **fork/join** switch for running branches *at the same
time*. As a **fork** it sends one token down every declared branch
unconditionally. As a **join** it waits until every one of those branches has
arrived, then continues.

**When to use it.** Steps that must all happen and none depends on the others
— e.g. run a credit check and a fraud check concurrently, then merge.

**BPMN equivalent.** Parallel Gateway.

**Properties.** One form per role:

| Form | Property | Type | Required | What it does |
| --- | --- | --- | --- | --- |
| Fork | `branches` | nodeId[] | yes | At least two distinct node ids; one token is sent to each. `next` forbidden. |
| Join | `next` | nodeId | yes | The single successor after every branch token arrives. `branches` omitted. |

**Example.**

```yaml
- id: fanout
  type: parallel
  description: Run credit and fraud checks concurrently
  branches:
    - creditDesk
    - fraudDesk

- id: rejoin           # both creditDesk and fraudDesk route here
  type: parallel
  next: archive
```

---

### 4.10 Inclusive Gateway — `inclusive`

**What it does.** A "**every branch that matches**" router. As a **fork** it
evaluates each rule and sends a token down **every branch whose condition
matches** — zero, one, or several. If nothing matches, the explicit `else`
rule fires; without an `else`, the step fails loudly (the engine never guesses
an empty route). As a **join** it waits for exactly the branches it actually
started, then continues.

**When to use it.** Combinations of conditions, e.g. "notify the customer AND
notify the broker if both flags are set", where the two paths partially
overlap.

**BPMN equivalent.** Inclusive Gateway.

**Properties.** One form per role:

| Form | Property | Type | Required | What it does |
| --- | --- | --- | --- | --- |
| Fork | `rules[].if` | string | yes* | Condition expression; every matching rule fires a token. |
| Fork | `rules[].else` | nodeId | no | Default branch — fires when no rule matches. Only way to declare a default. |
| Fork | `rules[].then` | nodeId | yes | The target node of this branch. |
| Join | `next` | nodeId | yes | The single successor after the started branches arrive. |

\* required unless the rule is the `else` default.

**Example.**

```yaml
- id: route
  type: inclusive
  description: Route by path
  rules:
    - if: "${path == 'C' || path == 'CD'}"
      then: taskC
    - if: "${path == 'D' || path == 'CD'}"
      then: taskD

- id: rejoin           # taskC and taskD both route here
  type: inclusive
  next: archive
```

---

### 4.11 Event Gateway — `event-gateway`

**What it does.** A **race** between competing waits. The process registers a
wait on every catch child (a message, a timer, or a signal) at the same time.
The **first one to fire wins**: the flow continues down that child's path, and
every sibling wait is cancelled in the same transaction — a late loser can
never trigger a duplicate transition. Pending races survive a restart.

**When to use it.** "First of several things happens" scenarios: wait for a
fast-track message *or* a one-hour timeout, whichever comes first.

**BPMN equivalent.** Event-Based Gateway with intermediate catch events.

**Properties.** Routes via `events` — `next` must not be set. At least **two**
competing children are required.

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `events[].type` | `message-catch` \| `timer` \| `signal` | yes | What this child waits on. |
| `events[].message` | string | message-catch | The message name. Correlated against the `correlationKey` variable. |
| `events[].duration` | string | timer | ISO-8601 duration, e.g. `PT1H` (one hour). |
| `events[].signal` | string | signal | The broadcast signal name. |
| `events[].next` | nodeId | yes | The node that runs if **this** child wins the race. |

**Example.**

```yaml
- id: eventRace
  type: event-gateway
  description: FastTrack or timeout
  events:
    - type: message-catch
      description: Fast-track the review
      message: FastTrackMessage
      next: rejoin
    - type: timer
      description: Escalate after an hour
      duration: PT1H
      next: rejoin
```

---

### 4.12 Message Catch — `message-catch`

**What it does.** Pauses the process until a **message** arrives. The instance
registers a durable subscription; when a message with this name arrives and
correlates against the `correlationKey` variable, the process resumes.

**When to use it.** Waiting on an external system's asynchronous response
(approval from another service, a webhook callback, a human pressing a
button in another app).

**BPMN equivalent.** Intermediate Catch Event (message).

**Properties.**

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `message` | string | yes | The message name the runtime matches during correlation. |
| `next` | nodeId | yes | The node that runs after the message arrives. |

**Example.**

```yaml
- id: catchFastTrack
  type: message-catch
  description: Wait for the fast-track message
  message: FastTrackMessage
  next: done
```

---

### 4.13 Timer Catch — `timer`

**What it does.** Pauses the process for a fixed **duration**, then resumes.
The wait is durable: the engine schedules a job and the process survives a
restart while waiting.

**When to use it.** Time-based waits: "wait one hour", "give the human 24 h
before escalating".

**BPMN equivalent.** Intermediate Catch Event (timer, duration form).

**Properties.**

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `duration` | string | yes | ISO-8601 duration, e.g. `PT1H`, `PT30M`, `P1D`. Validated at deployment. |
| `next` | nodeId | yes | The node that runs when the timer fires. |

**Example.**

```yaml
- id: catchTimeout
  type: timer
  description: Wait one hour
  duration: PT1H
  next: done
```

---

### 4.14 Signal Catch — `signal`

**What it does.** Pauses the process until a **broadcast signal** fires.
Unlike a message (which correlates to one specific instance), a signal is
broadcast: one signal resumes **every** waiting instance subscribed to that
name.

**When to use it.** Fan-out notifications shared across many process
instances — "the freeze is lifted", "it's GO time", "proceed to release".

**BPMN equivalent.** Intermediate Catch Event (signal).

**Properties.**

| Property | Type | Required | What it does |
| --- | --- | --- | --- |
| `signal` | string | yes | The broadcast signal name. |
| `next` | nodeId | yes | The node that runs when the signal fires. |

**Example.**

```yaml
- id: catchGo
  type: signal
  description: Wait for the go signal
  signal: proceed
  next: done
```

---

## 5. Gateway forms at a glance

Four nodes can act as **forks** (split one token into several) and three as
**joins** (wait for several tokens, then continue). This table summarizes the
two forms so the property panel can guide authors to the right shape.

| Node | Fork — how you declare it | Join — how you declare it |
| --- | --- | --- |
| `condition` (exclusive) | `rules` with `if`/`else`; **exactly one** branch is taken | n/a — an exclusive gateway never joins |
| `parallel` | `branches` (≥2) — all fire unconditionally | `next` — waits for **every** branch |
| `inclusive` | `rules` — every matching `if` fires; `else` is the only default | `next` — waits for the branches it **actually started** |
| `event-gateway` | inline `events` (≥2) — waits on all, **first to fire wins**, rest cancelled | n/a — children route to downstream nodes; a downstream join counts it as one logical stream |

Forks and joins are the **same node type** in APL — the shape you give it
(`branches`/`rules`/`events` vs. `next`) decides which role it plays. The
engine rejects mixing the two forms (`branches` + `next`, `rules` + `next`,
`events` + `next`).

---

## 6. Using this document to drive the Studio property panel

The property tables above are the contract for each node's configuration
panel:

- Every **Required** property must be editable from the panel, and the panel
  should flag it while empty.
- Every optional property is something the panel may expose; where a default
  exists (e.g. agent `temperature` = 0.2), the panel should show the default
  when the field is left empty, exactly as the engine would apply it.
- **Fork/join nodes** (§5) should offer a clear "fork vs. join" shape selector
  and only show the relevant fields for the chosen role.
- The **BPMN equivalent** column is author-facing context: the panel can show
  it as a subtitle ("compiles to: User Task") to help BPMN-savvy authors
  orient themselves.

See the [technical specification](apl-specification.md) for validation rules,
error codes, and the complete production example.
