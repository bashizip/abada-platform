# Persistence and Recovery

Abada persists production workflow state in PostgreSQL. Flyway owns the schema
and Hibernate validates it at startup. H2 remains available for local
convenience, but PostgreSQL Testcontainers tests are the persistence and
concurrency reference.

## Stored state

- Immutable, versioned BPMN process definitions and their raw XML
- Process instances pinned by foreign key to an immutable definition
  deployment, with variables, active tokens and gateway join state
- User tasks and candidate users/groups
- Message and signal subscriptions
- Timer jobs and external tasks with lease and retry state
- Append-only activity history and idempotency records

## Command-local runtime state

User tasks are not rehydrated into an engine-wide memory map. Task list and
detail reads query PostgreSQL and return detached snapshots. Claim, completion
and failure commands lock the target task row, validate its committed status,
apply the transition to a command-local object and persist it in the command
transaction.

This makes concurrent replicas deterministic: after one replica commits a
transition, another waiting replica reads the new status and cannot repeat an
invalid transition. Indexes cover process-instance, assignee, candidate-user
and candidate-group task lookups.

Process-instance detail and list queries likewise materialize detached
snapshots directly from PostgreSQL. Completion, cancellation, failure,
suspension, variable updates and event resumption take a write lock on the
instance row before reconstructing tokens, joins and variables. Concurrent
commands therefore see the previous command's committed version instead of a
replica-local object.

## Startup recovery

Startup does not preload workflow objects or parse every deployed definition.
Active process and task metrics are reconstructed with grouped count queries.
Parsed BPMN definitions are loaded lazily by immutable deployment ID and then
reused by that replica.

Starting a process performs one indexed lookup for the latest deployment of
the requested process key. The new instance stores that deployment ID. Later
redeployments can therefore change which version new instances use without
changing the execution model of existing instances. Losing the parsed cache
only causes the pinned XML to be loaded and parsed again.

## Cluster guarantees

PostgreSQL tests cover restart recovery; concurrent task claim, completion and
failure; message and signal correlation; `SKIP LOCKED` timer/external-work
acquisition; expired lease recovery; cancellation races; concurrent
idempotency reservations; and outbox acquisition across two application
contexts. Failures before and after transaction commit are also covered.

Exactly-once applies to committed workflow state. External side effects and
outbox transport remain at-least-once and require consumer deduplication.

See [Runtime State Architecture](../architecture/runtime-state.md) and the
[Reliable OSS Core Roadmap](../archive/roadmap-to-1.0.md) for the exact migration
boundary and later acceptance gates.
