# M5 — Studio experience: task specifications

- Milestone: M5 (2026-10-19 → 2026-11-27), release `1.2.0`
- Roadmap: [`roadmap.md`](roadmap.md)
- Audience: human contributors and coding agents. Execute one task per branch/PR.
  Read `AGENTS.md` first; its runtime invariants override anything here.
- Status: **draft for review.**

Every task lists **Goal**, **Files**, **Changes**, **Acceptance tests**,
**Invariants**, and **Out of scope**, as in [`m4-task-specs.md`](m4-task-specs.md).
`STUDIO` means `studio/src`, `ENGINE` means `engine/src/main/java/com/abada/engine`,
`ENGINE_TEST` means `engine/src/test/java/com/abada/engine`.

## Why this milestone

The engine is ahead of the Studio. Operators and buyers judge Abada by what
they see while a process runs, and today:

- The Operations view is functional but abrupt: dense panels, hard-coded hex
  colours repeated across files (`#1A1614`, `#3A322E`, `#2A9D8F`…), no loading
  or empty states worth the name, and two files over 600 lines
  (`ProcessOperations.tsx` 922, `InstanceDetailView.tsx` 649).
- Execution is shown as fast as events arrive. A run that takes 300 ms in the
  engine is a flash on screen: nobody can see which step ran, in what order, or
  why it went where it went.
- The diagram of a running or finished instance does not make the path taken
  obvious. `deriveInstancePath` (`STUDIO/lib/run/instanceDetail.ts`) rebuilds
  it from activity history, which records the activity but not the sequence
  flow taken (`ActivityHistoryEntity` has no flow id), so the path is guessed
  between consecutive activities and is ambiguous with parallel branches, loops
  and two flows between the same nodes.
- When an incident occurs, the failing node is not obvious on the canvas and the
  retry action lives in a separate panel (`IncidentsPanel`).
- The audit trail is a tab the user must open, and it renders all at once.
- `motion` (12.x) is a dependency but nothing imports it.
- A `decision-table` node shows only an icon in the properties panel.
  `STUDIO/features/dmn/DmnRuleInspector.tsx` exists but is not mounted anywhere.
- The Administration panel has an *Audit* tab that only shows "Audit trail
  coming soon" (`AdminAuditPlaceholder` in `AdministrationView.tsx`). The engine
  records no audit event for administrative mutations (`AdminController`,
  `AiProviderController`, project and policy changes).
- The execution-variables panel renders values in a larger font than keys,
  copes poorly with many or nested variables, and JSON is shown as plain
  `JSON.stringify` text in about ten places (agent steps, tool approvals,
  dry run, deploy dialog, task inbox…), never highlighted.
- The NL → APL bar is fixed on screen and its result lands straight on the
  canvas through a diff modal; there is no place to refine a draft while
  seeing it.
- The documentation does not say which Studio version it describes and gives
  no hint of what is new.
- Forms support six flat field types (`string`, `number`, `boolean`, `select`,
  `textarea`, `date`, see `STUDIO/features/inbox/formSchema.ts`), no layout and
  no file upload. The engine has no file storage.

## The rule for "slow enough to see"

Observation pace is a **presentation** concern. The engine keeps executing at
full speed; nothing in this milestone adds delays, sleeps or throttling to the
engine, the worker or the outbox (doctrine: do not weaken the durable state
machine). The Studio buffers the event stream and plays it back at a human pace,
and it always tells the truth about the gap:

- Each visible step transition holds for a minimum dwell (default *calm*,
  ≈ 700 ms per node; *brisk* ≈ 250 ms; *instant* = today's behaviour).
- When playback is behind the real state, the Studio shows it ("replaying —
  4 steps behind", with a *Jump to now* control). It never shows a state the
  instance is not in or was never in.
- Incidents, terminal states and human tasks waiting on the current user are
  never held back behind the queue: they are announced immediately, and the
  playback catches up to them. One bounded exception (S4): the facts of a
  retry (`INCIDENT_RETRIED` up to the fact that completes or fails it) are
  each shown for one dwell before the catch-up, so a retry that ends the
  instance is still seen; the header status changes at once.
- `prefers-reduced-motion` disables movement (not the pacing itself; steps still
  appear in order, with fades instead of motion).
- The pace setting is per user (local preference), default *calm*.

## Order and dependencies

```
S1 motion foundation ──┬── S2 path taken ── S3 paced playback ──┬── S4 incident on the node
                       │                                         └── S5 live audit trail
                       └── S6 Operations redesign (uses S2–S5 components)
S7 decision-table inspector   (independent)
S8 form layout + field types ── S9 file upload (engine + Studio)
S10 admin audit trail (engine + Studio)   S11 variables + JSON viewer (after S1)
S12 NL authoring workspace (after S1)     S13 documentation discovery
S14 documentation, screenshots, 1.2.0 gate
```

S1 first, then S2 and S7/S8 in parallel. S2 adds the taken flow to history
events (engine, no schema change); S9 (`V40`) and S10 (`V41`) are the only
tasks with a schema change.

---

## S1 — Motion foundation and design tokens

**Goal.** One shared vocabulary for colour, spacing and motion, so every later
task animates the same way and the Studio stops repeating hex values.

**Files.** `STUDIO/index.css`, new `STUDIO/lib/motion.ts`, `STUDIO/components/ui.tsx`,
Tailwind config.

**Changes.**
- Colour, radius, shadow and elevation tokens as CSS custom properties; replace
  the repeated hex literals in `features/operations`, `components/` and
  `features/designer` with tokens (mechanical, no visual change in this step).
- `lib/motion.ts`: duration tokens (`fast` 150 ms, `base` 240 ms, `calm` 700 ms),
  two easings (standard, emphasised), shared `motion` variants (enter, exit,
  list stagger, state change pulse, layout shift), and a `useReducedMotion`
  wrapper.
- Primitives in `ui.tsx`: `Skeleton`, `EmptyState`, `StatusPill` (animated
  state change), `Drawer`, `AnimatedNumber`.
- Page and panel transitions (route change, side panel open/close, modal
  enter/exit, toast) use the shared variants.

**Motion rules.** Animation must carry meaning: a state change, where something
came from or went, what is live. No decorative loops except a live indicator.
Nothing above 400 ms except the playback dwell. Layout animations must not
shift content the user is reading or typing into.

**Acceptance tests.** Unit tests for the reduced-motion wrapper; lint rule or
test that fails on new raw hex colours in `features/operations`; `npm run build`
unchanged bundle budget (+ ≤ 40 kB gzip).

**Out of scope.** Light theme; rebranding.

---

## S2 — The path taken, at a glance

**Goal.** On the diagram of a running or finished instance, anyone sees without
effort how the process got where it is: which steps ran, in what order, which
branch each decision took, and what was never reached.

**Files.** `ENGINE/core/` (where tokens leave a node), history event details,
`STUDIO/lib/run/instanceDetail.ts` (`deriveInstancePath`),
`STUDIO/hooks/useLiveInstanceOverlay.ts`, `STUDIO/features/designer/nodes/*`,
`EdgeRenderer.tsx`, `edgeStyle.ts`, `CanvasMarkers.tsx`.

**Changes — truth first (engine).**
- When a token leaves a node, the history event records the flow it took:
  `detailsJson.flow = { id, from, to, tokenId, loopIteration }`, plus for
  conditions the matched rule (`condition` text or `else`) and for routing
  agents / outcomes the chosen route. No schema change (`details_json` exists);
  written in the same transaction as the move.
- `GET` instance history exposes these fields in the DTO (additive, `/api/v1`
  compatible). `deriveInstancePath` uses them and only falls back to today's
  inference for instances started before the upgrade, labelled "path
  reconstructed" in the UI.

**Changes — the picture (Studio).** Three clearly different visual layers:

| Layer | Nodes | Edges |
| --- | --- | --- |
| **Path taken** | Full opacity, solid fill in the node's colour, a small check for completed, an order badge (`1`, `2`, `3`…) in the corner | Saturated accent colour, 3 px, solid, filled arrowhead, drawn above all other edges |
| **Where it is now** | Accent ring with a slow live glow (running), amber with a person icon (waiting for a human), red ring (incident), filled end marker (finished) | The edge into the current node animates its stroke once on arrival (S3) |
| **Not reached** | ~30 % opacity, desaturated, thin outline, no shadow | 1 px, light grey, dashed, small open arrowhead |

- **Decisions read like sentences.** On a condition or routing node, the taken
  branch keeps its label in full colour, prefixed with ✓ (e.g. "✓ score ≥ 750");
  untaken branch labels fade with their edge. Hovering the gateway shows the
  values that decided it (redacted per evidence policy).
- **Loops and repeats.** A node visited more than once shows `×3`; the back-edge
  is drawn in the path colour with its iteration count. Order badges list every
  visit on hover ("2, 5, 8").
- **Parallel branches.** All taken branches are highlighted; the join shows how
  many arrived (`2/2`).
- **Delegation and for-each.** A `call-process` / `for_each` node on the path
  shows its child results (`3 ✓ · 1 ✗`) and links to the children (E20/E21).
- **Hover to explore.** Hovering a faded node brings it back to full opacity
  with a tooltip ("not reached — the `else` branch was taken at *Check score*").
  Hovering a path node highlights its audit entry (S5).
- **A "Show full diagram" toggle** turns dimming off; a three-item legend
  (taken / now / not reached) sits in the canvas corner, collapsible.
- **Colour is not the only cue** (accessibility): taken = solid + thick +
  numbered, not reached = dashed + faded, incident = icon + ring. Contrast of
  the path colour ≥ 3:1 against the canvas; checked in dark theme.
- **Same rendering everywhere** the diagram shows an instance: Operations
  instance view, Dry Run, the task form's process context, and exported
  screenshots.

**Acceptance tests.** Engine (PostgreSQL): history records the flow for
sequential, condition, parallel split/join, bounded loop, outcome routing and
boundary-event exits; a rolled-back command leaves no flow record. Studio:
`deriveInstancePath` unit tests for each shape using recorded flows, and the
fallback for pre-upgrade history; visual regression screenshots for a finished
happy path, a rejected-then-approved rework loop, a parallel run, and an
incident mid-path; a five-second test with two people unfamiliar with the
process ("which branch did it take, and why?") recorded in the PR.

**Invariants.** The path shown is derived from recorded facts, never guessed
when facts exist. No sensitive values in tooltips beyond what the audit trail
already shows.

**Out of scope.** Heat-map overlay across many instances (Insight, 1.3
candidate).

---

## S3 — Paced playback of a running instance

**Goal.** The user watches the process execute step by step, at a pace a human
can follow, without the UI lying about the real state.

**Files.** New `STUDIO/hooks/usePacedPlayback.ts`, `STUDIO/hooks/useLiveInstanceOverlay.ts`,
`STUDIO/hooks/useInstanceEvents.ts`, canvas node components in
`STUDIO/features/designer/nodes/`, `EdgeRenderer.tsx`.

**Changes.**
- `usePacedPlayback(events, pace)` turns the SSE event stream (E12) into an
  ordered queue and emits one visible transition per dwell. It exposes
  `{ visibleState, lag, jumpToNow(), pace, setPace }`. Ordering is by outbox
  event id; duplicates (at-least-once delivery) are dropped by event id.
- Canvas: the active token travels along the taken edge (animated stroke),
  the node entering `active` pulses once, then settles into the S2 "path taken"
  style; the S2 layers build up step by step instead of appearing at once.
  Parallel branches advance together.
- Pace control (calm / brisk / instant) and the lag badge in the instance
  header; *Jump to now* flushes the queue.
- The same hook drives Dry Run (`DryRunPanel`) so simulations are watchable too.
- Exceptions from the pacing rule above (incident, terminal, my task) bypass the
  queue.

**Acceptance tests.** Hook tests with a fake clock: events arriving in 50 ms are
shown one per dwell, in order; duplicate event ids shown once; an incident event
jumps the queue; *instant* reproduces current behaviour; reduced motion keeps
order without transforms. Playwright: start the lead-triage example and assert
each node becomes active in sequence.

**Invariants.** No change to engine timing or APIs. The visible state is always
a prefix of the real event sequence.

**Out of scope.** Rewinding a finished instance (a "replay scrubber" is a 1.3
candidate); server-side throttling.

---

## S4 — Incident on the node, with the action in place

**Goal.** When an instance fails, the user sees *where* at a glance and fixes it
from there, then watches the fix happen.

**Files.** Canvas nodes, `STUDIO/features/operations/IncidentsPanel.tsx`,
`ErrorDetailsDialog.tsx`, new `STUDIO/features/operations/NodeIncidentCard.tsx`.

**Changes.**
- The failing node gets an incident state: red ring with a single attention
  pulse, an incident badge, and the canvas pans/zooms to it when the incident
  arrives (unless the user is interacting with the canvas).
- A card anchored to the node shows the error summary, attempts and the
  available actions from the existing incident API: *Retry*, *Retry on another
  model* (agent nodes, E4), *View details* (stack trace dialog), *Cancel
  instance*. Permissions decide which buttons render; the backend still
  enforces them.
- After *Retry*, the node passes visibly through `retrying → active →
  completed/failed` with the S3 dwell, so the user sees the retry happen even if
  the engine resolves it in milliseconds. The incident card collapses into a
  "resolved" toast with a link to the audit entry.
- `IncidentsPanel` lists incidents across instances and clicking one opens the
  instance focused on the node.

**Acceptance tests.** Component tests for the card per node type and
permission set; Playwright: deploy a process whose engine task fails, observe
the node in incident state, retry with a fixed input, observe completion.

**Invariants.** Actions call the existing commands; no new retry semantics.
The word "Replay" stays reserved for E15 replay-before-approval; the incident
action is labelled *Retry*.

**As built.** Retry phases are read from recorded facts only: *retrying* =
`INCIDENT_RETRIED`; *active* = `EXTERNAL_TASK_LOCKED`, a claimed task, a
started child, or a token waiting at the step again; *completed* = the work
completed or a flow left the step; *failed* = the last attempt failed again.
The instance view reads its incidents with the additive
`processInstanceId` filter on `GET /v1/projects/{projectId}/incidents` and
refreshes them with each stream event. A retry takes no input: the
instance's current variables are used (fix one with the variables `PATCH`
first). The Playwright scenario was run as a scripted browser check on the
dev stack; a committed end-to-end harness is a separate task.

---

## S5 — Live audit trail, opened at start

**Goal.** The audit trail tells the story of the run as it happens, entry by
entry, from the moment the instance starts.

**Files.** `STUDIO/features/operations/InstanceDetailView.tsx`,
`instanceTelemetry.tsx` (`AuditTimeline`).

**Changes.**
- Starting an instance from the Studio (or opening a running one) opens the
  instance view with the audit trail visible by default, beside the canvas.
- New entries enter one at a time through the S3 queue (slide + fade, short
  stagger), in sync with the canvas: the entry for a node appears when the node
  becomes active on screen, not before.
- Each entry: actor (engine, agent with model and prompt version, human),
  action, node, time, duration; agent entries expand to the agent-step inspector
  (E12), decision-table entries show the matched rule (S7), human entries the
  outcome and comment.
- Hovering an entry highlights its node on the canvas; clicking a node filters
  the trail.
- The trail auto-scrolls while the user is at the bottom and stops when they
  scroll up (with a "new entries" pill).

**Acceptance tests.** Component tests: entries appear in event order under a
fake clock; scroll-lock behaviour; node ↔ entry highlight. No sensitive values:
audit entries render the same redacted fields as today (`AGENTS.md`, evidence
over claims).

---

## S6 — Operations redesign

**Goal.** An Operations view that feels premium: calm, legible, fast, and
built around the running process rather than around tables.

**Files.** `STUDIO/features/operations/*`, split `ProcessOperations.tsx` and
`InstanceDetailView.tsx` into focused components (< 300 lines each).

**Changes.**
- **Design pass first**: a clickable mock (Artifact or Figma) of the overview
  and the instance view, reviewed before implementation.
- **Overview**: header KPIs with animated numbers and 24 h sparklines
  (running, completed, incidents, awaiting humans, p95 duration, AI cost);
  filter chips by state and version; instance list with live state pills that
  animate on change; skeletons while loading; designed empty states.
- **Instance view**: the canvas is the hero (S3/S4 overlay), the audit trail
  on the right (S5), variables, lineage (E20) and versions in a tabbed drawer;
  sticky header with state, version, started by, elapsed time ticking, pace
  control and actions.
- **Worker health** and **incidents** as compact cards with clear severity,
  not raw tables.
- Keyboard: `j/k` to move in the list, `Enter` to open, `Esc` to close the
  drawer.
- Consistent typography scale and spacing from S1 tokens.

**Acceptance tests.** Existing operations tests pass after the split; visual
regression screenshots for overview, instance running, instance with incident,
empty project; Lighthouse accessibility ≥ 95 on the operations route; first
contentful render of the list ≤ 1 s with 1 000 instances (virtualised list).

**Out of scope.** New backend aggregations beyond what `/api/v1` already
returns; if a KPI needs a new endpoint, cut the KPI, not the redesign.

---

## S7 — Decision-table properties in the properties panel

**Goal.** Selecting a `decision-table` node shows and edits its full definition
in the properties panel, like agent and human nodes.

**Files.** `STUDIO/components/PropertiesInspector.tsx`,
`STUDIO/features/dmn/DmnRuleInspector.tsx` (exists, unmounted),
`STUDIO/lib/apl/parser.ts`.

**Changes.**
- Mount `DmnRuleInspector` for `dmn` nodes: `decisionKey`, `hitPolicy`
  (schema-generated labels), `inputs` (name → expression), ordered `rules`
  (`when`, `then` outputs, the single `otherwise` fallback), drag to reorder.
- A compact rule grid in the panel; an *Expand* action opens the full table in
  a wide drawer for large tables.
- Live validation through `POST /v1/apl/validate`: unknown inputs, invalid CEL,
  two `otherwise` rules, `UNIQUE` overlaps that can be detected statically are
  shown inline on the offending rule.
- Edits round-trip to YAML (`AplEditor`) and undo/redo.
- In Operations, the decision-table audit entry and the node card show which
  rule matched and the resolved inputs (redacted per evidence policy).

**Acceptance tests.** Component tests for edit, reorder, validation errors and
YAML round trip; the Studio kitchen-sink parity check covers every
`decision-table` property.

---

## S8 — Form designer: layout and richer fields

**Goal.** Human-input forms that are pleasant to fill: organised in sections and
columns, with the field types real business forms need.

**Files.** `STUDIO/features/designer/FormEditor.tsx`, `STUDIO/features/inbox/formSchema.ts`,
`FormRenderer.tsx`, `STUDIO/components/FormPicker.tsx`; engine form schema
validation; `docs/reference/apl-specification.md`, `apl-node-reference.md`.

**Changes.**
- **Layout model** in the form schema: `sections` (title, description,
  collapsible) containing `rows`; a row holds 1–4 fields with a `span`; mobile
  collapses to one column. Optional `steps` to split a long form into a wizard
  with a progress indicator. Forms without layout keep rendering as today.
- **Field types**: `email`, `url`, `currency` (with ISO code), `multiselect`,
  `radio`, `checkbox-group`, `datetime`, `file` (S9), read-only `display` (shows
  a process variable), and static `markdown` help text.
- **Validation**: `required`, `min`/`max`, `minLength`/`maxLength`, `pattern`,
  checked in the renderer **and by the engine on task completion** (the engine
  enforces the contract; the UI is a convenience).
- **Conditional visibility** `visible_when` as a CEL expression over form values
  and process variables, evaluated in the browser for display and re-checked by
  the engine: a hidden field is never required and its value is discarded.
- **Compact by default.** Inputs, labels and spacing follow a compact scale
  (32 px controls, 12–13 px labels, tight vertical rhythm) instead of today's
  oversized fields. Density adapts to the form: a short form (≤ 6 fields)
  uses comfortable spacing, a long one (> 15 fields) switches to compact
  spacing and multi-column rows on wide screens, so a long form fits without
  endless scrolling. A field never grows wider than its content needs
  (`span` and sensible max widths per type: a date is not full-width).
- **A large editor for working calmly.** The form designer opens in a large
  panel (near full screen, `Esc` to close, unsaved-changes guard): palette on
  the left, the form canvas in the middle, field properties on the right, and a
  live preview toggle (desktop / mobile). The small inline editor stays for
  quick tweaks with an *Open full editor* action.
- **Designer UX**: drag fields from a palette into sections and rows, resize
  span, reorder by drag or keyboard, undo/redo shared with the Studio.

**Acceptance tests.** Visual regression of a 4-field and a 25-field form at
desktop and mobile widths (density switch, no horizontal scroll); schema tests
for every type and layout rule; engine tests
rejecting a completion that violates required/pattern/visibility rules; renderer
tests at desktop and mobile widths; APL parser validation test, executable
fixture under `engine/src/test/resources/apl/`, Studio round trip.

**Out of scope.** Repeatable groups (line items) — 1.3 candidate; custom
widgets.

---

## S9 — File upload in human tasks

**Goal.** A form field can take one or more files; the process receives a
reference it can route on and hand to a worker, never the bytes.

**Files.** New `ENGINE/files/` (entity, repository, service, controller),
Flyway `V40__process_files.sql`, task completion validation, `STUDIO/api/`,
`FormRenderer.tsx`, `docs/reference/runtime-semantics.md`,
`docs/architecture/runtime-state.md`.

**Changes.**
- **Storage in PostgreSQL** (still the only required infrastructure):
  `process_files` (id, project, uploaded_by, content_type, size, sha256, name,
  bytes, state `PENDING|ATTACHED`, instance_id, task_id, created_at). Size cap
  configurable (default 10 MB per file, 50 MB per task); content type checked
  against the field's `accept` list by sniffing, not by extension.
- `POST /api/v1/files` (multipart) creates a `PENDING` file owned by the
  uploader; `GET /api/v1/files/{id}` streams it to users allowed to see the
  instance; responses set `Content-Disposition: attachment` and `nosniff`.
- Completing a task with a `file` field: the engine checks each id exists, is
  `PENDING`, belongs to the completing user and matches the field constraints,
  then marks it `ATTACHED` to the instance and task **in the completion
  transaction**. The variable stores `{ fileId, name, contentType, size, sha256 }`.
- A durable job removes `PENDING` files older than 24 h. Attached files follow
  the instance retention policy.
- External workers and agents receive the reference; a worker downloads the
  bytes with its own credentials. Agent inputs remain default-deny (T6): a file
  reaches a model only if the agent declares it.
- Audit: upload, attach, download are audit events (actor, file id, instance);
  file contents and names are not logged.
- Studio: drop zone with progress, type/size feedback before upload, preview
  for images and PDFs, remove before submit; file chips in the instance
  variables view with download.

**Acceptance tests.** PostgreSQL Testcontainers: fresh migration and upgrade
from every supported prior schema; completion attaches files atomically and a
failed completion leaves them `PENDING`; another user cannot attach or download;
oversize and wrong-type rejected; cleanup job is cluster-safe (two replicas, one
deletion); negative security tests (no token, expired token, other project).

**Invariants.** No bytes in process variables, outbox events or webhooks. No
remote call inside the completion transaction.

**Out of scope.** Object storage (S3) backend — an interface is introduced, the
only implementation is PostgreSQL; virus scanning (documented as an operator
responsibility via a worker hook).

---

## S10 — Administration audit trail

**Goal.** Replace the "coming soon" placeholder with a real, tamper-evident
audit trail of administrative actions, as `AGENTS.md` requires for
security-relevant mutations.

**Files.** New `ENGINE/audit/` (entity, repository, recorder, controller),
Flyway `V41__admin_audit_events.sql`, `AdminController`, `AiProviderController`,
`ProjectController`, `InsightPolicyController`, evidence-policy and project
access endpoints; `STUDIO/features/admin/AdministrationView.tsx` (split the
audit tab into `AdminAuditTrail.tsx`), `STUDIO/api/admin.ts`;
`docs/architecture/runtime-state.md`.

**Changes.**
- `admin_audit_events` (id, occurred_at, actor, actor_roles, action, target_type,
  target_id, project_id nullable, outcome `SUCCESS|DENIED`, trace_id,
  client_ip, details_json). Append-only: no update or delete path in code, and
  the application role gets `INSERT, SELECT` only in the migration.
- Recorded **in the same transaction** as the mutation it describes: users,
  groups and memberships, project create/rename/delete and access, AI provider
  keys (create, rotate, delete — never the key), evidence and insight
  policies, deployments, rollbacks, proposal adoption. Denied attempts (403)
  are recorded too, in their own transaction.
- `details_json` holds what changed as a before/after of non-sensitive fields;
  secrets, tokens and key material are never written (`AGENTS.md`).
- `GET /api/v1/admin/audit` — cursor pagination, filters by time range, actor,
  action, target, project, outcome; admin role only. CSV export of the
  filtered set.
- Studio: a dense, filterable table (time, actor, action, target, outcome),
  live updates sliding in at the top (S1 motion), a details drawer with the
  before/after diff in the JSON viewer (S11), and the trace ID linking to the
  instance or deployment when there is one.

**Acceptance tests.** PostgreSQL: fresh migration and upgrade from every
supported schema; a failed mutation leaves no `SUCCESS` event; a denied call
leaves a `DENIED` event; no secret value appears in any event (test inserts a
provider key and scans the table); non-admin gets 403 on the read endpoint;
invalid/expired JWT and forged proxy headers rejected; pagination stable under
concurrent inserts. Studio component tests for filters and the details drawer.

**Out of scope.** Retention policy and external SIEM export (documented as a
1.3 candidate; the table is queryable and exportable as CSV now).

---

## S11 — Execution variables and JSON everywhere

**Goal.** Variables are readable even when there are many and they are deeply
nested, and every piece of JSON in the Studio is highlighted and easy to scan.

**Files.** New `STUDIO/components/json/JsonViewer.tsx` and `JsonTree.tsx`;
`VariablesTab` in `InstanceDetailView.tsx` / `instanceTelemetry.tsx`; every
`JSON.stringify` display in `AgentStepInspector`, `ToolApprovalCard`,
`TaskInbox`, `DryRunPanel`, `DeployDialog`, `ProcessOperations`,
`PropertiesInspector`, `FormPicker`, `ProjectExplorer`.

**Changes.**
- **One typography for keys and values**: the same small monospace size
  (12 px), keys in a muted colour, values coloured by type (string, number,
  boolean, null). Fixes today's larger value font.
- **Tree view** (default): collapsible objects and arrays with item counts
  (`{4}`, `[12]`), expand/collapse all, expand to a given depth, long strings
  truncated with *show more*, copy value / copy path (`applicant.address.city`).
- **Search and filter** across keys and values, matches highlighted and their
  parents auto-expanded; sticky search box for long lists.
- **JSON view** toggle: the whole set as formatted, syntax-highlighted JSON with
  line numbers, folding and *Copy*. Highlighting uses a small dependency-free
  tokenizer (or a lazy-loaded highlighter kept under the S1 bundle budget).
- **Variables that changed** in the last visible step (S3) flash once; file
  references (S9) render as file chips; redacted values render as a
  `redacted` badge, never as their raw content.
- **Everywhere**: `JsonViewer` replaces every raw `JSON.stringify` block, and the
  APL/YAML editor and AI diff keep their existing highlighting.

**Acceptance tests.** Component tests: 500 variables with 6 levels of nesting
render under 100 ms (virtualised), search expands matches, copy path is exact,
redacted values are never in the DOM; a test fails if a `<pre>` renders
`JSON.stringify` output outside `JsonViewer`.

---

## S12 — NL authoring workspace

**Goal.** Natural-language authoring that gets out of the way when not used,
and gives a calm, large space to refine a draft with live feedback before it
reaches the canvas.

**Files.** `STUDIO/components/NLInputBar.tsx`, `STUDIO/features/designer/AIDiffModal.tsx`,
new `STUDIO/features/designer/AuthoringWorkspace.tsx`, `STUDIO/api/authoring.ts`
(E17 patch-mode refine).

**Changes.**
- **Pinnable bar.** The NL bar can be pinned (stays open), collapsed to a small
  floating button, or hidden; shortcut `⌘K` / `Ctrl+K` reopens it. The choice is
  remembered per user.
- **Workspace on confirm.** When the user submits a prompt, a large dialog
  opens (near full screen):
  - centre: the generated diagram, rendered with the real canvas and ELK
    layout, updating as each refinement arrives (S1 transitions: added nodes
    fade in, removed ones fade out, moved ones glide);
  - right: a conversation thread of prompts and refinements (E17 patch-mode),
    each turn with *undo to here*;
  - toggle between diagram, YAML and the diff against the current process;
  - live validation from `POST /v1/apl/validate` shown inline on nodes;
  - the user can also edit directly (select a node, change a property) and the
    next refinement starts from that edit.
- **Confirm and land.** *Apply to Studio* closes the workspace and installs the
  diagram on the canvas as one undoable change, with a short "landing"
  animation; *Discard* leaves the canvas untouched. Nothing is deployed:
  deployment remains an explicit, separate step (doctrine: humans own change).
- Model calls happen in the authoring service as today; errors and slow
  responses show a calm progress state, never a frozen dialog.

**Acceptance tests.** Component tests: pin/collapse persistence, workspace
opens on submit, refinement updates the preview, discard leaves the
workflow unchanged, apply is a single undo step; Playwright with the stub LLM:
prompt → two refinements → apply → canvas matches the final draft.

---

## S13 — Documentation: what is new and which version

**Goal.** A reader of the documentation knows which Studio version it describes
and finds what is new without searching.

**Files.** `documentation/astro.config.mjs`, `documentation/src/content/docs/**`,
new `documentation/src/content/docs/release-notes/` pages, a small version
component, `documentation/scripts/check-links.mjs` if needed.

**Changes.**
- **Version shown** in the header of every page ("Documentation for Abada
  Studio 1.2.0"), read at build time from the Maven/Studio version so it cannot
  drift; the build fails if `studio/package.json` and the engine version
  disagree.
- **"New" markers** in the sidebar with Starlight's native `badge`
  (`{ text: 'New', variant: 'tip' }`, or *Updated*), set from page frontmatter
  (`since: 1.2.0`). A badge shows while the page's `since`/`updated` equals the
  current minor version and disappears automatically on the next minor.
  Inside a page, a small *New in 1.2* aside marks new sections.
- **Readable release notes** in the site: one page per minor release, newest
  first, written for users (what you can now do, with a screenshot or short
  clip, and what to watch out for when upgrading), linking to the full
  technical notes in `docs/release-notes/`. A *What's new* entry sits at the
  top of the sidebar.
- Studio links to the matching documentation version from its help menu and
  shows a dismissible "What's new in 1.2" card after an upgrade.

**Acceptance tests.** `npm run check` and `npm run build` pass; a build check
fails when a page has `since` greater than the current version, or when the
displayed version differs from the release version; link checker covers the
new pages.

---

## S14 — Documentation, screenshots and the 1.2.0 gate

- Update the curated user guide (`documentation/`) for Operations, incidents,
  playback pace, forms and files, with fresh screenshots (isolated capture
  stack).
- Release notes `docs/release-notes/1.2.0-release-notes.md`, upgrade note for
  `V40`, gate report per `1.0-rc-publication-gates.md`.
- Exit demo recorded (see roadmap).
