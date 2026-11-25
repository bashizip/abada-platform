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

# Governed projects: Git, vault and field encryption (1.2.1 → 1.2.3)

Source: *Abada — Roadmap 1.2.x* (Patrick, 2026-11-14). Three new features
that serve one goal: make Abada governable and auditable for regulated sectors
(banks, mining, social security) without giving up sovereignty.

| Feature | In the source | Tasks here | Brings | Depends on |
| --- | --- | --- | --- | --- |
| Projects synchronised with Git (GitHub, GitLab) | A | G1–G3 | Versioning, PR/MR review, every deployment traced to a commit | — |
| Secrets in an OpenBao vault | B | V1–V2 (then M7) | No secret outside a vault, HSM unseal, audited access | — |
| Transit encryption of sensitive fields | C | K1 | Business fields encrypted at field level, Abada never holds the key | V1 |

The source names the features A, B and C. The task ids here are G, V and K
because C1–C8 already name the M7 tasks.

A and B meet: the Git repository holds only references to secrets and a
manifest, which deployment checks against the vault.

**Sequencing.** The vault (V1) ships in 1.2.1 together with the repository
layout (G1): a Git repository must never contain a secret, not even in one
commit. Each release delivers a slice of G and of V; Transit encryption (K1)
comes last because it relies on the vault.

| Release | Git | Vault | Encryption |
| --- | --- | --- | --- |
| 1.2.1 Foundations | G1 repository layout, export and import, manual push, SHA traceability, prod read-only | V1 OpenBao required, references, manifest | — |
| 1.2.2 Synchronisation | G2 webhooks, dev two-way sync, conflicts, branch ↔ environment | V2 HSM over PKCS#11, dynamic secrets | — |
| 1.2.3 Review | G3 PR/MR from Abada, `abada validate` / `abada test` CLI, CI templates, tag deployment, signed commits | — | K1 Transit encryption, sensitive fields |
| M7 | — | Kubernetes auth, cloud KMS auto-unseal | — |

**Out of scope for 1.2.x.** Multi-project monorepos, tests written as code,
real-time collaborative editing, built-in Git hosting. Kubernetes auth and
cloud KMS auto-unseal are planned for M7.

**Open points.**
- Target dates for 1.2.1, 1.2.2 and 1.2.3.
- Search and filtering on an encrypted field: is a deterministic hash
  (convergent encryption) needed to allow exact-match search, for example by
  tax number (NIF)? See K1.
- The reconciliation notes at the end of this section, to settle before G1
  and V1 start.

---

## G — Projects synchronised with Git

**Goal.** An Abada project is a folder of files in a Git repository, one
project per repository. Git is the only source of truth in production.

**Decisions (2026-11-14).**
1. Source of truth: Git only. In production Abada is read-only and a change
   goes through Git with a PR/MR. In development a project can be edited in
   Abada, and the edit is synchronised to a branch.
2. One project per repository. Access rights follow the repository's.
3. Tests are declarative YAML scenarios, readable by business analysts and run
   by `abada test`.

**Why.**
- Governance and audit: every change is a traced commit (author, date,
  reason).
- Four-eyes principle: every production change goes through an approved
  PR/MR.
- Sovereignty: GitHub, self-hosted GitLab, Gitea and Forgejo are supported.
- Developer adoption: teams keep their tools (diff, branches, CI/CD).

**Repository layout** (as in the source; see reconciliation note 1).

```text
my-project/
├── abada.project.yaml
├── processes/*.bpmn
├── decisions/*.dmn
├── forms/*.form.json
├── scripts/
├── environments/
│   ├── dev.yaml
│   └── prod.yaml        # secret references only
├── secrets.manifest.yaml
├── tests/*.test.yaml
└── README.md
```

The format is stable and diff-friendly: attribute order is fixed, and moving
an element on the canvas adds no noise to the diff.

**Test scenario example.**

```yaml
name: Monthly declaration — nominal case
process: declaration-employeur
input:
  employeur_id: "EMP-001"
  nb_salaries: 12
expect:
  path: [verifier_dossier, calculer_cotisations, valider]
  variables:
    statut: "VALIDEE"
```

**Synchronisation.**
- Development: two-way. An edit in Abada is committed to a working branch; a
  push to Git is re-imported through a webhook. Conflicts are detected and
  never silently overwritten.
- Production: one way, Git → Abada. A merge to `main` or a tag triggers
  validation, then deployment. The editor is locked.

