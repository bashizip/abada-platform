# Runtime Semantics Contract

This document defines the behavior guaranteed by the Abada 0.11 stable-contract
runtime. PostgreSQL is the production authority; H2 is a development
convenience and does not define concurrency behavior.

## Commands and transactions

Every public mutation runs as one `@AtomicRuntimeCommand`. The command loads
and locks its authoritative rows, validates the transition, advances BPMN,
persists resulting state and work, appends activity history and an outbox
event, then commits. An exception before commit rolls all of those writes
back. A client that loses the response after commit may repeat the request;
all public HTTP mutations accept an optional `Idempotency-Key` and return their
stored logical result when the same key, operation and request are replayed.
Reuse for a different operation or request is rejected. The reservation,
workflow mutation and stored response commit together, so concurrent replicas
cannot both execute the command. Records expire after 24 hours.

Exactly-once means one committed workflow-state transition. Embedded delegate
side effects are not undone by a database rollback. Remote or retryable work
should use external tasks and an idempotent worker operation.

## Variables

- Variables have process-instance scope and are persisted as JSON.
- Start variables are present before the first activity advances.
- Task completion, event correlation and external-task completion merge their
  supplied variables into the existing map; supplied keys replace old values.
- Cockpit variable patches use the same merge behavior.
- Variables staged by a command that rolls back are not visible later.
- Script tasks run only when the operator enables them
  (`ABADA_SCRIPTS_ENABLED`). They run in a sandbox with no Java access and
  receive variables by name and through `variables.get/put` as JSON copies;
  only variables they create or change are written back, and only when the
  command commits.
- Embedded Java delegates (`camunda:class`) run only when the class is listed
  in `ABADA_DELEGATES_ALLOWED_CLASSES`; other classes are rejected at
  deployment and again at runtime.

## User tasks

- A task with an explicit assignee is created claimed by that assignee.
- An unassigned candidate task is `AVAILABLE`. A listed candidate user or a
  member of a listed candidate group may claim it.
- Effective candidate groups are the union of the caller's identity groups
  (JWT `groups` claim / proxy `X-Groups` header) and their project-scoped
  task groups (`project_member_task_groups`, managed per project member).
  The union is resolved against the project that owns the task at claim,
  completion and visibility time; a task group held in one project grants
  nothing in another. A user with no project membership is evaluated on
  identity groups alone.
- Claiming locks the task row; one concurrent claimant wins.
- Completion requires the assignee, or an authorized candidate when the task
  is still available. Completion locks both task and process rows.
