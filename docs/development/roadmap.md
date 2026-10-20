# Abada roadmap — 1.0.0-rc.6 → 1.2.0

This is the only active roadmap. It replaces `roadmap-to-1.0.md`,
`roadmap-to-1.1.0-rc.md`, `abada-studio-execution-plan.md` and
`saas-roadmap.md`, which are kept for history in `docs/archive/`. Release publication gates in
`1.0-rc-publication-gates.md` still apply to every candidate.

Last reviewed: 2026-10-17. Horizon: 2026-09-28 → 2026-11-27. M1–M4 shipped early
(1.1.0 on 2026-10-14); M5 is the Studio-experience iteration.

## Product definition

Abada is the governed runtime for AI-driven business processes:
**agents advise, rules decide, humans approve, PostgreSQL remembers.**

- APL (YAML) is the primary language. BPMN is an import and compatibility boundary.
- A model call never runs inside a workflow transaction. Its result enters
  process state only through an engine command that validates it.
- Every AI decision leaves evidence an auditor can read later. Every
  AI-proposed change to a process is backed by replay evidence and approved by
  people under a review policy. Nothing auto-applies.
- Self-hosted, AGPL-3.0 (worker SDK Apache-2.0), PostgreSQL as the only required infrastructure up to 1.1; from 1.2, self-hosted installations also require RustFS (self-hosted S3-compatible object storage) for process files. Managed cloud deployments will use GCP Cloud Storage or AWS S3 later.

Target users: regulated and sovereignty-sensitive organisations (banks,
telcos, public sector) that must run on their own infrastructure.

## Milestones

| Milestone | Dates | Release | Exit demo |
| --- | --- | --- | --- |
| M1 Truth and safety | 09-28 → 10-16 | 1.0.0-rc.6 | Malicious expression rejected at deploy; invalid or low-confidence agent output routes to a human; 4 slow agent tasks, no duplicate model call; site claims match the code |
| M2 Real process shapes | 10-19 → 11-06 | 1.1.0-rc.1 | Rework loop (agent drafts → human rejects with comment → agent revises → approve) survives an engine kill mid-loop |
| M3 Agents that act | 11-09 → 11-27 | 1.1.0-rc.2 | Agent uses MCP read tools, proposes an approval-required write, human approves; a crash does not repeat the write; cost per instance visible; a triage agent delegates a sub-case to a governed child process, the parent resumes with its result and the lineage is visible |
| M4 Governed improvement | 11-30 → 12-18 | 1.1.0 | Override-rate finding → proposal replayed on the last 20 real cases → approved from the replay diff; one-click rollback |
| M5 Studio experience | 10-19 → 11-27 | 1.2.0 | Open a finished instance and tell at a glance which path it took and why; start an instance and watch it run step by step at a calm pace with the audit trail writing itself; an engine task fails, the node shows the incident and a Retry in place, the retry plays out on screen; a human fills a sectioned form with a file upload; a decision table is edited in the properties panel; an NL prompt is refined in the workspace and applied; the admin audit shows who changed what |

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
- [x] T12 Truth on the web (site claims corrected; the outdated PDF brief was removed and will be replaced later)
- [x] rc.6 gate report and exit demo — [report](1.0-rc.6-gate-report-2026-09-23.md): exit demo passed (heartbeat race found and fixed); GO signed off and published 2026-09-23
- [x] 1.0.0-rc.8 — fix release on top of rc.7: agent worker startup retry after host reboots; AI provider keys saved in Studio serve agent tasks, Insight and authoring (several providers, Flyway `V22` `ai_providers`, worker credentials endpoint, `ABADA_ENCRYPTION_KEY` generated and enforced); agent error details with stack traces in Studio; Studio undo/redo — [report](1.0-rc.8-gate-report-2026-10-01.md); published 2026-10-01
- [x] 1.0.0-rc.7 — Studio and packaging follow-up to M1, no engine or schema change: BPMN-notation canvas with ELK layout and four canvas fixes, bundled fonts (no Google Fonts), dev login theme, `LICENSE` in the archive and images, single-VM server profile — [report](1.0-rc.7-gate-report-2026-09-28.md); published 2026-09-28

## M2 — Real process shapes

Full specifications: [`m2-task-specs.md`](m2-task-specs.md) (added as tasks start).

