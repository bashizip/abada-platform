# M6 task specifications — 1.2.x

The tasks of the release after 1.2.0. The roadmap lists them; this file holds
what each one means. New features only: nothing deferred from 1.2.0 lands here.

---

## N1 — Office and text files as agent input

**Goal.** An agent node reads the documents regulated organisations actually
exchange, not only scans: spreadsheets (payroll lists, employer declarations,
bank statements), Word documents (letters, contracts) and plain-text exports.
The S15 contract stays as it is: files declared in `files`, checked when the
work is locked, verified by sha256, never journaled or logged, typed errors
instead of silent cuts.

**Why.** S15 covers images and PDF, which the model providers read directly.
Most providers do not accept Office files on the chat API Abada uses (OpenAI's
Chat Completions takes only PDF as a file part), so supporting them means
converting first. Converting is also the better design: a model reads a
spreadsheet far more accurately as rows of text than as a picture, at a
fraction of the tokens, and a conversion that runs on the installation's own
servers keeps the sovereignty promise (only the extracted content reaches the
model).

**Formats.**

| Format | Content types | Sent to the model as |
| --- | --- | --- |
| Plain text | `text/plain`, `text/csv`, `application/json`, `text/markdown` | text, inside a `<document>` block, no conversion |
| Excel | `.xlsx` (and `.xls` if the converter supports it) | structured text: one block per sheet, header row and rows as CSV or JSON rows |
| Word | `.docx` (and `.doc`, `.odt` if the converter supports it) | text with headings and tables kept, or PDF where the provider reads PDF |
| OpenDocument | `.ods`, `.odt` | as Excel and Word |

Audio, video, archives and macros are out of scope.

**Where the conversion runs.** On the installation's infrastructure only,
never at the model provider. Two options to decide at the start of the task:

1. In the agent worker, with Java libraries (Apache POI for Excel and Word,
   a CSV writer): no new service, bounded memory per file.
2. A converter service in the Compose stack (LibreOffice headless) that the
   worker calls on the local network: broader format coverage, one more
   service to run and secure.

Either way: no macro or external link is evaluated, conversion has a time
limit and a size limit, and a file that fails to convert is a typed error.

**Limits.** Per file and per call, configurable by the operator: at most N
sheets, N rows per sheet, N characters of converted text (defaults to set in
the task). Over a limit is `AGENT_FILE_LIMIT`, never a truncated document sent
as if it were whole.

**Errors.**
- `AGENT_FILE_UNSUPPORTED`: the format is not one the installation converts.
- `AGENT_FILE_CONVERSION_FAILED`: the converter could not read the file
  (corrupt, encrypted, password-protected), or ran out of time.
- `AGENT_FILE_LIMIT`: as in S15, plus the conversion limits above.

**Evidence.** For a converted file, the step journal keeps two hashes: the
sha256 of the original file (as S15) and the sha256 of the converted content
the model read, with the converter's name and version. An auditor can prove
both what was uploaded and exactly what the agent saw. The converted content
itself follows the evidence payload policy (`none`, `redacted`, `full`); the
original bytes are never journaled.

**Engine.** `files` accepts the new content types; deployment unchanged. The
lock-time checks of S15 are unchanged. The provider capability table in the
worker gains a "sent as text" family that every provider accepts.

**Studio.** The *Files* section lists the new accepted types and says when a
file is converted before the model reads it; the agent-step inspector shows
both hashes.

**Acceptance tests.**
- A CSV and a JSON file reach a stub model as text.
- An `.xlsx` with two sheets reaches it as two structured blocks with exact
  cell values (numbers, dates, empty cells).
- A `.docx` with a table keeps the table's rows.
- An encrypted or corrupt file, and a file over each limit, fail with the
  typed code.
- No original bytes in the journal or the logs; both hashes in the evidence.
- A macro-enabled file runs no macro.
- End to end: an employer declaration spreadsheet uploaded in a human task is
  read by an agent, its totals pass `output_schema`, and the evidence shows
  both hashes.

**Documentation.** `process-files.md` (formats, where conversion runs,
limits), the APL reference for `files`, the user guide section *Let an agent
read a document*, and one example process reading a spreadsheet.

---

## G — Git sync (opt-in, additive)

**Goal.** Teams keep their process definitions in their own Git repository,
review changes with the tools they already use, and trace every deployed
version back to a commit.

**Guardrails.** Decisions already in this roadmap win; nothing that works today
changes.
- APL (YAML) stays the format; BPMN stays an import boundary; decision tables
  and forms stay inside APL.
