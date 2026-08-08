# Project Envelope Architecture

Last reviewed: 2026-08-08.

A Project is Abada's durable product, authorization and governance boundary. A
process definition no longer exists as an unowned global object: it belongs to
exactly one project, and its stable APL `metadata.key` is unique only inside
that project. Multiple processes in a project share catalog and governance
context; they do not implicitly share mutable runtime variables.

## Durable model

PostgreSQL is authoritative for projects, observed principals, memberships,
worker bindings and Studio documents. `projects` owns immutable identifiers,
human metadata and the `ACTIVE`/`ARCHIVED` lifecycle. Existing definitions and
instances are migrated to the deterministic `Default` compatibility project.
Legacy non-project API routes remain aliases for that project.

Studio APL documents are server-side records with optimistic revisions. The
client sends the current revision in `If-Match`; a stale save is rejected
instead of silently overwriting another editor. Deploying a document compiles
its exact saved APL into a new immutable definition version in the same
project. `metadata.key` cannot change after document creation.

Project archive is reversible and is not deletion. It blocks document edits,
deployment and new starts. Already-running instances remain executable so
operators can drain the project without corrupting durable state.

## Authorization model

Project capability roles are fixed and cumulative by assignment:

| Role | Capability |
| --- | --- |
| `OWNER` | Metadata, archive, members, roles, review lanes and worker bindings |
| `MAINTAINER` | Author, autosave and deploy project process documents |
| `OPERATOR` | Start and operate project instances and correlate project events |
| `REVIEWER` | Participate in explicitly assigned Insight approval lanes |
| `VIEWER` | Read the project catalog, definitions, instances and eligible tasks |

Creating a project requires the global `project:create` permission. The
creator receives Owner, Maintainer, Operator and Viewer, but deliberately not
Reviewer. This prevents project ownership from silently satisfying business
approval.

Approval lanes such as `TECHNICAL` and `COMPLIANCE` are separate from roles.
A reviewer must hold `REVIEWER` and the lane named by the snapshotted proposal
policy. A global administrator may recover or operate a project but cannot
manufacture an approval-lane vote.

Principals are learned from authenticated identities using `(issuer, subject)`
as the stable key. Human owners can only add a principal after Abada has
observed it. Service principals require both the global worker authority and a
project/topic worker binding. Secured fetch-and-lock requests include
`projectId`; acquisition joins the authoritative process-instance project so
work cannot leak across projects.

## Scoped surfaces

Canonical endpoints live under `/v1/projects/{projectId}` for process
documents, definitions, instances, operational state/history, incidents, user
tasks and statistics, event correlation and Insight governance. PostgreSQL
queries include the project boundary before returning or locking work. Insight
facts, findings, proposals and policies carry a project identifier, and
adopted proposals redeploy into that same project. Legacy operations, task,
event and incident routes resolve only the deterministic `Default` project.

Studio exposes a project switcher with **New project** and **Open project**,
loads only that project's documents, and uses PostgreSQL-backed optimistic
autosave. Its Access view manages fixed roles and named review lanes. Realtime
co-editing, Git synchronization and project bundle import/export are not part
of this first envelope release.