**Branches and deployment.**
- Each branch maps to an environment (`dev` → dev, `main` → prod).
- Production deploys only from `main` or a tag (`v1.4.0`).
- Every deployed definition keeps its commit SHA: from any instance one can
  go back to the exact code.
- Running instances stay on their version; new instances take the new one.

**Review flow.**
1. An edit in dev creates a branch.
2. A PR/MR is opened from Abada.
3. CI runs `abada validate` and `abada test` (GitHub Actions and GitLab CI
   templates provided).
4. An approver merges.
5. Production is deployed. The PR/MR status shows in Abada.

**Authentication.** GitHub App or OAuth, GitLab token, SSH deploy key for
generic Git. Optional commit signing (GPG or SSH), verified at deployment.

### G1 — Repository layout and traceability (1.2.1)

Repository layout, export and import, manual push, traceability by commit SHA,
production locked read-only.

### G2 — Synchronisation (1.2.2)

Webhooks, two-way synchronisation in dev, conflict handling, branch ↔
environment mapping.

### G3 — Review from Abada (1.2.3)

PR/MR opened from Abada, `abada validate` and `abada test` CLI, CI templates,
deployment by tag, signed commits.

**Acceptance (G1–G3).**
- A project exported then re-imported is identical, byte for byte.
- A Git push is visible in Abada in under one minute.
- No production change is possible from the Abada interface.
- No production deployment is possible without a traced commit.
- It works with a self-hosted GitLab with no Internet access.

---

## V — Secrets in an OpenBao vault

**Goal.** No secret outside a vault, in any installation. Processes and the
Git repository hold only references. No home-grown vault: Abada integrates
OpenBao, the open-source fork of HashiCorp Vault.

**Decisions (2026-11-14).**
1. A vault is required everywhere, dev and demo included: either the OpenBao
   bundled with the Abada stack, or the customer's own Vault or OpenBao.
2. Two ways to manage secrets: a write-only Abada screen (create, update and
   rotate a secret, never read its value back), and direct access to OpenBao
   (CLI, UI, API) for security teams.
3. Officially supported HSMs: SoftHSM (dev and CI), Nitrokey NetHSM,
   Utimaco/Thales, Securosys (CloudHSM).

**In processes.**
- References are written `${secret:<name>}` in process definitions,
  connectors and `environments/*.yaml`.
- `secrets.manifest.yaml` lists the required secrets. Deployment is refused
  if one is missing in the target environment.
- Resolution is late, by the worker, just before the external call. A secret
  never enters variables, history, logs or exports.
- A secret value that appears in a log is masked automatically.
- `abada validate` detects plain-text secrets in the repository.

**OpenBao integration.**

| Aspect | Choice |
| --- | --- |
| Abada authentication | AppRole (VM, bare metal); Kubernetes auth in M7. No static token |
| Paths | `abada/<project>/<env>/<secret>` |
| Policies | One per project and environment, generated by Abada (least privilege) |
| Static secrets | KV v2 engine, versioned, with rollback |
| Dynamic secrets | Database engine: temporary credentials generated per task |
| Rotation | Re-read on every access with a short cache, no redeployment |
| Audit | OpenBao audit device on by default, correlated with the Abada audit (instance, task, secret, timestamp, never the value) |

**Unseal (master key).**
- Dev and demo: Shamir.
- Regulated production: auto-unseal by HSM through the PKCS#11 seal. This is
  irreversible once initialised, and the key must be created on the HSM
  before initialisation.
- Documented fallback chain: HSM, then Transit, then manual Shamir with the
  recovery keys.
- M7: auto-unseal by cloud KMS, through the external KMS plugins available
  since OpenBao 2.6.0.

**Deliverables.**
- OpenBao packaged in the sovereign stack (guided installation, init and
  unseal).
- One integration guide per supported HSM (reference guides: Utimaco,
  Nitrokey NetHSM, Securosys).
- PKCS#11 integration tests in CI with SoftHSM.

### V1 — Bundled vault, required (1.2.1)

OpenBao bundled and required, AppRole, KV v2, policies, references, manifest,
masking, write-only screen, Shamir and SoftHSM.

### V2 — HSM and external vaults (1.2.2)

PKCS#11 with Nitrokey, Utimaco/Thales and Securosys, HSM guides, the
customer's external vault, dynamic secrets.

### M7 — Kubernetes auth and cloud KMS

