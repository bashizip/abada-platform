# Human-input nodes, forms & Task Inbox — 100% working plan

## Goal

Make the human-input feature reliable end to end: author a form, link it to a
human node, deploy, get a task in the Task Inbox, claim it, render the form
(pre-filled with current variables), submit with validation, complete, and
advance the process with the submitted variables. Scope: engine + Studio only;
Tenda stays frozen.

## Canonical contract

- **Identifier: `formKey`** everywhere. BPMN `camunda:formKey` → APL `formKey`
  → task `formKey` → `TaskDetailsDto.formKey`. `formId` is a deprecated alias
  accepted on APL parse only.
- **Meaning:** a project-unique logical key resolving to a FORM project
  resource **by bare slug** (e.g. `loan-approval` → `forms/loan-approval.json`).
  Forms are mutable live resources: edits render on running tasks.
- **Schema:** `{ title?, fields: [{ id, type, label, required?, options?,
  defaultValue?, placeholder? }] }`; `type ∈ string | number | boolean |
  select | textarea | date`. `field.id` IS the process-variable name; every
  renderer binds by `id`, never by label.
- **Transport:** `TaskDetailsDto` already carries `formKey`, `projectId`,
  `variables`. Studio `EngineUserTaskDTO` must match it.

## Phase 1 — Engine

- `FormController` at `/v1/projects/{projectId}/forms`:
  - `GET /forms` — list FORM resources (id, name, kind, revision, updatedAt).
  - `GET /forms/{formKey}` — resolve by slug → return decoded schema JSON.
    Project VIEWER+ access. `ProjectTreeService` gains a
    slug→resource lookup within the forms root folder.
- `ProjectTaskController` additions (project-scoped): `GET /{taskId}`,
  `POST /{taskId}/claim`, `POST /{taskId}/unclaim`, `POST /{taskId}/fail`.
- New `GET /v1/tasks/mine` — project-agnostic list of all visible tasks
  (assignee/candidate) with full `TaskDetailsDto` incl. `projectId`. Legacy
  `/v1/tasks` (frozen 0.11 contract) untouched. Claim/complete always use
  project-scoped routes with the task's own `projectId`.
- Deploy validation: a non-empty `formKey` that does not resolve yet is a soft
  **warning** in the deploy report, not an error (forms are live resources).
- BPMN import: map `camunda:formKey` on user tasks to canonical `formKey`
  (drop strict-mode error); update `camunda-7-profile.md` +
  `BpmnDirectiveValidatorTest`.

## Phase 2 — Studio: rename + shared schema & renderer

- Rename `formId` → `formKey` across `types.ts` (HumanConfig),
  `lib/apl/types.ts`, `lib/apl/parser.ts`, `lib/apl/parser.test.ts`,
  `lib/bpmn/compiler.ts`, `lib/bpmn/transpiler.ts`, `lib/bpmn/compiler.test.ts`,
  `App.tsx:228`, `docs/reference/apl-node-reference.md`. Engine `AplParser`
  reads `formKey` with `formId` fallback.
- Extract canonical schema types + a typed `FormRenderer` into a shared Studio
  module (`features/inbox/formSchema.ts`, `features/inbox/FormRenderer.tsx`)
  reused by the Task Inbox and builder preview; values bound by `field.id`.
- `FormEditor.tsx`: add `textarea` + `date` types and `defaultValue`; keep
  save-via-ProjectExplorer.

## Phase 3 — Studio: human node form picker

- `PropertiesInspector` human section: dropdown of the project's FORM
  resources (via the new forms endpoint) plus "New form…" (opens FormEditor,
  saves a FORM resource, sets the key). Stores the bare slug as `formKey`;
  free-text fallback kept. Show a hint when the key matches no project form.

## Phase 4 — Studio: Task Inbox full flow

- Rebuild `TaskInbox.tsx`:
  - List: per-project (`/v1/projects/{id}/tasks`) and cross-project
    (`/v1/tasks/mine`) modes; status filter.
  - Detail: render the resolved form when `formKey`+`projectId` present;
    default decision UI otherwise.
  - Actions: claim (AVAILABLE), unclaim, fail, complete — project-scoped.
  - Complete: collect values by `field.id`, type-coerce, validate required →
    `complete(taskId, values)`.
- `EngineAPI`: add `claimTask/unclaimTask/failTask/getTaskDetail`; extend
  `EngineUserTaskDTO` with `formKey`, `projectId`, `variables`, `status`,
  `candidateGroups`, `startDate`, `dueDate`.
- Match the Studio design system (as in the Admin polish).

## Phase 5 — Tests, docs, release notes

- Engine tests (Testcontainers): forms list + resolve-by-slug,
  `camunda:formKey` import, APL `formKey` (+ `formId` alias), deploy warning,
  project claim/unclaim/fail, `/v1/tasks/mine`, and end-to-end: deploy human
  node with formKey → start → task carries formKey+projectId → complete with
  form values → variables land.
- Studio tests: compiler/transpiler round-trip with `formKey`; `FormRenderer`
  binds by `id`.
- Docs: `bpmn-support.md`, `runtime-semantics.md`, `apl-node-reference.md`,
  `camunda-7-profile.md`, `docs/release-notes/1.0.0-rc.3.md`. Tenda gets no
  code changes; release notes state its legacy form flow is superseded by
  Studio.

## Definition of done

Design → author form → pick it on a human node → deploy → start → task in
Inbox (project & cross-project) → claim → form renders pre-filled → submit →
validation → complete → process advances with correct variables. Verified by
Phase 5 tests + a live smoke test.
