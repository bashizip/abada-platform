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
| Agent step | `POST /{id}/steps` | Journals one model or tool call of the lease holder (`{workerId, attempt, sequence, kind, state, toolRef?, request, result?, errorType?, model?, promptVersion?, promptTokens?, completionTokens?}`). See *Agent step journal*. |
| Tool credential | `GET /{id}/tool-credentials/{server}?workerId=` | Returns `{server, credential, secret}` for a tool server the task is bound to, only to the worker holding the task's live lease (`409` otherwise, `403` for a server the task is not bound to). Worker principals only, never human administrators; `Cache-Control: no-store`. |
| Technical failure | `POST /{id}/failure` | Stores error details, retries and retry timeout. Zero retries takes the node's `on_error` (code `WORK_FAILED`) or opens a `WORK_FAILED` incident. With `deferred: true` the attempt is not consumed (see below). With `errorCode` the failure is **final and routable**: never retried; the node's `on_error` catching that code (or the catch-all) is taken with `<id>_error_code` set to it, otherwise a `WORK_FAILED` incident opens naming the code (used for `AGENT_BUDGET_EXHAUSTED`, `TOOL_CONTRACT_MISMATCH`). |

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

Protocol v1 only ever adds optional fields. Since 1.1.0-rc.1 the Java SDK
ignores fields it does not know; workers built on older SDK releases reject
them, so a node using a new field (for example `fallbackModels`, sent only
when declared) needs a current worker. When an operator retried the task on
another model, `agentWork.model` carries that model.

`agentWork.fallbackModels` lists the models to try, in order, when the model
before cannot run the attempt at all (rate limit, quota, outage). A worker
switches model only on such availability errors, never because of the
answer. When every model is unavailable, report the failure with
`"deferred": true`, the unchanged `retries` and the provider's Retry-After as
`retryTimeout`: the engine keeps the attempt budget and makes the task
available again after a growing, capped delay. Use an `Idempotency-Key` that
names the lease (for example its lock expiry): two deferrals of the same
attempt are different requests.

For `abada:agent` tasks the descriptor (`agentWork`) also carries, when the
node declares tools, `toolBindings` (the tools frozen with the definition
version: `server`, `tool`, `policy`, `idempotency`, `approvers`, `url`,
`transport`, `credential` name, `resourceId`, `resourceRevision`) and
`toolPolicies` (policies the node tightened, by reference), and `prices`
(model → `{inputPerMillion, outputPerMillion}` USD for the node's model and
fallbacks, for budgets). All are omitted when empty, so older workers keep
decoding the descriptor. Workers never report cost: the engine prices tokens
itself.

For `abada:agent` tasks, `variables` contains **only the node's declared
inputs**, resolved by the engine and keyed by input name (default-deny). Other
topics keep receiving the instance variables.

Completion and failure bodies also accept an optional additive `agent` object
(`AgentAttemptMetadata`): `model`, `provider`, `attempt`, `durationMs`,
`tools`, `resultVariable`, `promptHash`, `errorType`, `confidence`,
`promptTokens`, `completionTokens` and `requestedModel` (the declared model
when a fallback model produced the result). The `confidence` value (0–100) is the
`_confidence` the agent model reported for its structured output. For
`abada:agent` tasks the engine, not the worker, applies the node's output
contract to the completed variables (see `apl-specification.md` §3.2); the
completion call still succeeds when the engine rejects the result, and the
decision is visible in history (`EXTERNAL_TASK_COMPLETED` or
`EXTERNAL_TASK_OUTPUT_REJECTED` with `agentOutcome`). The engine persists it on the
external-task record and inside the `EXTERNAL_TASK_*` history event details.
It never contains prompts, tokens, credentials, or complete sensitive
payloads; ordinary workers that omit it remain fully compatible.

## Agent step journal

For `abada:agent` tasks, fetch-and-lock also returns `attempt` (the attempt
the task is on), `steps` (the journaled steps of that attempt, payloads
included, to resume from) and `priorWrites` (writes earlier attempts
completed). Older workers ignore these fields.

A worker records every call with `POST /{id}/steps` and resumes after the last
committed step:

- `kind` is `MODEL_CALL` or `TOOL_CALL` (with `toolRef: <server>/<tool>`);
  `state` is `STARTED`, `COMPLETED` or `FAILED`. A step may be born finished
  for model calls and read tools; a **write** must be recorded `STARTED`
  before the tool is called, then finished with the same `sequence` and
  `request`.
- Sequences start at 1 per attempt and have no gaps; a new step needs the
  previous one finished. Re-sending an identical request returns the same
  step; a different request or result for a recorded step is refused.
- The response carries `idempotencyKey` for writes whose server accepts one:
  send it with the tool call, and the same key again when resuming a
  `STARTED` write. `reused: true` means an earlier attempt already performed
  this write (same tool and arguments; the call id is ignored): use `result`
  and do not call the tool.
- On resume: reuse finished steps, re-run a `STARTED` read or model call,
  re-send a `STARTED` keyed write with its key. A `STARTED` write without a
  key is never handed out: the engine marks it `OUTCOME_UNKNOWN` and opens a
  `TOOL_OUTCOME_UNKNOWN` incident. Once a person confirms it, the work is
  handed out again with that step `COMPLETED` (performed) or `FAILED` (not
  performed) and a `result` like any tool result (`content`, `isError`): give
  it to the model as the call's answer.
