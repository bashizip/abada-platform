# Studio — AI Orchestration Authoring Application

**Studio** is the authoring surface of the Abada platform: it lets workflow
designers compose agentic workflows visually or as native APL YAML, explore
them with a local Dry Run, then explicitly deploy and start immutable process
instances on the Abada Engine.

This specification records what the Studio is, how it operates, what was
achieved in the 2026-08 integration phases, and the operational boundaries
that must stay honest.

---

## Position in the platform

| App | Role | Stack |
| --- | --- | --- |
| **Studio** | Author native APL, Dry Run locally, deploy and inspect live instances | React 19, TypeScript, Vite |
| **Abada Engine** | BPMN runtime, persistence, REST API, security | Java 21, Spring Boot 3.5 |
| **Tenda** | End-user task application (reference only, not deployed) | React 18, TypeScript, Vite |
| **Orun** | Operations and workflow-state inspection (reference only, not deployed) | React 19, TypeScript, Vite |

Studio is the place where the platform's core doctrine is expressed in a
graph: **the table is the law, agents are the advice** (see
[ADR-002](../adr/ADR-002-native-decision-tables-deterministic-wall.md)).
Deterministic decision tables declared in Studio are compiled to native engine
constructs and executed in-transaction; agent steps remain external,
probabilistic work bounded by those rules.

---

## Key capabilities

1. **Visual designer** — a new project starts with an empty canvas; authors add,
   connect and configure agent, human, decision-table, gateway and event nodes.
2. **APL-native editor** — paste or edit `abada.io/v1` YAML with syntax
   highlighting, structural validation and bidirectional diagram synchronization.
3. **APL pipeline** — the canvas and YAML editor share one APL document model;
   BPMN is an explicit compatibility/import boundary rather than the authoring source.
4. **Dry Run** — animate a local, mocked and non-persistent scenario with
   explicit pauses for agent output, gateway choice and human completion.
5. **Deploy & Start** — save the current APL revision, deploy an immutable
   definition, create a project-scoped instance and open its read-only canvas.
6. **Audit log panel** — streaming event log of deploy/run activity.
7. **Task inbox** — human-in-the-loop tasks from the engine.
8. **Operations view** — engine instances and state inspection.
9. **Natural-language generation** — NL prompt generation through the configured
   provider, with a deterministic local APL scaffold when that provider is unavailable.

---

## Strategic evolution (2026-08 integration phases)

The Studio shipped in four deliberate phases. Each phase closed one gap in the
path from "mockup" to "real execution authority".

### Phase 0 — Platform integration

Studio joined the supported local Compose family: its own service, a Keycloak
client (`abada-frontend` redirect for `http://studio.localhost/*`), CORS
alignment for the engine API, and a local development start script
(`scripts/start-engine-for-studio.sh`). Result: Studio is reachable at
`http://studio.localhost` with OIDC login.

### Phase 1 — Engine: native decision tables (the strategic shift)

The engine gained a first-class deterministic decision construct:

- `bpmn:businessRuleTask` is now supported **only** with an inline
  `abada:decisionTable` extension (`abada:input` / `abada:rule` /
  `abada:output`) in the `https://abada.io/schema/bpmn` namespace.
- Evaluation happens **inside the mutation transaction**
  (`DecisionTableEvaluator`): inputs resolve from `${...}` expressions over
  instance variables, outputs are written to variables, and the step commits
  or rolls back atomically with workflow state, history and outbox.
- Hit policies `FIRST` / `UNIQUE` / `COLLECT`; `otherwise` fallback; no match
  and no fallback → loud failure, never a guess.
- Every application is audited as `DECISION_TABLE_APPLIED` with the stable
  `decisionKey`, matched rule indexes and input/output names.
- Secure, hardened XML extraction (`DecisionTableXml`: no DTDs, no external
  entities, no XInclude).
- PostgreSQL Testcontainers coverage, including in-transaction rollback when a
  decision cannot be made.

This is the "wall against hallucination": a governed decision is reproducible
from the deployed table, not re-derived from a model call.

### Phase 2 — Studio: native compiler

- The compiler (`lib/bpmn/compiler.ts`) now emits
  `bpmn:businessRuleTask` + `abada:decisionTable` directly — no external
  `abada:dmn` worker — with the `abada` namespace declared on the root.
