# Abada roadmap — 1.0.0-rc.6 → 1.1.0

This is the only active roadmap. It replaces `roadmap-to-1.0.md`,
`roadmap-to-1.1.0-rc.md`, `abada-studio-execution-plan.md` and
`saas-roadmap.md`, which are kept for history in `docs/archive/`. Release publication gates in
`1.0-rc-publication-gates.md` still apply to every candidate.

Last reviewed: 2026-09-23. Horizon: 12 weeks, 2026-09-28 → 2026-12-18.

## Product definition

Abada is the governed runtime for AI-driven business processes:
**agents advise, rules decide, humans approve, PostgreSQL remembers.**

- APL (YAML) is the primary language. BPMN is an import and compatibility boundary.
- A model call never runs inside a workflow transaction. Its result enters
  process state only through an engine command that validates it.
- Every AI decision leaves evidence an auditor can read later. Every
  AI-proposed change to a process is backed by replay evidence and approved by
  people under a review policy. Nothing auto-applies.
- Self-hosted, MIT-licensed, PostgreSQL as the only required infrastructure.

Target users: regulated and sovereignty-sensitive organisations (banks,
telcos, public sector) that must run on their own infrastructure.

## Milestones

| Milestone | Dates | Release | Exit demo |
| --- | --- | --- | --- |
| M1 Truth and safety | 09-28 → 10-16 | 1.0.0-rc.6 | Malicious expression rejected at deploy; invalid or low-confidence agent output routes to a human; 4 slow agent tasks, no duplicate model call; site and brief claims match the code |
| M2 Real process shapes | 10-19 → 11-06 | 1.1.0-rc.1 | Rework loop (agent drafts → human rejects with comment → agent revises → approve) survives an engine kill mid-loop |
| M3 Agents that act | 11-09 → 11-27 | 1.1.0-rc.2 | Agent uses MCP read tools, proposes an approval-required write, human approves; a crash does not repeat the write; cost per instance visible |
| M4 Governed improvement | 11-30 → 12-18 | 1.1.0 | Override-rate finding → proposal replayed on the last 20 real cases → approved from the replay diff; one-click rollback |

## M1 — Truth and safety

Full specifications: [`m1-task-specs.md`](m1-task-specs.md).

- [x] T1 CEL replaces Nashorn for conditions and decision tables; scripts opt-in in a class-filtered sandbox; delegate allow-list
- [x] T2 Loud expression failures (typed rollback, deploy-time checks)
- [x] T3 Agent worker concurrency and lock heartbeat
- [x] T4 Engine-side agent output contract (JSON Schema, confidence, single result variable)
- [x] T5 `on_low_confidence` / `on_invalid_output` routing
- [x] T6 Default-deny agent inputs; nested paths; data out of the system prompt
- [x] T7 `on_error` routing for agent and engine-task
- [x] T8 O(V+E) cycle detection
- [x] T9 Remove or label drifted fields
- [x] T10 Token usage in attempt metadata
- [x] T11 Truth in the repository (AGENTS.md, README, roadmap consolidation)
- [x] T12 Truth on the web (site; the PDF brief has no source in the repo and must be corrected by hand)
- [ ] rc.6 gate report and exit demo — [draft report](1.0-rc.6-gate-report-2026-09-23.md): local verification green; exit demo and sign-off open

## M2 — Real process shapes

- [ ] E1 One APL contract: `GET /v1/apl/schema`, `POST /v1/apl/validate`; Studio types generated from the schema; Studio parser reduced to YAML ↔ canvas mapping
- [ ] E2 Token entity: `process_tokens` table (id, instance, activity, scope, parent, loop counter, state); migrate active tokens and join bookkeeping; upgrade tests from every prior schema
- [ ] E3 Bounded loops: back-edges allowed only with `max_iterations`; `on_exhausted` route or incident
- [ ] E4 Boundaries: `on_error`, `on_timeout` as real boundary events on agent, engine-task and human-input; enforced `sla_hours` with escalation; migrate M1 synthetic outcome gateways
- [ ] E5 Human review primitive: `outcomes: [approve, reject]`, required reject comment written to a variable
- [ ] E6 Studio: back-edges, boundary events, loop and timeout inspector

## M3 — Agents that act

- [ ] E7 Tool registry: `TOOL_SERVER` project resources (MCP), per-tool policy read / write / approval-required, deploy-time resolution
- [ ] E8 Tool loop in the worker with `max_turns`, `max_tokens_total`, `budget_usd`
- [ ] E9 Journaled steps: `POST /v1/external-tasks/{id}/steps`; resume after the last committed step; idempotency keys on write tools
- [ ] E10 Approval-required tools suspend the agent and create a human task
- [ ] E11 Evidence and cost: `agent_steps` with retention/redaction policy, encrypted at rest; per-model price table
- [ ] E12 Studio: SSE from the outbox; agent-step inspector
- [ ] E13 Routing agents: `routes:` validated by the engine

The engine never calls tool servers; MCP lives in the worker.

## M4 — Governed improvement and launch

- [ ] E14 Override-rate, confidence-drift and cost signals (`reviewed_by` link from agent to human node)
- [ ] E15 Replay before approval: sandboxed replay on the last N cases, outcome diff, policy can require it
- [ ] E16 One-click rollback to a prior immutable version
- [ ] E17 Schema-driven NL authoring with patch-mode refine
- [ ] E18 Static site, `/investors` page, 3-minute video
- [ ] E19 1.1.0 gate report, upgrade notes, pilot runbook

## Parallel track — design partners

| By end of | Goal |
| --- | --- |
| M1 | 10 target organisations shortlisted; corrected site and brief live; one-page pilot offer |
| M2 | 5 conversations; rework-loop demo shown; 2 candidate processes |
| M3 | 1 pilot process scoped in APL with the partner's reviewers |
| M4 | Pilot running on partner infrastructure; first replay-backed proposal reviewed together |

## Cut line

If a milestone slips by more than a week, cut from the bottom, never the exit demo.

| Milestone | Cut first | Never cut |
| --- | --- | --- |
| M1 | T10, T9 labelling | T1, T3, T4, T12 |
| M2 | E6 polish | E2, E3 |
| M3 | E13, E12 SSE | E9, E10 |
| M4 | E17, E18 Astro migration | E14, E15 |

## Deferred (1.2 or later)

For-each/map and call-process; TypeScript and Python worker SDKs; Abada MCP
server; SaaS track (multi-tenancy, billing); BPMN coverage beyond import;
`tenda/` and `orun/` (archive); identity-administration UI beyond the IdP;
infrastructure certification (Track B of the former 1.1 roadmap) — kept as a
release-notes limitation until scheduled.
