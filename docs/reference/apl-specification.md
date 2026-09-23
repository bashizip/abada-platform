# Abada Process Language (APL) — Technical Specification

- Status: **Implemented** — Studio deploys native YAML and `AplParser`
  compiles it directly to the executable graph. BPMN remains an import and
  backward-compatibility format.
- Version documented: `abada.io/v1`
- Applies to: Abada Studio authoring pipeline and the Abada Engine deployment
  contract. Relates to [ADR-002](../adr/ADR-002-native-decision-tables-deterministic-wall.md),
  [Abada-native BPMN extensions](../bpmn/abada-native-extensions.md),
  [BPMN support](../reference/bpmn-support.md) and
  [runtime semantics](../reference/runtime-semantics.md).

---

## 1. Overview & Design Philosophy

APL (Abada Process Language) is Abada's YAML-based process definition
language. It is the canonical, human-readable representation of a workflow in
**Abada Studio**: the canvas is serialized to APL and deployed as YAML. The
engine parses it natively and stores the immutable source in PostgreSQL. BPMN
can be imported and converted to APL; legacy BPMN deployments remain runnable.

> **Plain-language guide:** for a node-by-node walkthrough with simple
explanations, every property, and the BPMN equivalent of each node, see
[APL Node Reference](apl-node-reference.md). It is the companion to this
specification and the contract for the Studio property panel.

### 1.1 Why YAML

- **Human-readable configuration-as-code.** A workflow is a plain text file a
  reviewer can read, diff and version-control. There is no vendor XML
  vocabulary to learn: an `agent` step, an `approval-gate` and a
  `decision-table` are declared with their intent, not with BPMN boilerplate.
- **Comments.** YAML comments (`#`) are first-class citizens. Studio and
  AI-assisted tooling use them to annotate workflows with rationale, policy
  references, and explainability hints that never leak into execution.
- **AI-friendly.** YAML's indentation-based structure and comment support make
  it a stable target for generated edits: an LLM can propose a change to one
  rule of a decision table as a small, reviewable diff.

### 1.2 Runtime architecture

| Concern | Implemented contract |
| --- | --- |
| Authoring format | APL YAML in Studio (`lib/apl/`) |
| Deployment artifact | `.apl.yaml`, `application/yaml`, strict validation |
| Engine input | native APL or backward-compatible BPMN XML through one schema dispatcher |
| Definition store | immutable, versioned, checksummed original source plus `APL_NATIVE` / `BPMN_XML` schema type |

There is no XML compilation step on the native path. Existing BPMN is converted
at the Studio import boundary, not round-tripped during deployment.

### 1.3 Alignment with the platform doctrine

APL expresses the doctrine recorded in ADR-002 — *the table is the law,
agents are the advice*:

- **Agent nodes** (`agent`) represent probabilistic work (LLM calls) and become
  durable external tasks (`abada:agent` topic) that never advance
  BPMN state outside engine commands.
- **Decision tables** (`decision-table`) represent deterministic rules
  executed by the engine **inside the workflow transaction** — reproducible,
  auditable, and impossible to bypass with a model output.
- **Approval gates** (`approval-gate`) put a human between probabilistic and
  deterministic steps.
- **Conditions** (`condition`) route on real instance variables.

---

## 2. Document Structure & Core Syntax

### 2.1 Top-level schema

An APL document is a single YAML mapping with exactly three top-level keys:

```yaml
version: abada.io/v1      # required — document language version
metadata:                 # required — authoring metadata
  name: <string>          # required — becomes the process key/id (sanitized)
  owner: <string>         # optional
  category: <string>      # optional — workflow category
flow:                     # required — the executable graph
  entry: <nodeId>         # required — id of the start node
  nodes: [ <APLNode>, ... ]  # required — at least one node
```

- `version` is currently `abada.io/v1`. It is the APL language version, not a
  process semantic version.
- `metadata.name` is sanitized to a process key at compile time: all
  non-alphanumeric characters become `_` and the result is lowercased
  (e.g. `KYC Onboarding V1` → `kyc_onboarding_v1`). The engine keys
  definitions and versions by this id.
- `flow.entry` identifies the start node. Studio derives it from the
  `webhook` node when serializing. `AplParser` enforces that it references the
  document's single webhook start.

### 2.2 Node base shape

Every node in `flow.nodes` is a mapping with the following common keys:

```yaml
- id: <string>          # required — unique within the document; becomes the BPMN element id
  type: <APLNodeType>   # required — see §3
  description: <string> # optional — becomes the BPMN element name
  next: <nodeId>        # optional — linear successor (forbidden on `condition`)
  ui: { x: <int>, y: <int> }  # optional — layout hint for Studio rendering
```

- `id` must be unique and is used as the BPMN element id verbatim.
- `description` becomes the BPMN `name` attribute. **Important:** for
  `approval-gate` the description is what the engine shows as the task name —
  the Studio Run panel matches tasks against it.