- Refusals: `403 WORKER_LOCK_NOT_OWNED`, `403 ACCESS_DENIED`
  (`details.reason: TOOL_NOT_BOUND`), `409 WORKER_LOCK_EXPIRED`,
  `409 AGENT_STEP_REJECTED` with `details.reason` one of `STALE_ATTEMPT`,
  `SEQUENCE`, `OPEN_STEP`, `DIVERGENT_STEP`, `STEP_FINISHED`,
  `APPROVAL_REQUIRED`, `WRITE_AHEAD_REQUIRED`, `STEP_LIMIT`, and
  `410 WORK_RETIRED` once the task is completed, cancelled or failed.
- Payloads are limited to 1 MiB each and 256 steps per task.
- Payload shapes the first-party worker uses: a `MODEL_CALL` request is
  `{turn, model, tools, messages}` (only the messages added since the previous
  call) and its result `{content, toolCalls}` (plus token counts on the step);
  a single-call agent records `{value, confidence}`. A `TOOL_CALL` request is
  `{callId, arguments}` and its result `{content, isError, truncated}`.
- A new `MODEL_CALL` is also refused past the node's limits: `TURN_LIMIT`
  (`max_turns` of this attempt), `TOKEN_LIMIT` and `BUDGET` (the task's
  journaled tokens and engine-computed cost), `BUDGET_UNPRICED` (a budget and
  a model without a price). Journal model calls `STARTED` before calling the
  model so the refusal comes before the spend.
- A failed attempt never starts a new attempt while a write of the current
  one is still `STARTED`, or an approved call has not run yet: the same
  attempt resumes and the write is re-sent with its key (or, unkeyed, goes to
  a person).
- **Delegations.** The agent descriptor carries `delegates`: `{process, tool:
  "delegate:<process>", description, inputSchema, approval, outputs}`. A call
  is journaled with `kind: DELEGATION`, `toolRef: delegate:<process>` and the
  request `{callId, arguments}` (the child's inputs): `PROPOSED` when
  `approval` is `required` (then as an approval-required tool below), otherwise
  `STARTED`. Recording `STARTED` starts the child and **parks** the task
  (`AWAITING_CHILD`, no lease); the worker gives the slot back. Refusals:
  `403 TOOL_NOT_BOUND` for an undeclared target, `409 AGENT_STEP_REJECTED`
  with `DELEGATION_INPUT_INVALID` (an input the child does not declare or
  that does not fit its type), `DELEGATION_DEPTH` or `DELEGATION_REFUSED`
  (the child cannot run); nothing is recorded. A worker never finishes a
  delegation: when the child ends the engine journals it `COMPLETED` with
  `{status, childInstanceId, outputs}` (only the declared outputs) or `FAILED`
  with `{status, childInstanceId}`, and the task is acquirable again on the
  same attempt.
- **Approval-required tools.** A call to an `approval_required` tool is
  journaled with `state: PROPOSED` (its `{callId, arguments}` request, no
  result); any other state is refused with `APPROVAL_REQUIRED`, and only
  approval-required tools may be proposed. Recording the proposal **parks**
  the task: the lease is released, the task is `AWAITING_APPROVAL` and not
  acquirable, and a person in the binding's approver groups gets a
  `TOOL_APPROVAL` task. The worker returns the slot without completing or
  failing anything; re-sending the identical proposal (a lost response)
  returns the same step, anything else on parked work is
  `409 WORKER_LOCK_EXPIRED`. A decision makes the task acquirable again, on
  the same attempt:
  - `APPROVED`: journal the same `sequence` and the **same request** as
    `STARTED` (any other request is `DIVERGENT_STEP`), receive the
    idempotency key, call the tool, then finish the step as for a write;
  - `REJECTED`: the step is finished with result
    `{rejected: true, comment}`; give the model the comment as the tool
    result and continue with the next sequence.
  A call with the same tool and arguments that an earlier attempt already ran
  is answered `reused`, with no new approval.
- `Idempotency-Key` is accepted but not needed: the journal is idempotent by
  attempt, sequence and request, and step responses are never copied into the
  idempotency store (they may carry decrypted results).

## BPMN error boundary

Native APL `agent` and `engine-task` nodes may declare `on_error`, and BPMN
service tasks an error boundary event. A BPMN error whose code matches a route
(or a code-less catch-all) completes the task and follows that route in the
same transaction, writing `<node>_outcome = 'ERROR'` and `<node>_error_code`.
Without a matching route, the error remains unhandled: Abada records
`EXTERNAL_TASK_BPMN_ERROR`, persists its code/message, applies its variables,
and transitions the process instance to `FAILED` atomically. The request
envelope is unchanged.

A task whose `on_timeout` (or BPMN timer boundary) fired is `CANCELLED`: a
completion, failure or error report for it is rejected because it is no
longer locked.

## Delivery guarantee

Workflow-state transitions are exactly once at commit. Remote side effects are
at-least-once because a worker can lose the HTTP response after its side effect
or after Abada commits. Workers must deduplicate business side effects using
their own stable operation key.

The Java implementation is under `sdk/java` and builds independently as
`io.abada:abada-worker-client:1.1.0-rc.1`.