- The transpiler (`lib/bpmn/transpiler.ts`) reads the native extension back
  into decision-table APL nodes with value coercion
  (`"true"` → `true`, `"21%"` → string, `"42"` → `42`), keeping a legacy
  fallback for pre-Phase-2 `abada:dmn` service tasks.
- `hitPolicy` narrowed to the engine-supported `FIRST | UNIQUE | COLLECT`;
  the `PRIORITY` option was removed from the property inspector.
- Shared helpers `normalizeTableInputs` and `resolveRuleOutcome` keep the
  vision's canonical YAML shape and the flattened form in sync.

### Phase 3 — Studio: explicit exploration and execution

- **Dry Run** (`features/run/DryRunPanel.tsx`) is deliberately local: it does
  not save, deploy, call an LLM, invoke tools or create an engine instance.
  It advances one visible token at a time and asks the author to mock agent
  output, choose non-deterministic branches and complete simulated human tasks.
- **Deploy & Start** (`features/run/DeployDialog.tsx`) is the only authoring
  action that persists execution state. It saves the project document, deploys
  the immutable APL revision and starts a project-scoped instance. Deploying a
  revision that was not dry-run requires an explicit warning acknowledgement.
- The Instances tab opens a read-only canvas for the selected instance. Studio
  polls active activities and durable history and applies only engine-reported
  running/completed/waiting/failed states. The instance DTO carries its exact
  definition deployment identifier so a later process version cannot alter
  this projection.
- **Review AI Optimization** opens the governed Insight proposal surface.
  Loading, empty and error outcomes are shown there and never redirect to the
  real-time audit stream.

### Phase 4 — Studio: post-transpilation authoring surfaces

Part 1 of the 1.1 execution plan (`docs/conductor/abada-execution-plan.md`):

- **Format badges & file metadata.** Every file carries a `.apl.yaml` vs
  `.bpmn` format pill and a runtime status tag (`[APL Native]` vs
  `[BPMN Imported]`) in the process list (`Sidebar.tsx`). The header shows
  only the clean process name (format, status tag, semantic version and the
  `abada.io/v1` language spec live in the Process Details modal,
  `components/ProcessDetailsModal.tsx`, opened from the filename). New
  canvases and APL parses default to the native APL format.
- **Native DMN rule inspector.** The Inspector's DMN section now uses a
  dedicated matrix editor (`features/dmn/DmnRuleInspector.tsx`): input
  variable mappings (name + `${...}` expression), ordered `when`/`then`
  rows with typed output cells (`STRING | NUMBER | BOOLEAN`), a hit-policy
  selector restricted to `FIRST | UNIQUE | COLLECT`, and an explicit
  `otherwise` fallback toggle. The widget mirrors the canonical APL
  decision-table node shape bidirectionally through
  `stringifyDecisionTableYaml` / `parseDecisionTableYaml` in
  `lib/apl/parser.ts`, so an imported YAML PR normalizes into the same rules
  the engine sees.
- **AI optimization review modal ("AI Diff").** A dedicated full-focus
  dialog (`features/designer/AIDiffModal.tsx`) replaces the old canvas
  overlay: the canvas stays untouched while a proposal is open. The modal
  offers a read-only graph diff (added nodes/edges in green, modified paths
  in amber, removed paths in red dashed, per-node annotations as `#
  OPTIMIZATION` YAML comments) plus a side-by-side base/proposed APL YAML
  diff, and an Insight Diagnostics panel with the proposal rationale and
  change ledger. Single-word `Reject`/`Approve` CTAs in the header; Esc or
  backdrop dismissal returns to the clean canvas. Approve adopts the
  proposed graph and bumps the semantic version; the demo proposal generator
  (`lib/aiDiff/*`) feeds the interactive showcase until the engine Phase 2
  wiring lands.
- Human-in-the-loop detection polls `GET /tasks?status=AVAILABLE` and matches
  the engine task name (the BPMN `userTask` name = the node **description**)
  against human nodes.

### Phase 5 — Studio: project file tree

The second part of the 1.1 execution plan
(`docs/conductor/abada-execution-plan.md`): the project became an IDE-like
workspace with folders and typed files.

- **Engine file tree.** New `project_folders` and `project_resources` tables
  (migration `V13`); process documents gain an optional `folder_id` and a
  display `file_name` decoupled from the immutable `metadata.key` and APL name.
  New projects are seeded with `processes/`, `forms/` and `resources/` root
  folders. A `GET /v1/projects/{projectId}/tree` endpoint assembles a recursive
  folder/document/resource tree with breadcrumb `path`s.