- PostgreSQL stays authoritative for Studio documents, with the optimistic
  revisions of the project envelope. Definition versions stay immutable.
- Insight adoption (E15) and one-click rollback (E16) keep working in every
  project.
- No new required service, no new dependency at install time, nothing that
  contacts us. Existing secrets keep `ABADA_ENCRYPTION_KEY`; M7 C6 is
  unchanged.
- Every step is opt-in. A project that does not use Git sees no change.

Steps ship in order, each usable on its own. The release each step ships in
is set later. 1.2.0 is the release Abada is marketed with; Git sync is not
needed for that.

**Target.** A developer creates an Abada project on their machine (for
example with a VS Code extension), imports it into Studio, and Git keeps the
local copy and a Studio hosted anywhere in sync. G1–G3 build the parts that
need no new tool: one project layout, provenance by commit, a project that
follows a branch. G4 and the editor extension come on top of them.

**Project layout.** One project per repository, plain files, diff-friendly.

```text
my-project/
├── abada.project.yaml        # project name and description; no secret, no runtime data
├── processes/                # follows the Studio project tree (folders allowed)
│   └── *.apl.yaml            # one APL document per process
├── tests/*.test.yaml         # later: declarative scenarios (not part of G1)
└── README.md                 # ignored by import
```

`.apl.yaml` is the extension already used by the examples and the APL
reference. There is no `decisions/` folder: decision tables live inside APL
(ADR-002), and so do human-input forms and scripts. BPMN files are not part of
the layout; BPMN stays an import path into APL.

### G1 — Project export and import as APL files

**Work.** Export a project in the layout above: its documents as
`processes/**/*.apl.yaml` following the Studio project tree, plus
`abada.project.yaml`. Import such a
folder through the existing document service: a new key creates a document,
an existing key saves a new revision under the usual `If-Match` check, and a
stale revision is refused, never overwritten. Serialisation is deterministic
(fixed key order, fixed indentation, final newline) so that a diff shows only
real changes. Archived documents are exported only on request.

**Not in scope.** Instances, history, Insight data, files, credentials and
settings: this is the source of the processes, not a backup.

**Acceptance.**
- Export, import into an empty project, export again: the two folders are
  identical, byte for byte.
- Import over a document edited in the meantime is refused with the usual
  revision conflict.
- Moving a node on the canvas changes only the layout lines in the diff.
- No Flyway migration; the existing document API tests still pass.

### G2 — Deployed versions traced to a commit

**Work.** Deployment accepts optional source fields: repository URL, ref and
commit SHA. They are stored on the definition version (one Flyway migration
adding nullable columns, empty for every existing version) and shown in Studio
next to the version and in the audit. A documented CI recipe for GitHub
Actions and GitLab CI validates each file with `POST /v1/apl/validate` and
deploys from the main branch with the commit SHA. Abada itself still does not
talk to any Git server.

**Acceptance.**
- A version deployed with a SHA shows it in Studio and in the admin audit; a
  version deployed without one behaves exactly as today.
- Upgrade test from the previous schema with existing versions.
- The recipe runs against a real engine in CI.

### G3 — Git-managed projects (read-only, per project)

**Work.** An owner can link one project to a repository and branch. Abada
pulls on a webhook or on a schedule (HTTPS token or SSH deploy key, stored
encrypted like tool credentials), imports with G1, and deploys with G2
traceability. Only that project's documents become read-only in Studio, with
a banner naming the repository and commit. GitHub, self-hosted GitLab, Gitea
and Forgejo work the same way, since only plain Git is used. Unlinking
returns the project to normal editing.

E16 rollback stays available as an emergency action: Studio then shows that
the deployed version differs from the branch head until Git catches up.
Insight proposals in a Git-managed project are exported as a patch to apply
through a pull request rather than adopted in place.

**Acceptance.**
- A push to the linked branch is deployed with its SHA; a push that fails
  validation deploys nothing and shows the error.
- Studio refuses edits to a Git-managed project and accepts them in every
  other project.
- A rollback in a Git-managed project works and shows the drift.
- Works with a self-hosted Git server with no Internet access.

### G4 — Two-way sync between a local project and Studio (later)

Studio commits an edit to a working branch and opens a pull or merge request,
so that a project edited locally and in a hosted Studio stays in sync through
Git, conflicts shown and never overwritten. A local authoring tool (for
example a VS Code extension that validates `.apl.yaml` files against
`GET /v1/apl/schema`) builds on the same layout. Planned once G3 is in use.
