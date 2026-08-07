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
- Script tasks receive the variable map as `variables` and individual values
  as bindings. Script mutations are persisted only when the command commits.

## User tasks

- A task with an explicit assignee is created claimed by that assignee.
- An unassigned candidate task is `AVAILABLE`. A listed candidate user or a
  member of a listed candidate group may claim it.
- Claiming locks the task row; one concurrent claimant wins.
- Completion requires the assignee, or an authorized candidate when the task
  is still available. Completion locks both task and process rows.
- A completed or failed task cannot transition again.
- Failure is terminal for the task but does not implicitly fail the process.
- Claim, unclaim, completion and failure reject suspended or terminal process
  instances after locking both task and process state.

## Process control

- Cancellation changes a non-terminal instance to `CANCELLED`, records its end
  time and removes active tokens. Cancellation is not reversible.
- Failure changes a non-terminal instance to `FAILED`, records its end time and
  removes active tokens.
- Suspension changes a running instance to `SUSPENDED`. Task completion and
  event advancement are rejected while suspended. Activation restores
  `RUNNING`; terminal instances cannot be activated.
- Repeating a transition that is invalid for the committed state returns a
  deterministic conflict/error and does not write history.

## Gateways

- An exclusive gateway evaluates outgoing flows in model order and selects the
  first true condition. If none match, it takes the configured default flow;
  absence of a matching/default flow is an execution error.
- A parallel fork creates one token per outgoing flow. Its corresponding join
  waits until every expected branch token arrives.
- An inclusive fork selects every true conditional flow, or its default when
  none match. The join waits only for branches selected by that fork.
- Join-arrival and expected-token sets are durable and restored after restart.

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
- An operator retry clears the old lease and returns the task to `OPEN`.

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
