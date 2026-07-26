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
403, and an expired lease cannot be completed or extended.

Fetch responses include task ID, topic, process instance/activity IDs,
variables, retries, lock expiry, stored W3C `traceParent`, and protocol version.
Requests may carry `traceparent` and `tracestate`; HTTP instrumentation joins
the incoming trace. The Java SDK exposes these headers through `RequestOptions`.

## BPMN error boundary

Boundary error events are outside the current supported BPMN subset. Therefore
a protocol-v1 BPMN error is an unhandled business error: Abada records
`EXTERNAL_TASK_BPMN_ERROR`, persists its code/message, applies its variables,
and transitions the process instance to `FAILED` atomically. A future
compatibility profile may add caught boundary-error routing without changing
the request envelope.

## Delivery guarantee

Workflow-state transitions are exactly once at commit. Remote side effects are
at-least-once because a worker can lose the HTTP response after its side effect
or after Abada commits. Workers must deduplicate business side effects using
their own stable operation key.

The Java implementation is under `sdk/java` and builds independently as
`io.abada:abada-worker-client:1.0.0-rc.2`.