- [x] E1 One APL contract: `GET /v1/apl/schema`, `POST /v1/apl/validate`; Studio types generated from the schema; Studio parser reduced to YAML ↔ canvas mapping; typed `metadata.variables` with unknown-identifier warnings (deferred from T2) — [spec](m2-task-specs.md#e1--one-apl-contract--done)
- [x] E2 Token entity: Flyway `V23` `process_tokens` table (id, instance, activity, scope, parent, loop counter, state); migrate active tokens and join bookkeeping; joins count token ids; upgrade tests from V1–V22 schemas; waiting work names its token; fixes dropped same-command join arrivals — [spec](m2-task-specs.md#e2--token-entity--done)
- [x] E3 Bounded loops: back-edges allowed only with `max_iterations`; `on_exhausted` route or incident (V24 `incidents`); BPMN cycles bounded too and loop/multi-instance markers rejected — [spec](m2-task-specs.md#e3--bounded-loops--done)
- [x] E4 Boundaries: `on_error`, `on_timeout` as real boundary events on agent, engine-task and human-input; enforced `sla_hours` with escalation; migrate M1 synthetic outcome gateways; agent `fallback_models`, rate-limit deferral and operator retry on another allowed model
- [x] E5 Human review primitive: `outcomes: [approve, reject]`, required reject comment written to a variable
- [x] E6 Studio: back-edges, boundary events, loop and timeout inspector
- [x] 1.1.0-rc.1 — M2 release candidate: E1–E6, Studio incident list and retry on another model, Dry Run kept across layout-only edits, end-to-end tutorial with screenshots; exit demo covered by `AplReviewRuntimeTest` on PostgreSQL (rejection with comment, engine stopped mid-loop, revised draft and approval after restart) — [report](1.1-rc.1-gate-report-2026-10-04.md)

## M3 — Agents that act

Full specifications: [`m3-task-specs.md`](m3-task-specs.md).

- [x] E7 Tool registry: `TOOL_SERVER` project resources (MCP), per-tool policy read / write / approval-required, deploy-time resolution
- [x] E8 Tool loop in the worker with `max_turns`, `max_tokens_total`, `budget_usd`
- [x] E9 Journaled steps: `POST /v1/external-tasks/{id}/steps`; resume after the last committed step; idempotency keys on write tools
- [x] E10 Approval-required tools suspend the agent and create a human task
- [x] E11 Evidence and cost: `agent_steps` with retention/redaction policy, encrypted at rest; per-model price table
- [x] E12 Studio: SSE from the outbox; agent-step inspector
- [x] E13 Routing agents: `routes:` validated by the engine
- [x] E20 Governed delegation: `call-process` node on the E2 token model (child linked by `parent_instance_id` / `parent_token_id`, typed inputs and outputs, `max_depth`); agents may declare `delegates:` and propose a delegation admitted only through an engine command (declared target, schema-checked inputs, optional `approval: required`); agent identity (id, prompt version, model) recorded on every step and delegation. Done when an engine kill mid-child neither duplicates nor orphans it and lineage shows in audit and Studio

Released as `1.1.0-rc.2` on 2026-10-10 ([gate report](1.1-rc.2-gate-report-2026-10-10.md)).

The engine never calls tool servers; MCP lives in the worker.

## M4 — Governed improvement and launch

Full specifications: [`m4-task-specs.md`](m4-task-specs.md). Released as `1.1.0` on
2026-10-14 ([gate report](1.1-gate-report-2026-10-14.md), signed off).

- [x] E14 Override-rate, confidence-drift, calibration and cost signals (`reviewed_by` link from agent to human node)
- [x] E15 Replay before approval: in-memory replay on the last N cases, outcome diff, policy can require it (tools are not run; start inputs are recorded from this release)
- [x] E16 One-click rollback to a prior immutable version (second-approver option deferred)
- [x] E17 Schema-driven NL authoring with patch-mode refine
- [x] E21 Bounded for-each: `for_each` over a list variable with `max_items` and `max_parallel`, each item a governed child process, results gathered in order, a failed item does not fail the others
- [x] E18 Site: `/investors` page and a claims register checked by the build; demo-video script (the recording and the Astro migration are not done)
- [x] E19 1.1.0 gate report, upgrade notes, pilot runbook: [release notes](../release-notes/1.1.0-release-notes.md), [upgrade section](../operations/upgrading.md), [pilot runbook](../operations/pilot-runbook.md), [gate report](1.1-gate-report-2026-10-14.md); published 2026-10-14

## M5 — Studio experience

Full specifications: [`m5-task-specs.md`](m5-task-specs.md). Pacing is a
presentation concern: the engine keeps executing at full speed and the Studio
plays the event stream back at a human pace, always showing how far behind it is.

- [ ] S1 Motion foundation and design tokens (shared durations/easings on `motion`, reduced-motion, no more repeated hex colours)
- [ ] S2 The path taken, at a glance: engine records the flow each token took; on the diagram the path is dense, numbered and drawn on top, decisions show the matched branch, unreached nodes fade (hover to explore, toggle to show all)
- [ ] S3 Paced playback of running instances and Dry Run (calm / brisk / instant, lag badge, *Jump to now*; incidents and terminal states never held back)
- [ ] S4 Incident on the node: highlighted failing node, Retry / Retry on another model in a card anchored to it, the retry shown step by step
- [ ] S5 Live audit trail open from the start of the instance, entries appearing one by one in sync with the canvas
- [ ] S6 Operations redesign (design mock first; KPIs, live list, canvas-centred instance view, split of the 900-line files)
- [ ] S7 Node properties and palette: every node kind fully editable in the properties panel (decision tables first: rules, reorder, rule-level engine validation), the palette drawn in the canvas shapes, the matched rule in Operations
- [ ] S8 Form designer: compact controls whose density adapts to the form size; a large editor panel; sections, columns and steps; richer field types; validation and `visible_when` enforced by the engine
- [ ] S9 File upload in human tasks: bytes in RustFS (self-hosted S3-compatible object storage, required for self-hosted installations, started by Compose and the installer), metadata in PostgreSQL (Flyway `V42`), references in variables, attach in the completion transaction, RBAC and audit
- [ ] S10 Administration audit trail: append-only `admin_audit_events` (Flyway `V43`) written in the mutation's transaction, denied attempts included, no secrets; filterable table with live updates and CSV export
- [ ] S11 Execution variables and JSON everywhere: same small font for keys and values, collapsible tree with search for many/nested variables, JSON view; one highlighted `JsonViewer` replaces every raw JSON block
- [ ] S12 NL authoring workspace: pinnable/collapsible NL bar; on submit a large dialog to refine the draft with a live diagram, YAML and diff, then apply to the Studio as one undoable change
- [ ] S13 Documentation: Studio version on every page, "New" sidebar badges driven by `since:` frontmatter, user-friendly release notes and a *What's new* entry
- [ ] S14 User guide, screenshots, 1.2.0 release notes and gate report

## Parallel track — design partners

| By end of | Goal |
| --- | --- |
| M1 | 10 target organisations shortlisted; corrected site live; new brief drafted; one-page pilot offer |
| M2 | 5 conversations; rework-loop demo shown; 2 candidate processes |
| M3 | 1 pilot process scoped in APL with the partner's reviewers |
| M4 | Pilot running on partner infrastructure; first replay-backed proposal reviewed together |

## Cut line

If a milestone slips by more than a week, cut from the bottom, never the exit demo.

| Milestone | Cut first | Never cut |
| --- | --- | --- |
| M1 | T10, T9 labelling | T1, T3, T4, T12 |
| M2 | E6 polish | E2, E3 |
| M3 | E13, E12 SSE (keep polling), then agent-proposed delegation in E20 (keep plain call-process) | E9, E10 |
| M4 | E21, E17, E18 Astro migration | E14, E15 |
| M5 | S8 `steps` and `visible_when`, S6 keyboard and KPIs needing new endpoints, S13 in-Studio "What's new" card | S2, S3, S4, S5, S9, S10 |

## Deferred (1.2 or later)

GCP Cloud Storage and AWS S3 object-store backends for managed cloud deployments; TypeScript and Python worker SDKs; Abada MCP
server; SaaS track (multi-tenancy, billing); BPMN coverage beyond import;
`tenda/` and `orun/` (archive); identity-administration UI beyond the IdP;
infrastructure certification (Track B of the former 1.1 roadmap) — kept as a
release-notes limitation until scheduled.

Call-process and for-each moved out of this list on 2026-09-27 into M3 (E20)
and M4 (E21): governed delegation lets agents coordinate without leaving the
engine's control. Both reuse the E2 token model and the E9 journal rather than
new machinery.