Kubernetes auth method and cloud KMS auto-unseal. Not yet placed among
C1–C8 (see reconciliation note 4).

**Acceptance (V1–V2).**
- No Abada installation starts without a reachable vault.
- No secret value is visible in the UI, the API, the logs, the history or
  Git.
- A rotation takes effect without redeployment.
- A restart with an HSM unseals with no human intervention.

---

## K1 — Transit encryption of sensitive fields (1.2.3)

**Goal.** Some business variables (tax numbers, salaries, insured persons'
data, bank accounts) are encrypted at field level by OpenBao's Transit
engine. Abada never holds the key. A separate feature that requires V1.

**Work.**
- Fields are declared sensitive in the data model or the form
  (`sensitive: true`).
- They are encrypted on write and stored encrypted in the database, in the
  history and in exports.
- Decryption is reserved for authorised tasks and roles, and every decryption
  is audited.
- Transit key rotation needs no bulk re-encryption, thanks to progressive
  rewrap.

**Acceptance.**
- A `sensitive` field never appears in clear in the database, the history or
  an export.
- An unauthorised role sees the field masked.
- A key rotation interrupts no running instance.

**Open point.** Search and filtering on an encrypted field: is a deterministic
hash (convergent encryption) needed to allow exact-match search, for example
by tax number?

---

## Reconciliation with the rest of the roadmap (to settle)

The source was written separately from this file. These points disagree with
what the repository says today; none is decided here.

1. **Process files in the repository.** The layout lists `processes/*.bpmn`,
   `decisions/*.dmn` and `forms/*.form.json`. In Abada, APL (YAML) is the
   primary language and BPMN only an import boundary; decision tables are
   inline in APL, not DMN ([ADR-002](../adr/ADR-002-native-decision-tables-deterministic-wall.md),
   [BPMN support](../reference/bpmn-support.md)); forms live in the
   `human-input` node. A layout with APL files (and optional BPMN imports) is
   likely meant.
2. **Project envelope.** [`project-envelope.md`](../architecture/project-envelope.md)
   makes PostgreSQL authoritative for Studio documents and lists Git
   synchronisation and bundle import/export as outside the first envelope.
   G1 changes that: the architecture page needs a new section (Git as source
   of truth in prod, PostgreSQL in dev, how optimistic revisions meet commits).
   Environments (`dev`, `prod`) are not a project concept yet.
3. **Governed improvement in a read-only prod.** M4 adopts Insight proposals
   and rolls back with one click by redeploying in Abada (E15, E16). With Git
   as the only source of truth in production, an adoption or a rollback has to
   become a PR/MR or a revert commit.
4. **Vault and M7 C6.** C6 supports External Secrets Operator (GCP Secret
   Manager, AWS Secrets Manager, Vault) to keep secrets out of chart values.
   V1 makes a native OpenBao integration required everywhere, and the source
   adds Kubernetes auth and cloud KMS auto-unseal to M7. Whether ESO stays
   next to the native integration (chart credentials) or is replaced, and
   which C task takes the M7 part, is open.
5. **Required infrastructure.** The product definition says PostgreSQL (plus
   RustFS from 1.2) is the only required infrastructure. A required vault adds
   a third service to every installation, the one-command installer and the
   dev Compose stack.
6. **Existing secrets.** AI provider keys and tool credentials are stored
   AES-GCM encrypted in PostgreSQL with `ABADA_ENCRYPTION_KEY`, and agent
   evidence is encrypted the same way. V1 has to say whether they move into
   OpenBao and how existing installations migrate.
7. **`sensitive: true` already exists.** In APL `metadata.variables` it masks
   a variable in redacted agent and decision evidence. K1 extends it to
   encryption at rest; the two meanings and what an agent (and therefore the
   model provider) may decrypt need one definition.
8. **Version numbers.** 1.2.1–1.2.3 carry new features while 1.1.1 and 1.1.2
   were fix releases; a fix release after 1.2.1 needs a number. N1, the SDK
   track (L1, L2) and M7 C1–C3 are also announced for 1.2.x without a slot.
9. **CLI.** There is no `abada` command-line tool today; `abada validate` and
   `abada test` are new deliverables (G3), next to `POST /v1/apl/validate`
   and Dry Run.
10. **Tenancy.** Vault paths `abada/<project>/<env>/<secret>` carry no tenant;
    M8 P3 puts secrets per tenant.