- **Folder semantics.** Folder names are unique per parent (root uniqueness is
  service-enforced); rename, move with parent-cycle rejection, and delete are
  available. Deleting a folder **archives** every contained process document
  (deployments and instances stay immutable) while its generic files are
  physically removed — documents are never hard-deleted.
- **Typed resources.** Generic files (`FORM | RESOURCE`) hold arbitrary
  content (BYTEA) with content type, size, SHA-256, optimistic revision and
  JSON-base64 upload/replace/download endpoints.
- **Locked system roots.** Every project owns exactly six mandatory system
  folders (`processes`, `resources`, `forms`, `media`, `agents`, `tests`)
  seeded at creation (migration `V14` backfills existing projects and freezes
  the root at the database level: the root holds only system folders). They
  can never be renamed, moved or deleted; the UI shows them locked and the
  engine rejects the operations. New user folders may only be created inside
  them, never at the project root — the Studio no longer offers root-level
  creation, a "Project root" move target or a root file import.
- **Root targeting.** Because JSON `null` cannot express "no parent", the
  Studio sends the empty string as the root sentinel; the engine normalizes
  blank parent/folder identifiers to `null`.
- **Studio Project Explorer.** The Sidebar **Project** tab renders the
  backend tree (`components/ProjectExplorer.tsx`): the six locked system
  folders at the top with expandable subfolders, documents and resources with
  hover row actions (rename inline, move to a folder, archive, delete — never
  on system roots), inline subfolder creation, per-folder file import
  (processes/ rows open the New Process dialog instead), a folder/clone
  picker for moves, a resource preview modal with replace content/download,
  and an Unsaved Drafts section for local files that have not yet been
  persisted by autosave.
- **New process targeting.** The New Process dialog offers three creation
  modes — **Empty APL** (empty canvas; the studio seeds the start event node
  because the engine requires at least one flow node, so first-time drawing
  and autosave both have a valid graph),
  **Import BPMN** (BPMN 2.0 XML transpiled to APL) and **Paste APL** (source
  parsed client-side) — and includes a **Target Folder** picker restricted to
  `processes/` and its subfolders (default `processes/`). File names are
  forced to `*.apl.yaml`; the chosen `folderId` is carried on the draft so
  project autosave persists the document into the selected folder. No project
  root option exists.
- **Folder domains.** The system roots are typed: `processes/` accepts only
  APL process documents (`*.apl.yaml`, authored via the New Process dialog —
  no generic file import, no non-APL moves), `forms/` accepts only `FORM`
  JSON files (import forces the `FORM` kind, `application/json` and a
  `*.json` name), and `resources/`, `media/`, `agents/`, `tests/` accept
  generic `RESOURCE` files. The move picker constrains targets accordingly —
  documents stay under `processes/`, forms under `forms/`, resources under
  the other roots, and user folders never leave their system root.
- The explorer replaces the flat workflow-file list; every tree document is
  APL-native (`.apl.yaml`), so the Phase 4 per-row format pill no longer
  applies there — the key/`processKey` invariant is enforced by the backend.

### Current checkpoint evidence

| Verification | Result |
| --- | --- |
| `./mvnw test` (Engine) | 235 tests, 0 failures or errors, PostgreSQL/Testcontainers included |
| `npm run lint` + `npm run build` (Studio) | 0 errors |
| Anonymous Studio session | Sign-in surface only; no project dialog or unauthorized project discovery |
| Alice development session | project Instances load without 403; exact deployed definition opens read-only |
| Dry Run | token advances from start to agent and pauses for explicit mock output |
| Insight review | governed empty state opens independently; audit stream remains a separate surface |
| Deploy & Start | payload and non-dry-run warning are explicit before any persistent action |

---

## Feature specifications

### 1. Designer canvas

**Route/view:** `designer` (default)

- Node palette (sidebar): **AI Agent**, **Human Task**, **Decision Table**,
  **Gateway**, **Trigger Event**; nodes are added to the canvas and connected
  with labeled edges.
