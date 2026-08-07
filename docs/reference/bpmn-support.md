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

Command, variable, retry, cancellation, suspension and correlation details are
defined by the [runtime semantics contract](runtime-semantics.md).