- `next` wires the linear sequence flow (`sourceRef → targetRef`). `condition`
  and `parallel` nodes must **not** set `next` together with their
  branching key (`rules` / `branches`); see §3.4 and §3.8.

### 2.3 Formatting conventions

- Two-space indentation; one node per list item under `flow.nodes`.
- Node type is always the second key after `id` for readability.
- **Comments** are encouraged above any node whose intent is not obvious,
  especially inside decision tables (each `when` clause benefits from a
  one-line rationale). Comments are preserved by the Studio round trip but are
  never emitted into compiled BPMN.
- String expressions that reference variables must use the `${...}` form
  (§5). Free-text labels are descriptions and must never be confused with
  conditions.

### 2.4 Canonical vs. vision-compatible forms

APL accepts two shapes for some constructs and always **stringifies to the
canonical vision form**:

| Construct | Accepted input shapes | Canonical serialization |
| --- | --- | --- |
| `decision-table.inputs` | ordered array `[{name, expr}]` **or** map `{name: "${...}"}` | map |
| `decision-table.rules[].otherwise` | flattened `otherwise: true` + sibling `then` **or** wrapper `otherwise: {then: {...}}` | wrapper |

`normalizeTableInputs` and `resolveRuleOutcome` (Studio `lib/apl/parser.ts`)
are the single implementation of these normalizations, so hand-authored,
AI-generated and Studio-authored APL converge on one shape.

---

## 3. Node Types & Primitives Reference

The current APL node vocabulary (Studio `lib/apl/types.ts`):

```
webhook | agent | engine-task | script | condition | approval-gate | decision-table | inclusive | parallel | event-gateway | message-catch | timer | signal | end
```

### 3.1 `webhook` — trigger node

Compiles to the runtime start-event primitive. One document has exactly one webhook.

```yaml
- id: onStart
  type: webhook
  description: Loan application received
  next: extractAgent
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | becomes the start event id |
| `description` | string | no | start event name |
| `next` | nodeId | yes | the first executable step |

Engine behavior: starting an instance begins token execution from the start
event; the initial payload is the top-level instance variable map.

### 3.2 `agent` — LLM execution node

Compiles directly to a service-task node that creates an **external task** on
topic `abada:agent`. Its optional `agentWork` payload follows the versioned
`abada.agent/v1` external-worker profile. Agents are probabilistic and are the
"advice" in the ADR-002 doctrine.

```yaml
- id: extractAgent
  type: agent
  profile: abada.agent/v1
  description: Extract structured application data
  model: gemini-3.6-flash
  prompt: |
    Extract {income, creditScore, requestedAmount} from the payload.
    Return strict JSON only.
  tools:
    - database.read
  inputs:
    payload: ${payload}
  result_variable: extracted
  output_schema: { type: object }
  confidence_threshold: 85
  temperature: 0.2
  max_tokens: 2048
  timeout_ms: 60000
  max_attempts: 3
  retry_backoff_ms: 2000
  next: creditRules
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `profile` | string | no | default and only supported value: `abada.agent/v1` |
| `model` | string | no | worker/provider model; worker default when omitted |
| `prompt` | string | no | multi-line YAML block scalars supported |
| `inputs` | map | no | named process-variable bindings |
| `result_variable` | string | no | completion variable; default `<nodeId>_result` |
| `output_schema` | map | no | requires a JSON-object response |
| `tools` | string[] | no | requested identifiers, enforced against the worker allowlist |
| `confidence_threshold` | number | no | 0–100 |
| `temperature` | number | no | 0–2 |
| `max_tokens` | integer | no | positive provider response bound |
| `timeout_ms` | integer | no | 1–3,600,000 |
| `max_attempts` | integer | no | 1–20 durable attempts |
| `retry_backoff_ms` | integer | no | 0–3,600,000 |
| `on_low_confidence` | nodeId | no | route when `_confidence` is missing or below `confidence_threshold` |
| `on_invalid_output` | nodeId | no | route when the result violates `output_schema` or the completion shape |
| `on_error` | nodeId or `[{code?, then}]` | no | route for a worker-reported BPMN error, optionally per error code |
| `next` | nodeId | yes | linear successor |

**Data the agent receives (default-deny).** The locked task carries only the
node's `inputs`, resolved by the engine and keyed by input name. When `inputs`
is omitted, the engine derives them from the prompt's `${path}` placeholders
(for example `${lead.companySize}`). A placeholder that is not a declared input
(or a path inside one) is rejected at deployment, and placeholders must be
variable paths, not expressions. The reference worker never puts workflow data
in the system message: placeholders become `<input name="…"/>` references and
values travel in the user message.

**Output contract (engine-enforced).** On completion the engine checks, in
the completion transaction, that:

1. the worker wrote only `result_variable`;
2. the value matches `output_schema` (JSON Schema 2020-12; a malformed
   schema is rejected at deployment);
3. with `confidence_threshold` above 0, the value is an object whose numeric
   `_confidence` (0–100) meets the threshold. **A missing score fails the
   threshold**, so declare an `output_schema` whenever you set a threshold.