- Node types serialize directly to native APL constructs:
  - start and end `event` nodes → APL `webhook` and `end` nodes
  - `agent` → APL `agent` with the versioned `abada.agent/v1` worker contract
  - `engine-task` → APL `engine-task` on the declared service topic
  - `human` → APL `approval-gate`
  - `dmn` → APL `decision-table` with deterministic rules and fallback
  - `gateway` with exclusive subtype → APL `condition` with labeled branches
  - `gateway` with parallel subtype → APL `parallel` (connecting ≥2 outgoing
    edges emits `branches`; a single outgoing edge makes it the join's `next`)
- Canvas node badges reflect **real run state only**: `idle`, `running`,
  `completed`, `failed`, `waiting` — applied from engine facts after a live
  run; sample workflows no longer carry hardcoded statuses.

### 2. APL pipeline

APL is specified in [`docs/reference/apl-specification.md`](../reference/apl-specification.md);
the canonical production example lives in [`examples/apl/kyc-onboarding.apl.yaml`](../../examples/apl/kyc-onboarding.apl.yaml).

```
WorkflowFile (React Flow model)
   │  workflowToAPL (lib/apl/parser.ts)
   ▼
APLDocument (Abada Process Language, version abada.io/v1)
   │  stringifyAPLYaml → project document → Engine AplParser
   ▼
Immutable executable definition

BPMN 2.0 XML  ──►  transpileBPMNToAPL  ──►  reviewable APL document
                         [explicit import compatibility boundary only]
```

- **Native path** stores and deploys canonical YAML directly. There is no XML
  round-trip between Studio and the APL-native engine.
- **Transpiler** reads standard BPMN back into APL. It recognizes native
  decision tables, agents (topic `abada:agent` or name heuristic), engine
  tasks, user tasks, gateways and events, and keeps the legacy `abada:dmn`
  service-task fallback.
- **APL YAML** is stringified in the vision's canonical shape (`inputs` as a
  map, `otherwise: { then: {...} }`) so AI-generated rule PRs use one stable
  form; both shapes are accepted on parse.

### 3. Deployment to engine

**Trigger:** **Deploy & Start** in the header.

1. Validate the JSON input payload and show whether the exact workflow
   fingerprint completed a Dry Run.
2. Save the current project APL document with its optimistic revision.
3. Deploy that document through
   `POST /v1/projects/{projectId}/documents/{documentId}/deploy`.
4. Start the resulting process key through
   `POST /v1/projects/{projectId}/processes/{processKey}/start`.
5. Open the created instance in the read-only Instances canvas.

Definitions are **immutable and versioned**. The instance response includes
`processDefinitionDeploymentId`; Studio uses it to resolve the exact deployed
APL source even when newer versions share the same process key.

### 4. Dry Run and live instance inspection

**Dry Run trigger:** **Dry Run** in the header.

- The payload editor is pre-filled by `deriveDefaultPayload` and validates a
  JSON object before starting.
- The local runner advances graph nodes one by one with loop protection. Agent
  nodes require a mocked output, exclusive/inclusive decisions require an
  explicit branch choice, and human tasks require simulated completion.
- Dry Run never persists a document, calls the Engine, invokes a model/tool or
  creates an instance. Its node colors are simulation state, not audit facts.

**Live inspection trigger:** select an instance from the project Instances tab
or complete **Deploy & Start**.

- Studio fetches the instance's exact immutable APL definition, then polls its
  project-scoped instance, active-activity and history endpoints every 1.5 s.
- Running token markers come only from active activities. Durable history maps
  completed, waiting and failed activities; terminal instance state marks the
  corresponding end/failure state.
- Live canvases are read-only: node moves, connections, editing controls and
  authoring actions are disabled. This prevents an observed instance from
  being mistaken for its mutable project document.

### 5. Audit log panel

Streaming log of deploy/run events with per-event type (event / dmn / agent /
human), status color, timestamp, and decision-output chips. Used to narrate
live runs (compile, deploy, start, decision applied, terminal state).

### 6. Task inbox (human-in-the-loop)

**Route/view:** `inbox` — lists engine tasks visible to the authenticated
user, i.e. assigned or claimable tasks (the engine's `/tasks` endpoint is
user-scoped). Completing a task from here advances the corresponding instance.

### 7. Operations view

**Route/view:** `operations` — process instances from the engine with status
and inspection within the Studio context.

### 8. Natural-language generation

