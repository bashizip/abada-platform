# BPMN Support Contract

This matrix defines the BPMN semantics guaranteed by Abada. Deployment rejects
unsupported flow nodes instead of silently treating them as pass-through nodes.

| Element | Status | Guaranteed semantics | Executable evidence |
|---|---|---|---|
| None start/end events | Supported | One none start event; completion after all active tokens reach an end | [`ScriptTaskTest`](../../engine/src/test/java/com/abada/engine/core/ScriptTaskTest.java) |
| User task | Supported | Assignee/candidate authorization, claim, complete and fail | [`TaskManagerTest`](../../engine/src/test/java/com/abada/engine/core/TaskManagerTest.java) |
| Service task (`camunda:class`) | Supported | Synchronous Java delegate execution inside the engine transaction | [`ServiceTaskTest`](../../engine/src/test/java/com/abada/engine/core/ServiceTaskTest.java) |
| Service task (`camunda:topic`) | Supported | Durable external task with fetch/lock, completion and failure | [`ExternalTaskTest`](../../engine/src/test/java/com/abada/engine/api/ExternalTaskTest.java) |
| Script task | Supported | Server-side JavaScript/ECMAScript with process variables as bindings | [`ScriptTaskTest`](../../engine/src/test/java/com/abada/engine/core/ScriptTaskTest.java) |
| Exclusive gateway | Supported | First matching conditional flow, then configured default flow | [`ProcessInstanceAdvanceTest`](../../engine/src/test/java/com/abada/engine/core/ProcessInstanceAdvanceTest.java) |
| Inclusive gateway | Supported | All matching flows and matching-token join behavior | [`InclusiveGatewayTest`](../../engine/src/test/java/com/abada/engine/core/InclusiveGatewayTest.java) |
| Parallel gateway | Supported | Fork all outgoing flows and wait for all expected join tokens | [`ParallelGatewayTest`](../../engine/src/test/java/com/abada/engine/core/ParallelGatewayTest.java) |
| Message catch event | Supported | Durable subscription by message name and `correlationKey` variable | [`MessageEventTest`](../../engine/src/test/java/com/abada/engine/core/MessageEventTest.java) |
| Signal catch event | Supported | Durable broadcast subscription by signal name | [`SignalEventTest`](../../engine/src/test/java/com/abada/engine/core/SignalEventTest.java) |
| Duration timer catch event | Supported | Durable scheduled job for ISO-8601 durations | [`TimerEventTest`](../../engine/src/test/java/com/abada/engine/core/TimerEventTest.java) |
| Event-based gateway | Limited | A single outgoing catch event only | [`MessageEventTest`](../../engine/src/test/java/com/abada/engine/core/MessageEventTest.java) |
| Business rule task (`abada:decisionTable`) | Supported | Deterministic in-transaction decision table evaluation with `FIRST`/`UNIQUE`/`COLLECT` hit policies, `otherwise` fallback and history audit | [`DecisionTableRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/DecisionTableRuntimeTest.java) |

Not supported in the 1.0 contract: subprocesses, call activities, boundary
events, event subprocesses, compensation, transactions, multi-instance
activities, complex gateways, conditional events, time-date/time-cycle timers,
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
| `approval-gate` | User task | `assignees` list becomes candidate groups |
| `engine-task` | External service task | `service` declares the durable topic |
| `agent` | External service task | Fixed durable topic `abada:agent` |
| `script` | Script task | In-transaction server-side script; the APL form of an embedded Java delegate (`camunda:class`) |
| `decision-table` | Business rule task | Inline `inputs`/`rules`, `FIRST`/`UNIQUE`/`COLLECT`, `otherwise` fallback; applies `abada:decisionTable` semantics |
| `condition` | Exclusive gateway | `if` rules become conditional flows; the `else` rule (or the last rule otherwise) becomes the default flow |
| `inclusive` | Inclusive gateway | Fork: every matching `if` rule fires; only an explicit `else` rule is a default — zero matches without one fail loudly. Join: waits for the tokens the fork actually spawned |
| `parallel` | Parallel gateway | Fork: `branches` (≥2) get one unconditional flow each; join: upstream `next` flows converge on the node and it continues via its single `next`. Fork/join token bookkeeping persists across restarts |

APL semantics that close or tighten holes:

- Documents are **strictly acyclic**; any loop over `next` or condition targets
  is rejected at deployment.
- A `condition` must route via `rules`, never `next`; a `parallel` node must
  not combine `branches` with `next` or declare fewer than two distinct branch
  targets; a second `else` rule, a missing `metadata.name`, an undeclared
  routing target, a second `webhook` node or an unrecognized node type fails
  deployment with an index-friendly validation error and rolls back.
- `approval-gate` requires a non-empty `assignees` list; `engine`/`agent` are
  executed by external workers through fetch/lock/complete, exactly like
  `camunda:topic` service tasks.

Executable evidence: [`AplParserTest`](../../engine/src/test/java/com/abada/engine/parser/AplParserTest.java)
(compilation and rejection matrix), [`AplRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/AplRuntimeTest.java)
(end-to-end execution, restart recovery and schema coexistence),
[`PostgresSchemaUpgradeTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresSchemaUpgradeTest.java)
(V10 `schema_type` migration from every published schema version).

Command, variable, retry, cancellation, suspension and correlation details are
defined by the [runtime semantics contract](runtime-semantics.md).