`_confidence` is removed from the stored value. The outcome is `OK`,
`INVALID_OUTPUT` or `LOW_CONFIDENCE`. A rejected result with a matching route
completes the task and follows the route, and the engine writes the
`<node>_outcome` variable (`-` in node ids becomes `_`). For `LOW_CONFIDENCE`
the result is kept under `result_variable` for the reviewer; for
`INVALID_OUTPUT` the raw text is kept in `<node>_raw_output` (at most
16 KB). Without a route, the rejection counts as a failed attempt: retries
are decremented, and at zero the task becomes an incident. Every decision is
recorded in history (`agentOutcome`, `outcomeReason`) without variable values.

Routes compile to a synthetic exclusive gateway `<node>__outcome` (the suffix
`__outcome` is reserved in node ids) whose default flow is `next`.

Boundary: with no worker deployed, a run pauses in `ACTIVE` at the agent —
this is intentional (agents must not advance BPMN state outside engine
commands).

The reference sidecar, retry/idempotency behavior, OIDC configuration, and
at-least-once boundary are defined in [Agent worker](agent-worker.md).

### 3.3 `engine-task` — standard service task

Compiles to the runtime external service-task primitive on `service`. This is the
"standard service task" primitive: any durable worker topic (system service,
integration, webhook sink). It is the deterministic sibling of `agent`.

```yaml
- id: persist
  type: engine-task
  description: Persist decision record
  service: decision.record
  next: done
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `service` | string | yes | external task topic |
| `on_error` | nodeId or `[{code?, then}]` | no | route taken when the worker reports a BPMN error: a single target, or per `code` with an optional code-less catch-all. The engine writes `<node>_outcome = 'ERROR'` and `<node>_error_code`. A BPMN error without a matching route still fails the instance |
| `next` | nodeId | yes | linear successor |

### 3.4 `script` — in-transaction script step

Compiles to the runtime script task, executed by the engine inside the
workflow transaction with all instance variables bound by name plus the
`variables` map. This is the APL form of an embedded Java delegate
(`camunda:class`): synchronous, deterministic server-side work.

```yaml
- id: deriveTier
  type: script
  description: Derive the shipping tier
  format: javascript
  script: |
    variables.put('shippingTier', variables.orderValue >= 100 ? 'premium' : 'standard');
  next: done
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `script` | string | yes | JavaScript/ECMAScript body; a blank body is rejected at deployment |
| `format` | string | no | engine script engine name; default `javascript` |
| `next` | nodeId | yes | linear successor |

**Operator opt-in.** Script tasks are rejected at deployment unless the
operator sets `ABADA_SCRIPTS_ENABLED=true` (`abada.scripts.enabled`; the dev
profile enables it, production defaults to off). Scripts run in a sandbox:
`--no-java`, a class filter that denies every Java class, no `load`, and no
Java object in scope — variables enter and leave as JSON. Variables are
available by name and through `variables.get/put`; only variables the script
creates or changes are written back, and numbers come back as doubles.
There is no CPU time limit, so keep scripts small; prefer a decision table or
an `engine-task` worker.

Engine semantics: the script runs inside the advance transaction; a throwing
script rolls the whole command back (state, variables, history and outbox
together). Side effects are at-least-once — applications must make external
side effects idempotent, exactly as with embedded Java delegates.

### 3.5 `condition` — exclusive branching

Compiles to the runtime exclusive gateway. Routes through `rules`; the last rule or
the rule with `else` becomes the gateway **default** flow. `next` must not be
set.

```yaml
- id: routing
  type: condition
  description: Route by risk
  rules:
    - if: "${riskLevel == 'LOW'}"
      then: notify
    - else: persist            # else = target node id (string)
      then: persist
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `rules[].if` | string | no | condition expression (§5); emitted as `bpmn:conditionExpression` |
| `rules[].else` | nodeId | no | **target node id**, not a boolean — marks the default flow |
| `rules[].then` | nodeId | yes | target node id of this branch |

Engine semantics: conditional flows evaluate in order; the default flow is
taken when no condition matches. Studio never emits free-text edge labels as
conditions — only explicit `${...}` expressions are treated as conditions
(`workflowToAPL` guard), keeping deployed gateways deterministic.

### 3.6 `approval-gate` — human validation node

Compiles to the runtime user task with candidate groups from `assignees`.
The engine creates an `AVAILABLE` human task claimable by the listed groups.

```yaml
- id: approvalGate
  type: approval-gate
  description: Senior credit officer sign-off
  assignees: [risk-officers]
  mode: serial
  sla_hours: 24
  next: routing
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `assignees` | string[] | yes | candidate groups/users |
| `mode` | `serial` \| `parallel` | no | Studio hint (parallel + >1 assignee implies double sign-off) |
| `sla_hours` | number | no | service-level hint for monitoring |
| `next` | nodeId | yes | linear successor |

