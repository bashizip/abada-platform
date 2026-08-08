# Insight Loop reference

The Insight Loop observes terminal execution facts in PostgreSQL and produces
human-governed APL proposals. It is disabled by default and never changes a
running process instance.

## Durable data model

| Table | Purpose |
| --- | --- |
| `insight_execution_facts` | One idempotent row per node visit (`visit_id`), with identifiers, terminal status, timing, and non-PII decision metadata. |
| `insight_observation_windows` | Durable analyzer cursor and `ANALYZED` / `COMPLETED` / `FAILED` recovery state. |
| `insight_findings` | Threshold violations for one deployment and node. |
| `insight_proposals` | Full target/proposed APL, checksum, policy snapshot, lifecycle, and adopted version. |
| `insight_approval_policies` | Versioned policy per definition key. |
| `insight_proposal_reviews` | Immutable actor decision and comment; one row per actor/proposal. |
| `insight_worker_lease` | Cluster-safe singleton analysis lease. |

Facts and workflow state commit or roll back together. The analyzer persists
its window and findings first, performs optional LLM generation without a
database transaction, then completes the window. An `ANALYZED` window left by
a crash is resumed after the lease expires.

Latency baselines use facts strictly before the current window. Facts in the
window cannot train their own baseline. Repeated visits to one activity are
separate facts because uniqueness is based on the visit/task/audit ID, not the
activity ID.

## Signals

- external-task failure rate after `min-attempts`;
- external-task p95 latency relative to the pre-window p95 baseline;
- decision-table fallback ratio after `min-fallback-samples`.

The rule-based fallback proposal preserves executable semantics and annotates
the source. A configured OpenAI-compatible generator may draft a real change,
but the candidate is discarded unless `AplParser` accepts it and its process
key matches the target.

## Proposal lifecycle

`DRAFT → IN_REVIEW → ADOPTED | REJECTED | SUPERSEDED`

- `ADOPTED`: the policy is satisfied and the target deployment/checksum is
  still latest; a new native APL version was deployed.
- `REJECTED`: any authorized reviewer rejected with a non-empty comment.
- `SUPERSEDED`: the targeted definition changed before final approval.

There is at most one `DRAFT`/`IN_REVIEW` proposal per deployment. Terminal
proposals remain available for audit.

## API and authorization

| Operation | Authority |
| --- | --- |
| Read configuration, policies, proposals | `insight:read`, Insight Reviewer, Operator, or Admin |
| Approve/reject | `insight:review`, Insight Reviewer, or Admin |
| Update policies | `insight:configure` or Admin |

Endpoints are under `/api/v1/insight`. Proposal lists are paginated. Review
requests accept `expectedUpdatedAt`; stale requests return a typed 409.
Policies use `expectedVersion`. `requiredApprovals` must equal the number of
distinct comma-separated reviewer groups. Parallel policies accept those
groups in any order; sequential policies enforce their declared order.

## Configuration

The principal settings are `ABADA_INSIGHT_ENABLED`, `ABADA_LLM_BASE_URL`,
`ABADA_LLM_API_KEY`, and `ABADA_LLM_MODEL`. Thresholds and scheduling are
available under `abada.insight.*`. Secrets are accepted as input only; the
configuration API exposes whether a key is present, never its value.

OpenTelemetry remains optional diagnostic output and is not an authoritative
input to this v1 loop. See ADR-003.
