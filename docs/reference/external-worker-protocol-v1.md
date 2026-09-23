# External-worker protocol v1

Abada 0.11 freezes external-worker protocol version `1` under
`/api/v1/external-tasks`. The engine returns
`X-Abada-Worker-Protocol-Version: 1` from fetch-and-lock. Workers must reject an
unknown or missing protocol version rather than guessing payload semantics.

## Operations

| Operation | Endpoint | Semantics |
| --- | --- | --- |
| Fetch and lock | `POST /fetch-and-lock` | Claims up to `maxTasks` (1–50) for non-empty topics with a 1–3,600,000 ms lease. |
| Heartbeat | `POST /{id}/heartbeat` | Replaces the owned, unexpired lock expiry using `workerId` and `lockDuration`. |
| Lock extension | `POST /{id}/extend-lock` | Compatibility alias with the same atomic semantics as heartbeat. |
| Completion | `POST /{id}/complete` | Requires `{workerId, variables}` in secured modes; merges variables and advances once. |
| BPMN error | `POST /{id}/bpmn-error` | Requires worker ownership and `errorCode`; stores the business error and variables atomically. |
| Technical failure | `POST /{id}/failure` | Stores error details, retries and retry timeout; zero retries creates an incident. |

All mutations accept `Idempotency-Key`. Workers should reuse one key for every
retry of the same logical command. A different body with the same key is
rejected. Locks are owned by `workerId`; a different worker receives a typed
403, and an expired lease cannot be completed or extended. Give every worker
process its own `workerId`: replicas that share one cannot be told apart.

A `409 CONCURRENT_MODIFICATION` on completion or failure means the task changed
between the engine's access check and the command, for example because a
heartbeat for the same task committed first. While the lock is still owned the
command is safe to retry with the same `Idempotency-Key`; a failed command
stores no idempotent response. Stop the task's heartbeat before reporting its
result.

Fetch responses include task ID, topic, process instance/activity IDs,
variables, retries, lock expiry, stored W3C `traceParent`, and protocol version.
Requests may carry `traceparent` and `tracestate`; HTTP instrumentation joins
the incoming trace. The Java SDK exposes these headers through `RequestOptions`.

Fetch requests may omit `projectId`. A project-agnostic fetch is authorized
against the calling worker's global capabilities (topics, and optional model
identifiers restricting which agent tasks it can acquire) and may claim tasks
from any project; the locked-task payload then carries the owning `projectId`,
which a worker must not treat as a namespace it needs to pre-configure. A
project-scoped fetch with `projectId` keeps the legacy per-project binding
semantics for third-party workers. Global workers self-register once via
`PUT /v1/workers/me` (see the [Agent worker](agent-worker.md) reference) and
operations can inspect `GET /v1/workers/me` and `GET /v1/workers/health`.

The additive optional `agentWork` object carries the versioned
`abada.agent/v1` descriptor for native APL `agent` nodes. It is `null` for
ordinary service tasks. Protocol-v1 workers that ignore unknown JSON fields
remain compatible; agent workers must reject a missing or unknown
`profileVersion`. See [Agent worker](agent-worker.md).

For `abada:agent` tasks, `variables` contains **only the node's declared
inputs**, resolved by the engine and keyed by input name (default-deny). Other
topics keep receiving the instance variables.

Completion and failure bodies also accept an optional additive `agent` object
(`AgentAttemptMetadata`): `model`, `provider`, `attempt`, `durationMs`,
`tools`, `resultVariable`, `promptHash`, `errorType`, `confidence`,
`promptTokens` and `completionTokens`. The `confidence` value (0–100) is the
`_confidence` the agent model reported for its structured output. For
`abada:agent` tasks the engine, not the worker, applies the node's output
contract to the completed variables (see `apl-specification.md` §3.2); the
completion call still succeeds when the engine rejects the result, and the
decision is visible in history (`EXTERNAL_TASK_COMPLETED` or
`EXTERNAL_TASK_OUTPUT_REJECTED` with `agentOutcome`). The engine persists it on the
external-task record and inside the `EXTERNAL_TASK_*` history event details.
It never contains prompts, tokens, credentials, or complete sensitive
payloads; ordinary workers that omit it remain fully compatible.

## BPMN error boundary

Native APL `agent` and `engine-task` nodes may declare `on_error`. A BPMN
error whose code matches a route (or a code-less catch-all) completes the task
and follows that route in the same transaction, writing
`<node>_outcome = 'ERROR'` and `<node>_error_code`. Without a matching route,
the error remains unhandled: Abada records `EXTERNAL_TASK_BPMN_ERROR`,
persists its code/message, applies its variables, and transitions the process
instance to `FAILED` atomically. BPMN boundary error events remain outside the
supported BPMN subset; the request envelope is unchanged.

## Delivery guarantee

Workflow-state transitions are exactly once at commit. Remote side effects are
at-least-once because a worker can lose the HTTP response after its side effect
or after Abada commits. Workers must deduplicate business side effects using
their own stable operation key.

The Java implementation is under `sdk/java` and builds independently as
`io.abada:abada-worker-client:1.0.0-rc.6`.