Engine behavior: task name = `description` (the Studio Run panel matches this),
assignment follows the Abada assignment semantics (`direct`/`claim`, see
`docs/bpmn/assignment-semantics.md`), and completing the task advances the
instance in-transaction.

### 3.7 `decision-table` — native deterministic decision table

Compiles to the native deterministic decision-table primitive. Full contract in §4.

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

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `decisionKey` | string | no | stable audit key; defaults to `DMN_<NODE_ID>` |
| `hitPolicy` | `FIRST` \| `UNIQUE` \| `COLLECT` | no | default `FIRST`; engine rejects others |
| `inputs` | array \| map | no | input declarations (name + `${...}` expr) |
| `rules` | array | yes | ordered rules; see §4.2 |
| `next` | nodeId | yes | linear successor |

### 3.8 `parallel` — fork / join gateway

Compiles to the runtime parallel gateway. A `parallel` node is a **fork** when
it declares `branches` (one token per branch, created unconditionally) and a
**join** when several upstream nodes converge on it via their `next` and it
continues along its single `next` successor. `branches` and `next` are
mutually exclusive.

```yaml
- id: fanout
  type: parallel
  description: Run credit and fraud checks concurrently
  branches:
    - creditDesk
    - fraudDesk
- id: rejoin               # join: creditDesk and fraudDesk both point here
  type: parallel
  next: archive
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `branches` | nodeId[] | fork | ≥2 distinct declared targets; each gets an unconditional flow |
| `next` | nodeId | join | single successor after all incoming tokens arrive |

Engine semantics: a fork emits one token per branch and records the expected
join token count; the join blocks token passage until every upstream branch
arrives. Join token bookkeeping (`joinExpectedTokens` / `joinArrivedTokens`)
persists with the instance and survives restart. Studio draws the fork's
branches as plain outgoing edges; conditions are never attached to parallel
flows.

### 3.9 `event-gateway` — competing-event gateway

Compiles to the runtime event-based gateway. An `event-gateway` node declares
an inline `events` list of **≥2 competing catch children** (message-catch,
timer or signal). The gateway forks one durable wait state per child; the
**first child to fire wins** and the engine cancels every sibling wait state
(subscription, timer job and token) in the same transaction, so a late loser
can never produce a duplicate transition. Pending races persist and survive
restart. `next` must not be set — the gateway routes exclusively through its
`events`.

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

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `events[]` | array | yes | ≥2 competing catch children |
| `events[].type` | `message-catch` \| `timer` \| `signal` | yes | the competing wait type |
| `events[].message` | string | message-catch | message name, correlated against `correlationKey` |
| `events[].duration` | string | timer | ISO-8601 duration; validated with `Duration.parse` at deploy |
| `events[].signal` | string | signal | broadcast signal name |
| `events[].next` | nodeId | yes | sole successor when this child wins |

Engine semantics: each child compiles to an intermediate catch event wired from
an `eventBasedGateway`; all children are active wait tokens until one fires.
The winning child's `next` advances the instance and the losing wait states are
cancelled atomically with that advancement (sibling message/signal
subscriptions are consumed, sibling timer jobs become `CANCELLED` and sibling
tokens leave the active set). A downstream join counts an event gateway as one
logical stream no matter how many of its children converge on the join.

### 3.10 `inclusive` — inclusive fork / join gateway

Compiles to the runtime inclusive gateway. An `inclusive` node is a **fork**
when it declares `rules`: **every** matching `if` rule fires (zero or more
tokens). An explicit `else` rule is the only way to declare a default flow —
when no rule matches and no `else` exists, the command fails loudly and rolls
back, exactly like a BPMN inclusive gateway without a `default` flow. A
**join** is an `inclusive` node on which several upstream nodes converge via
their `next` and which continues along its single `next` successor.

```yaml
- id: route
  type: inclusive
  description: Route by path
  rules:
    - if: "${path == 'C' || path == 'CD'}"
      then: taskC
    - if: "${path == 'D' || path == 'CD'}"
      then: taskD
- id: rejoin            # join: taskC and taskD both route here
  type: inclusive
  next: archive
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `rules[].if` | string | fork | condition expression (§5); every matching rule fires |
| `rules[].else` | nodeId | fork | **target node id**; the only default form — fires when no rule matches |
| `rules[].then` | nodeId | fork | target node id of this branch |
| `next` | nodeId | join | single successor after all expected tokens arrive |

Engine semantics: the inclusive join waits for as many tokens as the fork
actually spawned (`chooseInclusive`), not for every upstream edge — partial
matches join correctly. Join token bookkeeping persists with the instance and
survives restart.

### 3.11 `message-catch` — message subscription node

Compiles to a message intermediate catch event. The instance suspends on a
durable subscription and resumes only when a message with this name is
correlated against the instance variable `correlationKey` — identical
semantics to the BPMN message catch (the runtime correlation contract is
documented in `runtime-semantics.md`).