- A task that declares `outcomes` is finished with a **decision**
  (`POST .../tasks/{taskId}/decision`), never a plain completion. In the same
  locked command the engine checks that the outcome is declared, that a
  required comment is present and at most 4 000 characters, and that the
  submitted variables do not set `<id>_outcome` or `<id>_comment`; any
  violation is rejected with no change. It then writes `<id>_outcome` and
  `<id>_comment` (`null` without a comment), completes the task and continues
  at the outcome's `next` (APL, recorded as `BOUNDARY_TAKEN` kind `OUTCOME`)
  or after the task (BPMN, which routes on `<id>_outcome`). `TASK_COMPLETED`
  records the outcome and the comment length, never the comment text.
  Evidence: [`AplReviewRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/AplReviewRuntimeTest.java),
  [`TaskDecisionApiTest`](../../engine/src/test/java/com/abada/engine/api/TaskDecisionApiTest.java).
- A completed, failed or cancelled task cannot transition again.
- Failure is terminal for the task but does not implicitly fail the process:
  the token leaves through the task's `on_error`, or a `WORK_FAILED` incident
  opens (see Boundaries).
- Claim, unclaim, completion and failure reject suspended or terminal process
  instances after locking both task and process state.

## Forms

- A user task may carry a `formKey`: a project-unique logical key that resolves
  to a FORM project resource by bare slug (e.g. `loan-approval` →
  `forms/loan-approval.json`). The key is copied verbatim onto the created task
  and exposed as `TaskDetailsDto.formKey` alongside the owning `projectId`.
- Forms are live project resources: task clients resolve the current revision
  at render time, so editing a form affects tasks already in flight.
- `GET /v1/projects/{projectId}/forms` lists FORM resources (id, name, kind,
  revision, updatedAt); `GET /v1/projects/{projectId}/forms/{formKey}`
  resolves a key to its decoded schema JSON. Both require project visibility.
- Deployment never fails on an unresolvable form key; it is logged as a
  warning so authors can add the form after publishing the process.
- `camunda:formKey` in BPMN maps to the canonical `formKey` (see
  [bpmn-support.md](bpmn-support.md)).

## Process control

- Cancellation changes a non-terminal instance to `CANCELLED`, records its end
  time and cancels every live token. Cancellation is not reversible.
- Failure changes a non-terminal instance to `FAILED`, records its end time and
  cancels every live token.
- Cancellation and failure retire the instance's unfinished work in the same
  transaction: open subscriptions are consumed, pending jobs, open external
  tasks and open user tasks become `CANCELLED`. A worker or user acting on
  that work afterwards is rejected, and it is never handed out again.
- Suspension changes a running instance to `SUSPENDED`. Task completion and
  event advancement are rejected while suspended. Activation restores
  `RUNNING`; terminal instances cannot be activated.
- Repeating a transition that is invalid for the committed state returns a
  deterministic conflict/error and does not write history.

## Gateways

- An exclusive gateway evaluates outgoing flows in model order and selects the
  first true condition. If none match, it takes the configured default flow;
  absence of a matching/default flow is an execution error.
- Conditions and decision-table rules are CEL expressions compiled at
  deployment. If a condition cannot be evaluated (a referenced variable is
  missing, a map key is absent, types do not compare, or the result is not a
  boolean), the command fails with `ABADA-RUNTIME-EXPRESSION-001` (HTTP 422
  `EXPRESSION_EVALUATION_FAILED`) and rolls back. It never falls through to
  the default flow silently. See `apl-specification.md` §5.2.
- A parallel fork creates one token per outgoing flow; the forking token waits.
  The join that closes the fork fires when every live branch token has arrived,
  counted by token id; the forking token then continues past the join. Native
  APL exposes the same semantics through the `parallel` node: `branches` become
  the fork flows, and a node several upstream `next` flows converge on becomes
  the join.
- An inclusive fork selects every true conditional flow, or its default when
  none match. The join waits only for branches selected by that fork.
- Branches that reach a join within the same command are all counted (before
  1.1.0-rc.1 the second arrival in one command was dropped and the steps after
  the join did not run). A branch that ends at an end event before the join no
  longer counts toward it.
- A join with no fork in scope (a merge) fires after one arrival per logical
  incoming stream, or with the arrivals it has once no other live token can
  still reach it.
- Tokens are durable rows (`process_tokens`) and survive restart; tasks, jobs,
  external tasks and subscriptions name the token they resume. See
  `docs/architecture/runtime-state.md` §Execution tokens.

## Loops

- A cycle returns to a loop step that declares `max_iterations` (APL
  `loop.max_iterations`, BPMN `abada:maxIterations`); unbounded cycles are
  rejected at deployment.
- Entering the step forward sets `<step>_iteration` to 1; each return through
  the cycle adds 1, inside the same transaction as the advancement.
- A return that would exceed the limit records a `LOOP_EXHAUSTED` history
  event. With `on_exhausted` the token continues there; without it the token
  stops in the `INCIDENT` state and an incident is opened
  (`GET /api/v1/process-instances/{id}/incidents`). The instance stays
  `RUNNING`. An operator either retries the incident — the token starts a
  fresh pass at the loop step, recorded as `INCIDENT_RETRIED` with the actor —
  or cancels the instance; cancelling or failing resolves its open incidents.
- Waits inside a loop are created again on every pass; a timer can loop to
  itself. An agent step that succeeds clears `<step>_raw_output` and
  `<step>_error_code` left by an earlier pass.
- Passes are counted per token and loop step (V25), so parallel branches
  looping on the same step each get their own bound; the tokens a fork creates
  inherit their parent's counts, so a cycle that leaves its fork keeps counting.
  `<step>_iteration` holds the pass of the token that entered the step last.

## Incidents

- An incident stops one token in the `INCIDENT` state and leaves the instance
  `RUNNING`. Types: `LOOP_EXHAUSTED` (a loop limit with no `on_exhausted`) and
  `MISSING_CORRELATION_KEY` (a message wait, standalone or in an event race,
  reached without a `correlationKey` variable — it could never be correlated,
  so the engine stops loudly instead of waiting forever).
- `WORK_FAILED` opens when task work fails its last attempt (or a user task is
  failed) and no `on_error` catches it. The token stays `WAITING` at the task;
  the failed external task (or user task) is kept for its error details.
  Retrying reopens it — the external task returns to `OPEN` with the node's
  full `max_attempts`, the user task becomes `AVAILABLE` — and resolves the
  incident. The older `POST .../jobs/{jobId}/retries` resolves it too.
- Retrying a `WORK_FAILED` incident of agent work accepts an optional
  `{ "model": "...", "reason": "..." }`: the task runs on that model (it must
  be on `abada.agent.allowed-models`; `reason` is required). The override
  applies to that task only — the deployed definition and later instances keep
  their model — and history records `fromModel`, `toModel`, `reason` and the
  actor. The output contract (schema, confidence threshold, tools) is
  unchanged.
- `TOOL_OUTCOME_UNKNOWN` opens when an agent's write tool, whose server takes
  no idempotency key (`idempotency: none`), was journaled `STARTED` and its
  lease was lost before the result came back: the write may or may not have
  happened, so the engine never hands it out again. The step becomes
  `OUTCOME_UNKNOWN`, the external task `FAILED`, and no boundary routes it.
  Retrying requires `{ "toolOutcome": "PERFORMED" | "NOT_PERFORMED" }`: the step
  is finished with the confirmed fate (and the actor), the task reopens on the
  **same** attempt, and the agent resumes from its journal. A job retry
  (`POST .../jobs/{jobId}/retries`) is refused while such a step is open.
- `CHILD_FAILED` opens when a call-process child fails or is cancelled, or
  cannot start, and the call declares no `on_error`; the token stops at the
  call. Retrying restarts it there, which starts a new child.
- `POST .../incidents/{incidentId}/retry` restarts the stopped token at its
  activity in one transaction: a loop step begins a fresh pass, a message wait
  re-reads `correlationKey` (set it first with the variables endpoint). The
  incident is resolved as `RETRIED`.

## Boundaries

Evidence: [`AplBoundaryRuntimeTest`](../../engine/src/test/java/com/abada/engine/core/AplBoundaryRuntimeTest.java)
(PostgreSQL), [`AplParserTest`](../../engine/src/test/java/com/abada/engine/parser/AplParserTest.java),
[`SupportedBpmnValidatorTest`](../../engine/src/test/java/com/abada/engine/parser/SupportedBpmnValidatorTest.java).

- A boundary (`on_low_confidence`, `on_invalid_output`, `on_error`,
  `on_timeout`; BPMN timer and error boundary events) leaves a waiting task
  for its target instead of its normal next step. It fires inside the command
  that observes the condition: the token moves, the task's unfinished work is
  retired (external task or user task `CANCELLED`, timers cancelled),
  `<id>_outcome` (and `<id>_error_code`) are written, and `BOUNDARY_TAKEN` is
  recorded with the boundary, kind, code and target. All or nothing.
- `on_error` catches a worker-reported BPMN error by code (a code-less rule
  catches all), the last failed attempt of task work (code `WORK_FAILED`),
  and a failed user task (`WORK_FAILED`). An unrouted BPMN error still fails
  the instance; an unrouted `WORK_FAILED` opens an incident (see Incidents).
  A routed failure leaves its external task `CANCELLED`, so it never appears
  as retryable failed work.
- `on_timeout` schedules a durable `BOUNDARY_TIMEOUT` job when the token
  enters the task, due `after` later; it survives restarts and fires once. A
  token that leaves the task normally cancels the job in the same
  transaction. A timer that loses that race finds the token gone and does
  nothing. A late worker completion or user completion of the retired work is
  rejected.
- `sla_hours` sets the task's `dueAt` and schedules an `SLA` job. When it
  fires on a task still open, the task is escalated in place: it keeps its
  status and assignee, `escalatedAt` is set, the `escalate_to` groups become
  candidates, and `TASK_SLA_BREACHED` goes to history and the outbox
  (webhooks). The token does not move; completing the task cancels the job.
- A due timer of a suspended instance (catch event, timeout or SLA) is
  postponed by one minute without consuming an attempt; it fires after the
  instance is resumed.
- Lock order: commands lock work rows (task, external task, subscription,
  job) before the instance row. Cancellation and failure retire work before
  locking the instance; a firing timeout or SLA job locks the token's task
  first. Retiring a token's timers skips a job another transaction holds.

## Decision tables

- A `bpmn:businessRuleTask` is supported only when it carries an inline
  `abada:decisionTable` extension; it is rejected otherwise.
- Inputs are resolved from process variables in declaration order, either by
  name or through a `${...}` expression. Evaluation is deterministic and runs
  inside the workflow transaction: the table is the law, the agent is the
  advice.
- Rules are evaluated in model order. `hitPolicy="FIRST"` (default) applies the
  first matching rule, `UNIQUE` fails the command when more than one rule
  matches, and `COLLECT` merges the outputs of every matching rule.
- The single `otherwise="true"` rule applies when no rule matches. When no rule
  matches and no `otherwise` rule exists, the command fails and the workflow
  transaction rolls back; the instance, work, history and outbox writes are
  undone together.
- Outputs are merged into process variables under the declared output names.
  A `COLLECT` evaluation merges outputs in rule order, later outputs
  overwriting earlier ones on key collision.
- Each applied evaluation appends `DECISION_TABLE_APPLIED` history and a
  matching outbox event carrying the decision key, matched rule indexes and
  input/output names — never the values themselves.

## Events and timers

- A message catch creates one durable subscription identified by process
  instance and activity. Correlation matches message name plus the instance's
  `correlationKey` variable, locks the subscription, marks it consumed and
  advances the instance in one transaction.
- A signal catch creates a durable subscription. Broadcast locks the matching
  unconsumed subscriptions in stable ID order and advances every matched
  instance atomically as one command. Competing broadcasts observe consumed
  rows after the winner commits. A failure rolls the broadcast command back.
- An event-based gateway (BPMN `eventBasedGateway`, APL `event-gateway` node)
  forks one durable wait state per outgoing catch child (message, timer or
  signal) in the same transaction as the fork. When the first child fires, its
  advancement and the cancellation of every sibling wait state commit
  together: sibling tokens are cancelled, sibling message/signal
  subscriptions are locked and marked consumed, and sibling timer jobs
  (available or leased) become `CANCELLED` so a late loser can never produce a
  duplicate transition. The token parked at the gateway continues on the
  winner's path. Pending races persist across restart. A join counts an
  event gateway as one logical incoming stream no matter how many of its
  children converge on the join. Evidence:
  [`EventGatewayTest`](../../engine/src/test/java/com/abada/engine/core/EventGatewayTest.java)
  and the kitchen-sink gate
  [`AplKitchenSinkTest`](../../engine/src/test/java/com/abada/engine/core/AplKitchenSinkTest.java).
- A duration timer accepts an ISO-8601 duration and creates a durable job in
  the same transaction as the waiting token. Invalid duration or job creation
  failure aborts the command.
- Due or expired timer jobs are claimed in bounded batches with PostgreSQL
  `FOR UPDATE SKIP LOCKED`. Claiming records a 120-second lease owner and one
  attempt before the acquisition transaction commits. A different replica may
  reclaim the job after lease expiry.
- A leased timer job is retained as `COMPLETED` after successful advancement.
  Failed advancement rolls back before a separate transaction releases the
  lease and schedules retry or marks it `FAILED`; the attempt is not counted
  twice.
- Timer polling defaults to a 60-second initial delay and interval, configurable
  with `abada.jobs.initial-delay-ms` and `abada.jobs.poll-interval-ms`.

## External tasks and retries

- Reaching a `camunda:topic` service task creates one durable external task.
- Fetch-and-lock selects an open or expired task with PostgreSQL `FOR UPDATE
  SKIP LOCKED`, records worker and expiry, and returns a snapshot of process
  variables. Competing workers receive disjoint work.
- Only a live locked task can complete. Completion and process advancement
  commit together; a repeated completion of an already completed task is a
  no-op success.
- Lock extension requires the owning worker.
- Technical failure records error details and retry count. Zero retries marks
  the task `FAILED`; otherwise it becomes immediately open or waits until its
  retry timeout expires.
- An operator retry clears the old lease and returns the task to `OPEN`; a
  completed or cancelled task cannot be retried.
- **Rate limits and outages (agent work).** When a model is unavailable
  (HTTP 429, quota, 408, 5xx, timeout, unreachable) the worker tries the
  node's `fallback_models` in order within the same lease; only availability
  errors switch the model. When every model is unavailable it reports a
  *deferral* (`deferred: true`): the engine keeps the attempt budget,
  increments the task's `deferrals`, records `EXTERNAL_TASK_DEFERRED`, and
  makes the task available again after
  `max(Retry-After, retry_backoff_ms × 2^(deferrals-1))`, capped by
  `abada.agent.max-deferral-delay` (default `PT15M`). After
  `abada.agent.max-deferrals` (default 12) a deferral counts as a failed
  attempt, so waiting is always bounded; `on_timeout` bounds it earlier.
  The model that produced a result is recorded in the attempt metadata and the
  step's `EXTERNAL_TASK_COMPLETED` / `EXTERNAL_TASK_FAILED` history, with
  `requestedModel` when a fallback replaced the declared model.
- **Attempts and the step journal (agent work).** An agent task is on an
  `attempt` (1 at first). A counted failure that will run again, or an
  operator retry, starts the next attempt (a fresh conversation); a lost lease
  or a deferral resumes the same one. The worker holding the lease journals
  every model and tool call with `POST /v1/external-tasks/{id}/steps`, which
  locks only the external-task row, never advances the process and never
  holds the instance lock. The engine accepts only sequence `last + 1` (an
  identical replay is idempotent, a divergent one is `409`), only tools
  frozen in the definition's bindings (`403` otherwise), no
  `approval_required` tool until E10, and at most 256 steps per task. A write
  must be journaled `STARTED` before it runs; when its server accepts a key,
  the engine returns `sha256(externalTaskId:attempt:sequence)` as its
  idempotency key, the same key on every resumed lease. Fetch-and-lock
  returns the attempt's steps (with decrypted payloads, to the lease holder
  only) and the writes earlier attempts completed; an identical write in a
  later attempt is answered from the journal (`reused`) instead of being sent
  again. Retired work answers `410`. Digests are computed by the engine from
  canonical JSON; payloads are AES-GCM encrypted at rest. Evidence:
  [`PostgresAgentStepJournalTest`](../../engine/src/test/java/com/abada/engine/core/agent/PostgresAgentStepJournalTest.java).
- Worker death mid-task is served by lease expiry: an expired `LOCKED` task is
  re-acquired with `SKIP LOCKED`, so another worker retries it without the
  engine re-creating work or advancing state twice. Restarting the engine does
  not dispatch a task whose lease is still live.
- Completion after suspension or cancellation is rejected atomically after
  locking the task row: task lease, variables and history roll back together,
  the instance stays `SUSPENDED`/terminal, and no completion history event is
  written. Resuming re-admits the same worker completion; a cancelled instance
  can never advance, even after its lease passes to another worker. Evidence:
  [`AgentWorkerResilienceTest`](../../engine/src/test/java/com/abada/engine/core/AgentWorkerResilienceTest.java).

## Agent evidence and cost

- When a step is journaled the engine stores two encrypted copies of its
  payloads: the worker's **working copy** (complete, so a resumed lease can
  continue) and the **evidence copy**, shaped by the evidence policy (project
  policy tightened by the node's `evidence`): none, redacted or full. Digests
  are always computed from the complete payload. The working copy is cleared
  once the task is completed or cancelled; the evidence copy and every copy
  past `purge_after` (recorded at journaling: start + retention days) are
  cleared by the retention sweep (`abada.evidence.purge-interval-ms`, default
  15 minutes), which locks rows with `SKIP LOCKED` so replicas purge each row
  once, and records `EVIDENCE_PURGED` per instance and batch.
- A finished model call is priced by the engine from its tokens and the price
  in effect at its start (`model_prices`, a provider-specific price before a
  provider-less one). No price: `cost_unpriced`, cost null. The tokens an
  attempt reports in its metadata are priced the same way when that attempt
  journaled no model call, so nothing is counted twice. Instance cost sums
  both; `abada_agent_cost_usd_total` is tagged by process key and model.
- The agent descriptor carries the current `prices` of the node's model and
  fallbacks, for a worker's budget checks.
- Development-key ciphertext (step payloads, tool credentials) is re-encrypted
  with `ABADA_ENCRYPTION_KEY` after startup, like AI provider keys.
- Evidence:
  [`PostgresEvidenceAndCostTest`](../../engine/src/test/java/com/abada/engine/core/agent/PostgresEvidenceAndCostTest.java),
  [`EvidenceAccessApiTest`](../../engine/src/test/java/com/abada/engine/api/EvidenceAccessApiTest.java).

## Call-process (child instances)

- A token reaching a `call-process` node parks `WAITING`. In the same command
  the engine evaluates the inputs, checks them against the child's declared
  variable types and the depth limit, and creates the child instance of the
  version pinned at the parent's deployment, with lineage (parent instance,
  token and call activity, root, depth). The child starts with the inputs
  only and the parent's `startedBy`.
- When the child ends, its own command records a durable `CHILD_DONE` job for
  the parent token (one per child) and never locks the parent. The job locks
  the parent: a completed child's mapped `outputs` are written (and
  `<id>_outcome = OK`) and the token moves on; a failed child, or one
  cancelled by someone else, takes `on_error` with code `CHILD_FAILED` or
  opens a `CHILD_FAILED` incident. Retrying that incident starts a new child.
  A token that already left (timeout, cancel) ignores the result
  (`CHILD_RESULT_IGNORED`). The job runs right after the child's commit
  (`abada.call-process.resume-immediately`, default on) with the job poller as
  the durable fallback; two replicas running it apply it once.
- Cancelling or failing an instance cancels its running descendants in the
  same transaction; a call's `on_timeout` cancels its child. Lock order is
  always parent, then child.
- History: `CHILD_STARTED`, `CHILD_COMPLETED`, `CHILD_FAILED` on the parent
  with both instance ids and the input/output **names**; the child's
  `PROCESS_STARTED` names its parent. `GET
  /v1/projects/{p}/instances/{id}/lineage` returns the ancestors and children.
- Evidence:
  [`PostgresCallProcessTest`](../../engine/src/test/java/com/abada/engine/core/delegation/PostgresCallProcessTest.java),
  [`PostgresCallProcessCrashTest`](../../engine/src/test/java/com/abada/engine/core/delegation/PostgresCallProcessCrashTest.java)
  (engine restarts after the child starts, between its end and the resume,
  with the job leased by a crashed replica; two replicas at once).

## History and lifecycle delivery

Activity history and its matching outbox event are written in the workflow
transaction. Outbox dispatchers claim independent batches with PostgreSQL
`FOR UPDATE SKIP LOCKED`, publish after commit, and mark success separately.
A failed delivery is retried with bounded exponential delay. A dispatcher
crash after publication but before acknowledgement can cause duplicate
delivery, so lifecycle consumers and webhook adapters must deduplicate by
outbox event ID.

In-process consumers receive `PublishedLifecycleEvent` through Spring's event
publisher. Optional comma-separated webhook targets are configured with
`abada.outbox.webhook-urls`; each POST includes the stable event identifier in
`X-Abada-Event-Id`. Any non-success response leaves the outbox event retryable.

## Definition versions and caches

Redeploying changed BPMN under an existing process key creates an immutable
version. Existing instances remain pinned to their deployment ID; new starts
resolve the latest committed version. Only parsed immutable definitions are
cached. Cache insertion occurs after deployment commit, and cache loss changes
performance rather than execution semantics.