**Trigger:** `NLInputBar` → project-scoped Engine authoring API → shared
OpenAI-compatible gateway → `AplParser` validation/repair → review-first APL
editor. The candidate never changes the active process before explicit user
approval. If the configured provider cannot answer, the Engine returns a
validated deterministic local starter with a visible fallback label.

### 9. Empty-project and APL authoring contract

- A project with no process documents opens an empty workspace canvas (no
  silent draft is persisted). The first visual mutation — a palette node, a
  connection, or applying pasted/validated APL — materializes a local draft
  rooted in `processes/`, and project autosave then persists the
  PostgreSQL-backed document with optimistic revisions.
- An empty process created through the New Process dialog is seeded with the
  start event node (the engine requires at least one flow node), so it is a
  valid document from the start and autosaves into its target folder.
- `Diagram` and `APL YAML` are two projections of the same process. Applying
  validated YAML replaces the active diagram while retaining its project
  document identity and revision.
- The empty canvas exposes visual, YAML and prompt entry points directly; the
  node palette remains available for incremental visual authoring.

### 10. Project file tree (IDE-like workspace)

**Surface:** the Sidebar **Processes** tab (`ProjectExplorer.tsx`, driven by
`ProjectAPI.tree`).

- **Content model.** Each project has root folders `processes/`, `forms/` and
  `resources/` at creation. A tree node is a `FOLDER`, a `DOCUMENT` (project
  APL process document) or a `RESOURCE` (generic typed file). Nodes carry a
  breadcrumb `path`; documents display their file name (`fileName` or the
  derived `<name>.apl.yaml`).
- **Folders.** The six system roots are locked (no rename/move/delete; shown
  with a lock badge). User folders are created inline only **inside** the
  system roots (subfolders of `processes/`, `resources/`, `forms/`, `media/`,
  `agents/` or `tests/`); no creation, import or move target exists at the
  project root. User folders can be renamed in place, moved between folders
  and deleted with a confirmation dialog. Deleting archives all contained
  process documents (kept for deployed instances) and permanently removes
  generic files and sub-folders.
- **Documents.** Clicking opens the process in the designer. Row actions:
  rename file (`PATCH /documents/{id}`), move to folder, archive
  (`POST /documents/{id}/archive`). Archived documents disappear from the
  tree and are read-only server-side.
- **Resources.** Imported per folder with a name, `FORM |
  RESOURCE` kind and content type; previewed in a modal (text decode for
  text/JSON/YAML/XML/CSV, download otherwise); content replaceable with
  optimistic revision; rename/move/delete available.
- **Drafts.** Unsaved local canvases appear in an **Unsaved Drafts** section
  until autosave persists them; the tree refresh key is bumped by App whenever
  a document is created or saved so the explorer stays server-authoritative.

### Projects created before the locked-root migration

Projects created before migration `V14` were backfilled with the six system
folders; pre-existing root-level documents and resources remain readable in
the tree (and can be moved into folders), but no new content can be placed at
the project root — the New Process dialog's folder picker and the move/import
actions offer only the system folders and their subfolders.

---

## Technical implementation

### Module map (`studio/src`)

```
src/
├── api/
│   ├── engine.ts        # EngineAPI client (deploy, start, instance, tasks, definitions)
│   ├── authoring.ts     # Project-scoped NL → validated APL candidate
│   └── projects.ts      # ProjectAPI client (tree, folders, resources, documents, members)
├── auth/
│   └── keycloakClient.ts# OIDC (Keycloak) init, token, getUserFromToken
├── config/
│   └── runtime.ts       # runtime-config (public/config.js) API URL etc.
├── data/
│   └── sampleWorkflows.ts # starter workflows (no hardcoded run statuses)
├── features/
│   ├── designer/        # Canvas, AplEditor, NodeRenderer (status + diff badges),
│   │                    #   EdgeRenderer, AIDiffModal (full-focus PR review)
│   ├── dmn/             # DmnRuleInspector (matrix editor + APL YAML mirror)
│   ├── run/             # DryRunPanel + DeployDialog
│   ├── inbox/TaskInbox.tsx
│   ├── operations/ProcessOperations.tsx
│   └── ai/ ...          # NL generation plumbing
├── lib/
│   ├── apl/             # APL types and parser
│   │                    #   parseAPLYaml, stringifyAPLYaml, normalizeTableInputs,
│   │                    #   resolveRuleOutcome, stringifyDecisionTableYaml,
│   │                    #   parseDecisionTableYaml, dmnConfigToAPLNode)
│   ├── aiDiff/          # AI optimization proposal types + demo generator
│   ├── bpmn/            # compiler.ts (APL → BPMN), transpiler.ts (BPMN → APL)
│   └── run/liveRun.ts   # payload defaults and engine-fact canvas overlays
├── components/          # Header (icon-only secondary actions, clean name +
│                        #   tooltips), Sidebar, ProjectExplorer (file tree),
│                        #   PropertiesInspector, SimulationPanel, NLInputBar
│                        #   (prompt dock, NL-only), NewWorkflowModal (folder
│                        #   target picker), ProcessDetailsModal, ui (IconButton)
├── App.tsx              # state hub: Dry Run, Deploy & Start, live inspection, authoring
└── types.ts             # WorkflowFile, WorkflowNode, SimulationLog, ...
```