```yaml
- id: catchFastTrack
  type: message-catch
  description: Wait for the fast-track message
  message: FastTrackMessage
  next: done
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `message` | string | yes | message name the runtime matches during correlation |
| `next` | nodeId | yes | sole successor after correlation |

Engine semantics: on arrival the runtime registers the suspension in the same
transaction as the waiting token (restart-safe); correlation resumes the
instance inside the mutating command transaction and any failure rolls the
instance back to waiting.

### 3.12 `timer` — duration timer node

Compiles to a timer intermediate catch event with a duration definition. The
instance suspends and the durable job scheduler resumes it once the ISO-8601
duration has elapsed.

```yaml
- id: catchTimeout
  type: timer
  description: Wait one hour
  duration: PT1H
  next: done
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `duration` | string | yes | ISO-8601 duration (`PT1H`); validated with `Duration.parse` at deploy time |
| `next` | nodeId | yes | sole successor after the timer fires |

Engine semantics: the timer is scheduled as a durable job in the same
transaction as the suspension; on expiry the job command advances the process
with the usual optimistic-lock and rollback guarantees.

### 3.13 `signal` — broadcast signal node

Compiles to a signal intermediate catch event. The instance suspends on a
durable subscription and resumes when a signal with this name is broadcast —
one broadcast resumes every waiting instance subscribed to that name.

```yaml
- id: catchGo
  type: signal
  description: Wait for the go signal
  signal: proceed
  next: done
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `signal` | string | yes | signal name the runtime matches during broadcast |
| `next` | nodeId | yes | sole successor after the signal fires |

### 3.14 `end` — terminal node

Compiles to the runtime end-event primitive. Completes the instance when the last token
arrives.

```yaml
- id: done
  type: end
  description: Onboarding concluded
```

---

## 4. Native Decision Tables (ADR-002 Integration)

The `decision-table` node is the YAML surface of the native
`abada:decisionTable` extension executed in-transaction — the deterministic
wall constraining agents. This section is the ADR-002 contract expressed in
APL.

### 4.1 Compiled XML shape

```yaml
# APL                                # compiled BPMN (abada namespace)
decisionKey: DMN_CREDIT_V1   ───►    <abada:decisionTable decisionKey="DMN_CREDIT_V1" hitPolicy="FIRST">
hitPolicy: FIRST
inputs:                              <abada:input name="score" expr="${applicant.creditScore}" />
  score: "${applicant.creditScore}"
rules:                               <abada:rule when="score >= 750 and income >= 60000">
  - when: "score >= 750 and income >= 60000"
    then: { riskLevel: LOW }            <abada:output name="riskLevel" value="LOW" />
  - otherwise: true
    then: { riskLevel: HIGH }           <abada:rule otherwise="true"> ...
```

The `abada` namespace (`https://abada.io/schema/bpmn`) is declared on the
`bpmn:definitions` root. Output values are typed in APL (string | number |
boolean) and serialized as strings; the engine coerces `true`/`false`, integers
and decimals back to typed values at parse time.

### 4.2 Rules

A rule is evaluated against the **resolved input names** (not raw variable
paths):

```yaml
rules:
  - when: "score >= 750 and income >= 60000"   # condition over input names
    then: { riskLevel: LOW, autoApprove: true }  # typed outputs
  - otherwise: true
    then: { riskLevel: HIGH, autoApprove: false }
```

- `when` — a CEL condition over the input names (§5).
  Optional if `otherwise` is set.
- `otherwise` — the explicit fallback. Accepted as the flattened form above or
  the wrapper `otherwise: { then: {...} }`.
- `then` — a mapping of output **name → value** (`APLValue`: string | number |
  boolean).

### 4.3 Hit policies

| Policy | Behavior |
| --- | --- |
| `FIRST` (default) | first matching rule (in model order) wins |
| `UNIQUE` | exactly one rule may match; more than one **fails the command** |
| `COLLECT` | outputs of **every** matching rule are merged (later rules override on name collision) |

The engine rejects any other hit policy at deployment
(`ABADA-BPMN-EXTENSION-001`). The Studio property inspector offers exactly
these three.

### 4.4 Mandatory `otherwise` and failure semantics

- When no rule matches and an `otherwise` rule exists, the `otherwise` rule
  applies.
- When no rule matches and **no** `otherwise` rule exists, evaluation throws,
  the workflow transaction **rolls back** (state, variables, history and
  outbox together), and the start/advance command fails loudly. The engine
  never guesses a decision.
- More than one `otherwise` rule in a table is a deployment error.

### 4.5 Transactional execution and audit

- Inputs are resolved from instance variables at evaluation time (`${...}` or
  bare name).
- Outputs are written to **top-level instance variables** inside the same
  transaction that advances the process.
- Every application is recorded as a `DECISION_TABLE_APPLIED` history event
  carrying `decisionKey`, `matchedRuleIndexes`, `inputNames` and
  `outputNames` — identifiers only, never values.
