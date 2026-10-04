# BPMN Support Contract

APL (`abada.io/v1`) is Abada's process language. BPMN 2.0 is the foundation it
builds on and the format it imports: Abada keeps the parts of BPMN that hold up
in production — events, gateways, human and service tasks, durable waits — and
deliberately changes the semantics where strict BPMN deadlocks, guesses or lets
a process run unbounded. Those changes are listed in
[Where APL improves on BPMN](#where-apl-improves-on-bpmn), each with the test
that proves it.

This matrix defines the BPMN semantics guaranteed by Abada. Deployment rejects
unsupported flow nodes instead of silently treating them as pass-through nodes.

| Element | Status | Guaranteed semantics | Executable evidence |
|---|---|---|---|
| None start/end events | Supported | One none start event; completion after all active tokens reach an end | [`ScriptTaskTest`](../../engine/src/test/java/com/abada/engine/core/ScriptTaskTest.java) |
| User task | Supported | Assignee/candidate authorization, claim, complete and fail | [`TaskManagerTest`](../../engine/src/test/java/com/abada/engine/core/TaskManagerTest.java) |
| User task with `abada:outcomes` | Supported | The task is finished with a validated decision (`abada:outcomes="approve,reject"`, `abada:commentRequired="reject"`); the engine writes `<id>_outcome` and `<id>_comment` and an exclusive gateway after the task routes on the outcome | [`SupportedBpmnValidatorTest`](../../engine/src/test/java/com/abada/engine/parser/SupportedBpmnValidatorTest.java), [`TaskDecisionApiTest`](../../engine/src/test/java/com/abada/engine/api/TaskDecisionApiTest.java) |
| Service task (`camunda:class`) | Supported (operator allow-list) | Synchronous Java delegate execution inside the engine transaction; the class must be listed in `ABADA_DELEGATES_ALLOWED_CLASSES` or deployment fails | [`ServiceTaskTest`](../../engine/src/test/java/com/abada/engine/core/ServiceTaskTest.java) |
| Service task (`camunda:topic`) | Supported | Durable external task with fetch/lock, completion and failure | [`ExternalTaskTest`](../../engine/src/test/java/com/abada/engine/api/ExternalTaskTest.java) |
| Script task | Supported (operator opt-in) | Sandboxed JavaScript without Java access, only when `ABADA_SCRIPTS_ENABLED=true`; variables in and out as JSON | [`ScriptTaskTest`](../../engine/src/test/java/com/abada/engine/core/ScriptTaskTest.java) |
| Exclusive gateway | Supported | First matching conditional flow, then configured default flow; conditions are CEL and an unevaluable condition fails the command | [`ProcessInstanceAdvanceTest`](../../engine/src/test/java/com/abada/engine/core/ProcessInstanceAdvanceTest.java) |
| Inclusive gateway | Supported | All matching flows; the join waits for the branch tokens its fork spawned, counted by token id | [`InclusiveGatewayTest`](../../engine/src/test/java/com/abada/engine/core/InclusiveGatewayTest.java) |
| Parallel gateway | Supported | Fork all outgoing flows; the join fires when every live branch token has arrived, counted by token id (a branch that ended inside the fork no longer counts, see below) | [`ParallelGatewayTest`](../../engine/src/test/java/com/abada/engine/core/ParallelGatewayTest.java) |
| Message catch event | Supported | Durable subscription by message name and `correlationKey` variable | [`MessageEventTest`](../../engine/src/test/java/com/abada/engine/core/MessageEventTest.java) |
| Signal catch event | Supported | Durable broadcast subscription by signal name | [`SignalEventTest`](../../engine/src/test/java/com/abada/engine/core/SignalEventTest.java) |
| Duration timer catch event | Supported | Durable scheduled job for ISO-8601 durations | [`TimerEventTest`](../../engine/src/test/java/com/abada/engine/core/TimerEventTest.java) |
| Event-based gateway | Supported | ≥2 competing catch children (message/timer/signal); the first child to fire advances the instance and every sibling wait state is cancelled in the same transaction; pending races survive restart | [`EventGatewayTest`](../../engine/src/test/java/com/abada/engine/core/EventGatewayTest.java) |
| Boundary event: interrupting timer (`timeDuration`) or error | Supported on user tasks and external (`camunda:topic`) service tasks | The timer cancels the task's work after the duration and continues on the boundary flow; an error boundary catches a worker-reported BPMN error by `errorCode` (no code catches all) and the last failed attempt (`WORK_FAILED`). Same runtime as APL `on_timeout` / `on_error` | [`SupportedBpmnValidatorTest`](../../engine/src/test/java/com/abada/engine/parser/SupportedBpmnValidatorTest.java), [`AplBoundaryRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/AplBoundaryRuntimeTest.java) |
| Business rule task (`abada:decisionTable`) | Supported | Deterministic in-transaction decision table evaluation with `FIRST`/`UNIQUE`/`COLLECT` hit policies, `otherwise` fallback and history audit | [`DecisionTableRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/DecisionTableRuntimeTest.java) |

Not supported in the 1.0 contract: subprocesses, call activities, boundary
events other than interrupting timer and error boundaries on user and external
service tasks (non-interrupting, message, signal, escalation, compensation and
conditional boundaries are rejected), event subprocesses, compensation,
transactions, multi-instance
and standard-loop activities (rejected at deployment; model a bounded cycle
instead), complex gateways, conditional events, time-date/time-cycle timers,
message/signal start events, throwing events, receive/send/manual tasks,
DMN 1.3 decision files and CMMN.

A business rule task is supported only when it carries an
`abada:decisionTable` extension; it is rejected otherwise. Decision tables are
defined inline in the BPMN as the native Abada dialect (see
[abada-native-extensions.md](../bpmn/abada-native-extensions.md)) rather than
as external DMN XML documents.

Embedded Java and script tasks can execute external side effects. Database state
transitions are protected against duplicate engine advancement, but applications
must make those side effects idempotent. External tasks are the recommended
boundary for remote or retryable work.

A user task's `camunda:formKey` is a supported metadata directive: it maps to
the canonical task `formKey` (a project-unique logical key resolving to a FORM
project resource, see [runtime-semantics.md](runtime-semantics.md#forms)). An
unresolvable `formKey` never blocks deployment; it is reported as a warning.

## Native APL documents (`abada.io/v1`)

Definitions can also be deployed as native APL YAML. The engine sniffs the
source: a document whose first meaningful line is `version: abada.io/v1` is
compiled by the native parser; anything starting with `<` is validated and
compiled as canonical BPMN 2.0 XML. Both schemas compile into the same
executable graph model and share the runtime, persistence, versioning and
outbox machinery. The stored schema is recorded per definition version in
`process_definitions.schema_type` (`BPMN_XML` or `APL_NATIVE`) and surfaced in
the deployment/list DTOs as `schemaType` and `definitionFormatVersion`
(`canonical-1` / `apl-native-1`).

The supported APL construct set maps 1:1 onto the BPMN elements above:

| APL node | Runtime element | Semantic notes |
|---|---|---|
| `webhook` | Start event | Exactly one per document; routed via `next` |
| `end` | End event | Terminal; must not declare `next` |
| `human-input` (alias `approval-gate`) | User task | `assignees` list becomes candidate groups; `formKey` selects the task form |
| `engine-task` | External service task | `service` declares the durable topic |
| `agent` | External service task | Fixed durable topic `abada:agent` |
| `script` | Script task | In-transaction server-side script; the APL form of an embedded Java delegate (`camunda:class`) |
| `decision-table` | Business rule task | Inline `inputs`/`rules`, `FIRST`/`UNIQUE`/`COLLECT`, `otherwise` fallback; applies `abada:decisionTable` semantics |
| `condition` | Exclusive gateway | `if` rules become conditional flows; the `else` rule (or the last rule otherwise) becomes the default flow |
| `inclusive` | Inclusive gateway | Fork: every matching `if` rule fires; only an explicit `else` rule is a default — zero matches without one fail loudly. Join: waits for the tokens the fork actually spawned |
| `parallel` | Parallel gateway | Fork: `branches` (≥2) get one unconditional flow each; join: upstream `next` flows converge on the node and it continues via its single `next`. Tokens are durable rows, so fork/join state persists across restarts |
| `message-catch` | Message intermediate catch event | Durable subscription by message name, correlated against the instance `correlationKey` variable — identical to the BPMN message catch |
| `timer` | Duration timer intermediate catch event | Durable ISO-8601 duration job; `duration` validated with `Duration.parse` at deployment |
| `signal` | Signal intermediate catch event | Durable broadcast subscription by signal name |
| `event-gateway` | Event-based gateway | Inline `events` list of ≥2 competing catch children (message-catch/timer/signal); the first child to fire advances the instance and every sibling subscription/timer/token is cancelled atomically in the same transaction |

APL semantics that close or tighten holes:

- Every cycle is **bounded**: the node a cycle returns to declares
  `loop: { max_iterations, on_exhausted }` (BPMN: `abada:maxIterations`,
  `abada:onExhausted`); an unbounded cycle is rejected at deployment.
- A `condition` must route via `rules`, never `next`; a `parallel` node must
  not combine `branches` with `next` or declare fewer than two distinct branch
  targets; a second `else` rule, a missing `metadata.name`, an undeclared
  routing target, a second `webhook` node or an unrecognized node type fails
  deployment with an index-friendly validation error and rolls back.
- `approval-gate` requires a non-empty `assignees` list; `message-catch`,
  `timer` and `signal` require a non-blank definition (`message` name,
  `Duration.parse`-valid ISO-8601 `duration`, `signal` name); `engine`/`agent`
  are executed by external workers through fetch/lock/complete, exactly like
  `camunda:topic` service tasks.
- `event-gateway` routes exclusively through its inline `events` list (never
  `next`), requires at least two competing children, and rejects duplicate
  competing message/signal names, undeclared child targets and invalid
  ISO-8601 durations at deployment. The first child to fire advances the
  instance; sibling subscriptions are consumed and sibling timer jobs are
  cancelled in the same transaction, so a late loser can never produce a
  duplicate transition (pending races persist and survive restart).

Executable evidence: [`AplParserTest`](../../engine/src/test/java/com/abada/engine/parser/AplParserTest.java)
(compilation and rejection matrix), [`AplRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/AplRuntimeTest.java)
(end-to-end execution, restart recovery and schema coexistence),
[`PostgresSchemaUpgradeTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresSchemaUpgradeTest.java)
(V10 `schema_type` migration from every published schema version).

Command, variable, retry, cancellation, suspension and correlation details are
defined by the [runtime semantics contract](runtime-semantics.md).

## Where APL improves on BPMN

BPMN leaves several situations to deadlock, to the expression language of the
host engine or to an unbounded loop. APL makes each of them deterministic.
These differences apply to native APL and to BPMN imported into Abada, since
both run on the same runtime.

| Situation | Strict BPMN 2.0 | Abada / APL | Evidence |
|---|---|---|---|
| A parallel-fork branch ends at an end event before the join | The join waits forever for the missing token; the instance never completes | The branch stops counting toward its join; the join fires when the remaining branches arrive | [`ProcessInstanceTokenTest`](../../engine/src/test/java/com/abada/engine/core/ProcessInstanceTokenTest.java) `aBranchThatEndsInsideTheForkNoLongerCountsTowardTheJoin` |
| Paths of an exclusive choice converge on a parallel gateway (a merge with no fork in scope) | The parallel gateway waits for every incoming flow and deadlocks | The merge fires after one arrival per incoming stream, or as soon as no other token can still reach it | `ProcessInstanceTokenTest` `aMergeAfterAnExclusiveChoiceFiresWithTheOnePathTaken` |
| An event-based gateway inside a parallel branch, its catch events leading to the join | Each incoming sequence flow of the join is a separate expected token | The race counts as one branch: the winner continues, the losing waits are cancelled in the same transaction | `ProcessInstanceTokenTest` `anEventRaceInsideABranchCountsAsOneStreamAtTheJoin`, [`EventGatewayTest`](../../engine/src/test/java/com/abada/engine/core/EventGatewayTest.java) |
| Conditions and decision rules | Expression language left to the engine; commonly scripts or EL that can reach the host platform | CEL only: sandboxed, no JVM access, compiled at deployment; an expression that cannot be evaluated fails the command instead of being treated as `false` | [`ExpressionSecurityTest`](../../engine/src/test/java/com/abada/engine/expression/ExpressionSecurityTest.java) |
| Elements the engine does not execute | Implementations often ignore or pass through what they do not understand | Rejected at deployment with a stable validation code | [`SupportedBpmnValidatorTest`](../../engine/src/test/java/com/abada/engine/parser/SupportedBpmnValidatorTest.java) |
| Cycles in the flow | Allowed with no bound; a mistaken back-edge loops forever | Every cycle declares a bound on the node it returns to (APL `loop.max_iterations`, BPMN `abada:maxIterations`); past it the token takes `on_exhausted` or an operator incident is opened. Unbounded cycles are rejected at deployment | [`AplLoopRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/AplLoopRuntimeTest.java), [`BpmnLoopDeploymentTest`](../../engine/src/test/java/com/abada/engine/core/BpmnLoopDeploymentTest.java) |
| Loop and multi-instance markers on an activity | Repeat the activity | Rejected at deployment with a pointer to bounded cycles; never silently run once | `BpmnLoopDeploymentTest` `multiInstanceMarkersAreRejectedInsteadOfRunningOnce` |
| Work that fails for good, or never finishes | A failed job sits in the engine's incident list; nothing in the model says where the process goes, and a task waits forever unless a timer boundary is drawn | Every waiting step can declare `on_error` (also catching the last failed attempt, `WORK_FAILED`) and an interrupting `on_timeout`; without `on_error` a last failure opens a retryable `WORK_FAILED` incident instead of stalling silently. Human tasks get an enforced service level (`sla_hours`) that escalates in place | [`AplBoundaryRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/AplBoundaryRuntimeTest.java) |
| A rate-limited or unavailable AI model | No equivalent | Declared `fallback_models` are tried only while the model before is unavailable; otherwise the attempt is deferred without consuming the retry budget, with a bounded, growing delay. An operator can retry failed agent work on another allowed model, with an audited reason | `AplBoundaryRuntimeTest` `rateLimitDeferralsKeepTheBudgetGrowAndAreBounded`, `unroutedFailureOpensAnIncidentRetriedOnAnotherModelWithAnAuditTrail`; [`AgentWorkerRunnerTest`](../../agent-worker/src/test/java/io/abada/agent/AgentWorkerRunnerTest.java) |
| A reviewer approves or rejects | A user task writes whatever variables the form sends; a gateway guesses from them | The task declares its outcomes; the engine accepts only a declared outcome, requires the comment where declared and hands it to the next step (`<id>_comment`) — the human-in-the-loop rework the agent reads | [`AplReviewRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/AplReviewRuntimeTest.java) |
| A step performed by an AI model | No equivalent; a generic service task | The `agent` node: durable external work whose output the engine validates against a declared schema and confidence threshold before it enters process state | [`AgentOutputContractTest`](../../engine/src/test/java/com/abada/engine/core/AgentOutputContractTest.java) |
| Business rules | A separate DMN document and engine | Decision tables inline in the process, evaluated deterministically in the workflow transaction and audited | [`DecisionTableRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/DecisionTableRuntimeTest.java) |

What Abada does not claim: full BPMN 2.0 conformance. The supported subset is
the matrix above; everything else is rejected at deployment.