### Engine API client surface

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `deployDocument(projectId, wf)` | `POST /v1/projects/{projectId}/documents/{id}/deploy` | deploy saved native APL |
| `startProcess(id, vars, projectId)` | `POST /v1/projects/{projectId}/processes/{id}/start` | create live instance |
| `getInstance(id, projectId)` | `GET /v1/projects/{projectId}/instances/{id}` | authoritative instance snapshot |
| `getActivityInstances(id, projectId)` | `GET /v1/projects/{projectId}/instances/{id}/activity-instances` | active live tokens |
| `getInstanceHistory(id, projectId)` | `GET /v1/projects/{projectId}/instances/{id}/history` | durable activity facts |
| `getDefinitionForInstance(...)` | `GET /v1/projects/{projectId}/processes?key=` | resolve exact deployment version |
| `getInstances(projectId)` | `GET /v1/projects/{projectId}/instances?size=20` | project Instances tab |
| `getTasks(status?)` | `GET /v1/tasks?status=` | waiting-task detection |
| `completeTask(id, vars)` | `POST /v1/tasks/{id}/complete` | human-in-the-loop |
| `failInstance(id)` | `POST /v1/processes/instance/{id}/fail` | incident handling |
| `tree(projectId)` | `GET /v1/projects/{id}/tree` | project file tree |
| `createFolder / renameFolder / moveFolder / deleteFolder` | `/v1/projects/{id}/folders…` | folder CRUD (empty string = root) |
| `createResource / getResource / replaceResource / renameResource / moveResource / deleteResource` | `/v1/projects/{id}/resources…` | typed file lifecycle (base64) |
| `renameDocument / moveDocument / archiveDocument` | `/v1/projects/{id}/documents/{docId}…` | file name, folder, archive |

### Authentication

- OIDC via Keycloak (`abada-frontend` client, realm `abada-dev` in dev),
  `studio.localhost` allowed as redirect origin.
- All engine calls carry `Authorization: Bearer <token>`.
- The engine receives the real Keycloak username on start so audit trails
  record the actual actor.

---

## Operations

### Local development

```bash
# bring up engine + postgres + keycloak + studio (dev profile)
./scripts/start-engine-for-studio.sh
# or, with the stack already running:
cd studio && npm ci && npm run dev
```

- Studio runs at `http://studio.localhost` (Compose) or the Vite dev URL.
- Demo user: `alice` / `alice`.

### Rebuilding the served image

```bash
cd studio && docker build -f Dockerfile.prod -t abada-studio:local .
cd .. && ABADA_STUDIO_IMAGE=abada-studio:local \
  docker compose -f compose.yaml -f compose.dev.yaml up -d abada-studio
```

### Verification

```bash
cd studio
npm run lint
npm run build
```

---

## Known boundaries (kept honest)

- **Agents wait for an external worker.** Agent steps compile to
  `serviceTask` topic `abada:agent`; with no worker running, a run stops there
  and reports ACTIVE. This is by design — agents must not advance BPMN state
  outside engine commands (1.1 track).
- **Live animation follows observable engine facts.** Studio does not slow the
  engine or invent intermediate activities to make an animation attractive.
  Very fast automatic transitions may therefore appear as completed between
  polls. Adding durable activity-entered/completed facts is the correct future
  way to make every such transition replayable.
- **Alice's global admin is development-only.** The bundled Alice user is
  temporarily assigned `abada-admin` so the current integration checkpoint is
  not blocked by permissions. Production multi-role hardening and the
  `ADMIN_ROOT` first-admin handoff remain roadmap gates.