- Because execution is in-transaction, a decision that fails evaluation
  (UNIQUE ambiguity or no-match/no-otherwise) rolls back the entire step —
  this is the property the Studio Run panel proves end-to-end.

---

## 5. Expression Language & Variable Scope

### 5.1 `${...}` template syntax

Variable references and conditions use the `${...}` wrapper, consistent with
the EL conventions of the BPMN ecosystem:

| Context | Example | Semantics |
| --- | --- | --- |
| `decision-table.inputs[].expr` | `${applicant.creditScore}` | resolves the input value from instance variables |
| `condition.rules[].if` | `${riskLevel == 'LOW'}` | boolean gate; `${...}` is unwrapped before evaluation |
| `decision-table.rules[].when` | `score >= 750 and income >= 60000` | evaluated against **resolved input names**, so no `${...}` needed (both accepted) |

### 5.2 Evaluator semantics (engine)

Conditions, decision-table rules and decision-table input expressions are
evaluated with **CEL** (the [Common Expression Language](https://github.com/google/cel-spec)),
which is non-Turing-complete, side-effect free and cannot reach the JVM
(`WorkflowExpressions`):

- `${...}` wrappers are unwrapped; `and`, `or`, `eq`, `ne` are rewritten to
  `&&`, `||`, `==`, `!=` outside string literals, so rule authors can write
  either style.
- Supported: comparisons, `&&`, `||`, `!`, arithmetic, `'single'` or
  `"double"` quoted strings, `in`, `size()`, dotted access into nested maps
  (`applicant.creditScore`), `has(applicant.creditScore)` for optional fields,
  and list macros such as `tags.exists(t, t == 'vip')`. Integers and decimals
  compare with each other (`score >= 750` works for `780.5`).
- Not supported: JavaScript or Java syntax (functions, `===`, assignments,
  `Java.type`, method calls on Java objects). Such expressions are rejected
  **at deployment** with `ABADA-APL-VALIDATION-001` (APL) or
  `ABADA-BPMN-EXTENSION-001` (BPMN), naming the node.
- **Failures are loud.** A referenced variable that does not exist, a missing
  map key, a type mismatch, or a condition that does not return a boolean
  raises `ABADA-RUNTIME-EXPRESSION-001`: the command rolls back and the API
  answers HTTP 422 `EXPRESSION_EVALUATION_FAILED` with the node id and the
  missing variable name (never variable values). Test optional data
  explicitly, e.g. `has(order.discountCode) && order.discountCode != ''`.
- A decision-table input that is a plain path (`${applicant.creditScore}`)
  is read directly and keeps its type; an absent path resolves to `null`.
  A rule that then compares `null` with a number fails loudly; a table with
  no matching rule and no `otherwise` still fails loudly per §4.4.
- `abada expressions check <file-or-directory>` lists expressions in APL or
  BPMN files that do not compile as CEL, before an upgrade.

### 5.3 Variable scope

- **Instance-level scope only.** All variables live in one top-level map per
  instance; there is no node-local scope today.
- The instance start payload provides the initial map (`{ applicant: {...},
  loan: {...} }` in Studio's Run panel).
- Decision outputs are written at the top level (`riskLevel`, `autoApprove`),
  so downstream conditions reference them directly (`${riskLevel == 'LOW'}`).
- Nested access uses dot paths (`applicant.creditScore`); array indexing is
  not part of the current subset.

### 5.4 Studio-side convention

`deriveDefaultPayload` (Studio `lib/run/liveRun.ts`) parses `${order.jurisdiction}`
into `payload.order.jurisdiction` for the Run panel editor — the same path
semantics the engine resolves, keeping the authoring and runtime views
consistent.

---

## 6. Validation, Compilation & Error Codes

APL validation is enforced in two layers: the **Studio edit step** provides
immediate syntax and graph feedback, while the Engine's native `AplParser` is
the authoritative semantic gate. Both AI-authored candidates and deployment
sources are parsed directly as APL; neither path requires an XML round-trip.

### 6.1 Studio compile-time checks

| Check | Behavior |
| --- | --- |
| YAML syntax | `parseAPLYaml` fails on malformed YAML |
| `metadata.key` and `metadata.name` present | authoring requires a stable process key and a human-readable name |
| `id` uniqueness / flow wiring | `next`/`rules.then` targets must exist for a valid graph; the compiler emits sequence flows only for declared links |
| Gateway condition discipline | only explicit `${...}` labels become conditions; free text stays a description (never a condition) |
| Parallel branch discipline | `branches` lists ≥2 distinct declared targets and never coexists with `next` |
| Decision-table normalization | `normalizeTableInputs` / `resolveRuleOutcome` collapse map/array and flattened/wrapper forms before emission |

Studio performs fast client-side checks, then the Engine rejects unknown node
types, invalid fields, broken targets and ambiguous graph shapes through
`AplParser`. The authoring endpoint runs that same parser before returning a
candidate and may ask the configured LLM to repair invalid output twice.

### 6.2 Engine deployment-time validation

Deploying native YAML (`POST /v1/processes/deploy`) runs source detection then
strict `AplParser` validation before the executable graph is persisted.
Backward-compatible BPMN input follows the XML compatibility and structural
validation path. Failures abort the deployment transaction.

| Error code | Meaning | Triggered by |
| --- | --- | --- |
| `ABADA-BPMN-XML-001` | XML security / input limits | > 10 MiB deployment; insecure XML |
| `ABADA-BPMN-EXTENSION-001` | unsupported extension | unknown `abada:*` element; unsupported `camunda:*` directive (severity depends on `strict`); disabled compatibility profile; `businessRuleTask` **without** `abada:decisionTable`; decision-table violations (§6.3) |
| `ABADA-BPMN-PROFILE-001` | unknown compatibility profile | unrecognized profile name |
| `ABADA-BPMN-ASSIGNMENT-001..004` | assignment conflicts | conflicting/invalid assignee, candidate user/group |
| `ABADA-BPMN-MIGRATION-001` | uncertain migration | explicit migration when semantics cannot be preserved |
| `ABADA-APL-VALIDATION-001` | native APL rejection | unsupported node type, broken `next`/`rules.then`/`branches` targets, `branches`+`next` combination, cycles, non-webhook entry, an expression that is not valid CEL, a script task while scripts are disabled |

The `strict` parse option escalates vendor-directive warnings to errors;
`strict=false` (Studio default) accepts harmless metadata extensions while
still rejecting execution-relevant directives.

### 6.3 Decision-table validation rules (deployment)

| Rule | Violation → |
| --- | --- |
| at most one `abada:decisionTable` per business rule task | `ABADA-BPMN-EXTENSION-001` |
| hit policy ∈ {FIRST, UNIQUE, COLLECT} | `ABADA-BPMN-EXTENSION-001` |
| at least one rule; every non-`otherwise` rule has `when` | `ABADA-BPMN-EXTENSION-001` |
| at most one `otherwise` rule | `ABADA-BPMN-EXTENSION-001` |
| every input and output has a non-blank `name` | `ABADA-BPMN-EXTENSION-001` |
| output values coercible (boolean / number / string) | value kept as string when not coercible |

### 6.4 Runtime failure modes (fail loudly)

| Situation | Behavior |
| --- | --- |
| `UNIQUE` hit policy, >1 rule matched | `ProcessEngineException`; mutation command rolls back |
| no rule matched and no `otherwise` | `ProcessEngineException`; mutation command rolls back |
| condition or rule expression cannot be evaluated (missing variable, type mismatch, non-boolean) | `ExpressionEvaluationException` (`ABADA-RUNTIME-EXPRESSION-001`, HTTP 422); mutation command rolls back |

---

## 7. Complete Production Example

The canonical example is stored at `examples/apl/kyc-onboarding.apl.yaml` and
is verified through the native Studio and engine parsers
(`parseAPLYaml → workflow graph → AplParser`).

It demonstrates: a webhook trigger, an LLM extraction agent (advice), a native
credit decision table (law), a human approval gate, a risk-based condition
gateway, two standard service tasks, and the honest observability story
(engine-layer tracing; APL carries no per-node telemetry fields today).

```yaml
# ═══════════════════════════════════════════════════════════════════════════
# KYC Onboarding — Abada Process Language (abada.io/v1)
# Authoring: Abada Studio · Deployment: native APL YAML (strict validation)
#
# Observability note: APL declares no per-node telemetry fields today.
# Tracing is engine-layer: the engine opens a span per command, propagates
# `traceparent` onto external tasks, and audits decision applications as
# DECISION_TABLE_APPLIED history records. The Studio passes its Keycloak
# identity so audit trails record the real actor.
# ═══════════════════════════════════════════════════════════════════════════
version: abada.io/v1

metadata:
  name: kyc_onboarding_v1        # → process key "kyc_onboarding_v1"
  owner: risk-team               # authoring metadata (not executed)
  category: finance

flow:
  entry: onStart

  nodes:
    # ── 1. Trigger ────────────────────────────────────────────────────────
    - id: onStart
      type: webhook
      description: Loan application received
      next: extractAgent

    # ── 2. Agent (probabilistic "advice") ─────────────────────────────────
    # Durable external task on abada:agent; an external worker must
    # complete it. Never advances BPMN state outside engine commands.
    - id: extractAgent
      type: agent
      description: Extract structured application data
      model: gemini-3.6-flash
      prompt: |
        Extract {income, creditScore, requestedAmount} from the application payload.
        Return strict JSON only, keyed exactly as requested.
      tools:
        - Database Query
      confidence_threshold: 85
      next: creditRules

    # ── 3. Deterministic "law" (ADR-002) ──────────────────────────────────
    # Native decision table: executed by the engine IN-TRANSACTION. The
    # outputs below become top-level instance variables, proven by the
    # Studio Run panel (DECISION OUTPUTS · APPLIED IN-TRANSACTION).
    - id: creditRules
      type: decision-table
      description: Credit risk classification
      decisionKey: DMN_CREDIT_V1
      hitPolicy: FIRST
      inputs:                                   # map form → abada:input
        score: "${applicant.creditScore}"
        income: "${applicant.annualIncome}"
      rules:
        - when: "score >= 750 and income >= 60000"
          then: { riskLevel: LOW, autoApprove: true }
        - when: "score >= 600 and income >= 40000"
          then: { riskLevel: MEDIUM, autoApprove: false }
        - otherwise: true                       # mandatory fallback — no rule
          then: { riskLevel: HIGH, autoApprove: false }   # matched → HIGH,
      next: approvalGate                        # never a silent guess

    # ── 4. Human approval gate ────────────────────────────────────────────
    # Compiled to userTask with candidateGroups; task name = description.
    - id: approvalGate
      type: approval-gate
      description: Senior credit officer sign-off
      assignees: [risk-officers]
      mode: serial
      sla_hours: 24
      next: routing

    # ── 5. Exclusive gateway ──────────────────────────────────────────────
    # `else` is a TARGET NODE ID (string), marking the default flow.
    - id: routing
      type: condition
      description: Route by risk
      rules:
        - if: "${riskLevel == 'LOW'}"
          then: notify
        - else: fraudScreen
          then: fraudScreen

    # ── 6. Standard service tasks (deterministic workers) ─────────────────
    - id: notify
      type: engine-task
      description: Notify decision webhook
      service: notification.sink
      next: done

    - id: fraudScreen
      type: agent
      description: Deep fraud screening
      model: gemini-3.6-flash
      prompt: Screen the applicant for identity-fraud signals; return PASS or FAIL.
      confidence_threshold: 90
      next: persist

    - id: persist
      type: engine-task
      description: Persist decision record
      service: decision.record
      next: done

    # ── 7. Terminal ───────────────────────────────────────────────────────
    - id: done
      type: end
      description: Onboarding concluded
```

### 7.1 Intended execution trace

```
start (payload: { applicant: { creditScore, annualIncome }, loan: {...} })
  → extractAgent (external abada:agent worker)
  → creditRules  (in-transaction: riskLevel + autoApprove written, DECISION_TABLE_APPLIED audit)
  → approvalGate (human task, AVAILABLE, assignee group risk-officers)
  → routing      (${riskLevel == 'LOW'} → notify; otherwise default → fraudScreen)
  → notify | (fraudScreen → persist)   → done (instance COMPLETED)
```

Start payload example (Studio Run panel derives this from the input
expressions):

```json
{
  "applicant": { "creditScore": 780, "annualIncome": 95000 },
  "loan": { "requestedAmount": 250000 }
}
```

### 7.2 Round-trip verification

The **kitchen-sink gate** is a committed Studio check
(`studio/scripts/kitchen-sink-roundtrip.mts`, run by `npm run verify:kitchen-sink`
as part of `npm run build` in `studio/`): the kitchen-sink document
(`docs/features/kitchen-sink-process.md`) must survive both directions — the
hand-authored APL fixture (`engine/src/test/resources/apl/kitchen-sink.apl.yaml`)
compiles to BPMN and transpiles back losslessly (entry, node ids, types and
routing), and the legacy BPMN fixture transpiles to APL with the same shape
(event gateway children inline, `camunda:class` delegate as a script node,
inclusive C/D routes, external `kitchen-sink-topic` task).

Ad-hoc verification of another document requires a Studio install
(`cd studio && npm ci`). The script must live **inside `studio/`** so the
relative `./src/...` imports resolve:

```bash
cd studio
cat > ./apl-check.mts <<'EOF'
import * as fs from 'node:fs';
import { parseAPLYaml, stringifyAPLYaml } from './src/lib/apl/parser';
import { compileAPLToBPMN } from './src/lib/bpmn/compiler';
import { transpileBPMNToAPL } from './src/lib/bpmn/transpiler';
const yaml = fs.readFileSync('../examples/apl/kyc-onboarding.apl.yaml', 'utf8');
const doc = parseAPLYaml(yaml);
const xml = compileAPLToBPMN(doc);
console.log('compiled bytes:', xml.length);
console.log('has decisionTable:', xml.includes('abada:decisionTable'));
console.log('has otherwise:', xml.includes('otherwise="true"'));
const back = transpileBPMNToAPL(xml);
console.log('round-trip nodes:', back.flow.nodes.length, '| entry:', back.flow.entry);
EOF
npx --yes tsx ./apl-check.mts && rm -f ./apl-check.mts
```

Expected output: `compiled bytes: …`, `has decisionTable: true`,
`has otherwise: true`, `round-trip nodes: 9 | entry: onStart`.

This exact script (with additional fidelity assertions — node types, `next`
wiring, `decisionKey`, `hitPolicy`, rule count, `otherwise`, condition rules
and agent prompt survival) was run against the real toolchain during the
authoring of this specification and passed every check.