- **hitPolicy is intentionally limited** to `FIRST | UNIQUE | COLLECT`; the
  engine rejects anything else at deployment (loud failure, not a guess).

---

## Future enhancements

- Wire a real agent worker (external-worker protocol) so agent steps complete
  live from the Studio.
- Add durable activity-entered/completed events for lossless live replay of
  fast automatic paths.
- Per-run diff of instance variables (before/after each decision table).
- Decision-table outcome preview before deploy (client-side evaluation of the
  compiled table against the current payload).
- Enrich the AI Diff overlay with true engine telemetry (OTel spans and API
  failure signals) instead of the demo proposal generator
  (`lib/aiDiff/demo.ts`), per Phase 2 of the 1.1 execution plan.
- Wire the Governance Engine approval gates (Phase 3) so Approve commits the
  versioned definition to PostgreSQL instead of only updating the local
  canvas.
- Mirror this specification into the Starlight user/developer guide.

---

## Conclusion

Studio is the authoring surface where Abada's doctrine becomes executable:
deterministic decision tables declared visually are compiled to native engine
constructs and proven live in-transaction, while probabilistic agents remain
bounded, external work. The 2026-08 phases took Studio from a mockup to a
real execution authority, and this specification records both the operations
and the honest boundaries that keep that claim true.

## 1.0 pitch additions

The 1.0 pitch cycle (end of August 2026) expanded Studio from an authoring
shell into the platform's consolidated operator UI. The following decisions
were taken together; treating them as a single unit keeps the user guide,
operations doc and CodeBuddy handoff internally consistent.

### Decision: Studio is the only operator UI in default deployments

- Tenda and Orun remain in the repository for reference and migration, but
  the supported Compose profiles (`compose.yaml` + `compose.dev.yaml` /
  `compose.prod.yaml`) start only the engine and Studio.
- Studio's shell now contains four panels: **TaskInbox**, **Operations**,
  **Administration**, **Insight**. The header exposes each as a tab and the
  Administration tab is gated on the `abada-admin` JWT group.

### Decision: external IdP operations are proxied, not bypassed

- A new `com.abada.engine.identity` package wraps the Keycloak Admin API.
- All mutations live under `/api/v1/admin/**` (see
  [`/docs/reference/api-v1.md`](../reference/api-v1.md#platform-administration)).
- A dedicated confidential client `abada-admin-api` authenticates the engine
  to Keycloak via the client-credentials grant; the engine holds the secret
  in the environment, never in the realm import on shared machines.
- The service-account token is cached for 30 s less than its declared
  lifetime; a `401` from Keycloak forces a refresh on the next call.

### Decision: principal membership search uses a lazy cache

- The Projects → Members dialog searches the engine's `PrincipalEntity`
  cache, not the IdP directly.
- The cache is populated by `IdentityContextInterceptor` on each
  authenticated request. A freshly created Keycloak user therefore becomes
  project-searchable only after they have signed in at least once.
- This is intentional: it keeps the engine's read path consistent with its
  durable state and avoids polling the IdP for every member search. The
  trade-off is documented in the user-guide page
  [`/documentation/.../user/identity.mdx`](../../documentation/src/content/docs/user/identity.mdx).

### Decision: Operations accepts an optional projectId

- `ProcessOperations` fetches KPIs, tasks and incidents without a
  `projectId` when one is not provided. The panel auto-selects an active
  project and surfaces a project picker.
- Internal `!projectId` guards have been removed; the bounded filter and
  the auto-refresh interval both run unconditionally.

### Decision: Studio Insight tab exposes `InsightAPI.reviewProposal`

- The Insight tab lists pending proposals with `InsightProposalSummary`
  cards, opens a `InsightProposalDetail` with a `proposedSource` diff, and
  routes approve / reject through `InsightAPI.reviewProposal` with the
  `expectedUpdatedAt` optimistic-locking token.

### Deferred (post-pitch)

- A dedicated Audit tab in Studio. Engine audit trail rows already capture
  every admin mutation with actor + trace ID + timestamp, but the UI table
  is not part of this release.
- Bulk user import (CSV / SCIM). The IdP proxy supports it via
  `POST /v1/admin/users` in a loop; the Studio UI does not yet expose a
  bulk form.
- Multi-tenant project picker polish (server-side search, pagination on
  the project dropdown).
