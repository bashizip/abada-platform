# Process files

Since 1.2 (M5 S9) a human-task form can take files. This page is the contract
for how they are stored, attached, read and deleted. The other references link
here: [runtime semantics](runtime-semantics.md#files-in-human-tasks),
[runtime state](../architecture/runtime-state.md#process-files),
[deployment support](deployment-support.md#object-storage-rustfs),
[API v1](api-v1.md#process-files) and the `file` field of the
[task form schema](apl-node-reference.md#task-form-schema).

## Where the bytes and the metadata live

| What | Where | Why |
| --- | --- | --- |
| File contents | RustFS, the self-hosted S3-compatible object store, one bucket per installation (`ABADA_FILES_BUCKET`, default `abada-files`), key `<projectId>/<fileId>` (never the file name) | Large binaries do not belong in the workflow database |
| Metadata and state | PostgreSQL table `process_files` (Flyway `V42`): project, uploader, name, sniffed content type, size, sha256, object key, state, instance, task, field | PostgreSQL stays the source of truth for what a process may see |
| What the process holds | A reference in the field's variable: `{ fileId, name, contentType, size, sha256 }` (a list of them for a `multiple` field) | Conditions, decision tables and workers route on metadata, never on bytes |

No bytes are ever written to PostgreSQL, process variables, history, outbox
events or webhooks. History rows and logs carry file ids, sizes and content
types, never a file's name or contents.

RustFS is **required** for self-hosted installations from 1.2: the certified
self-hosted topology is engine instances + PostgreSQL + RustFS. Only RustFS is
tested and supported; other S3-compatible stores may work but are not covered.
Managed cloud object stores (GCP Cloud Storage, AWS S3) are planned behind the
same `ObjectStore` interface and are not part of 1.2.

## Lifecycle

```
upload ──► PENDING ──(task completed with its id)──► ATTACHED ──(retention)──► DELETING ──► gone
              │                                                                 ▲
              ├──(uploader removes it before submitting)────────────────────────┤
              └──(not submitted within 24 h)─────────────────────────────────────┘
```

1. **Upload** — `POST /api/v1/projects/{projectId}/tasks/{taskId}/files?field=<fieldId>&name=<name>`,
   the body being the file itself with a `Content-Length`. The caller must be
   allowed to complete the task (assignee, or a candidate of an unclaimed
   task), and `field` must be a `file` field of the task's **pinned** form.
   The engine reads the first 8 KB to decide the content type from the bytes
   (not from the client), refuses executables and names that contradict the
   bytes, checks the field's `accept` list and size limits, then streams the
   body to RustFS while computing its size and sha256, and finally inserts the
   `PENDING` row and a `FILE_UPLOADED` history entry. The object is written
   before the row; if the insert fails the object is deleted (best effort; the
   orphan sweep catches the rest).
2. **Attach** — completing (or deciding) the task with the file id in the
   field. Inside the completion transaction the engine locks the file rows and
   checks each id is a `PENDING` file of this task and field, uploaded by the
   completing user, within the field's rules and the task's total. It marks
   them `ATTACHED`, writes the references into the variable and a
   `FILE_ATTACHED` history entry per file. **Only metadata changes; RustFS is
   not called inside the transaction**, so a completion succeeds while RustFS
   is down. A refused completion leaves the files `PENDING`.
3. **Read** — `GET /api/v1/projects/{projectId}/files/{fileId}` streams the
   bytes through the engine, so permissions and audit apply to every read
   (`FILE_DOWNLOADED`). No presigned URLs are issued in 1.2.
4. **Delete** — durable and idempotent (below).

## Rules and caps

| Rule | Default | Where |
| --- | --- | --- |
| Largest file | 10 MB (`ABADA_FILES_MAX_FILE_BYTES`); a field may set a lower `maxSize` | upload and attach |
| All files of one task by one user | 50 MB (`ABADA_FILES_MAX_TASK_BYTES`) | upload and attach |
| Accepted types | the field's `accept`: extensions (`.pdf`) and content types (`application/pdf`, `image/*`); empty accepts any | upload (sniffed type) and attach |
| Executables (PE, ELF, Mach-O, `#!` scripts, `.exe`, `.sh`, …) | always refused | upload |
| Name | base name only, NFC, no control or format characters, at most 255 characters | upload |
| `multiple` | a list of ids; `min`/`max` count the files | completion (`FORM_INVALID`) |

Refused uploads answer `FILE_REJECTED` with `details.reason`: `empty`, `size`,
`task_total`, `accept`, `type_mismatch`, `executable`, `name`, `length` or
`read` (HTTP 400, 413 or 415). Nothing is kept. A completion that names a file
it may not attach answers `FORM_INVALID` with the rules `file_unknown` (not a
pending file of this task, field and user — another user's id looks like an
unknown one), `file_not_pending`, `file_size`, `file_type` or `file_total`.

Virus scanning is not part of the engine. It is an operator responsibility,
for example a worker step that downloads the file through the engine and
routes on its verdict.

## Who may read a file

- Its uploader, while it is `PENDING` (to preview it before submitting).
- Once `ATTACHED`: project members who may read the instance (a project role
  plus the operations read permission, as for `GET /v1/projects/{p}/instances/**`),
  and the users of the instance's human tasks (assignee or candidate), so the
  next reviewer sees the documents a previous step added.
- A worker holding the lease of an external task of the same instance:
  `GET /api/v1/external-tasks/{id}/files/{fileId}?workerId=…` (worker permission).
- Anyone else gets 404, so a file's existence does not leak across users or
  projects.

Responses are `Content-Disposition: attachment` with the stored name,
`X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`,
`Content-Security-Policy: default-src 'none'; sandbox`, and the sha256 as
`ETag`. A row whose object is missing from RustFS (a restore of PostgreSQL
without the matching files) answers 410 `FILE_UNAVAILABLE`; RustFS not
answering gives 503 `OBJECT_STORE_UNAVAILABLE`.

Agents receive only what they declare (default-deny inputs): a file reference
reaches a model only if the agent node lists that variable, and in 1.2 the
first-party agent worker passes the reference, not the bytes.

## Deletion, retention and orphans

A scheduled sweep (every 5 minutes, `abada.files.sweep.*`) runs on every
replica; the state is in the rows, so a restart resumes and replicas share the
work:

- `PENDING` files older than 24 hours become `DELETING` (`expired`), as do
  files removed by their uploader (`DELETE /api/v1/projects/{p}/files/{id}`,
  `discarded`).
- `ATTACHED` files of instances that ended more than the project's
  `retentionDays` ago become `DELETING` (`retention`). The project file policy
  (`GET`/`PUT /api/v1/projects/{p}/file-policy`, owners only) has
  `retentionDays: null` by default: attached files are kept for as long as the
  instance's history.
- A replica claims `DELETING` rows with `SELECT … FOR UPDATE SKIP LOCKED` and
  a lease, deletes the objects **outside any transaction**, then removes only
  the rows it still holds and records `FILE_DELETED`. Deleting an absent
  object counts as success, so a retry after a crash or an expired lease is
  safe; a failing delete is retried with a growing backoff. Deletion is
  at-least-once, never in a workflow transaction.
- Once a day, under a singleton lease, objects older than one hour with no row
  (an upload whose row insert failed, a bucket restored ahead of its
  database) are deleted.

## Configuration

| Variable | Default (dev) | Meaning |
| --- | --- | --- |
| `ABADA_RUSTFS_IMAGE` | `rustfs/rustfs:1.0.3` | Pinned RustFS image |
| `ABADA_FILES_ENDPOINT` | `http://rustfs:9000` | S3 endpoint the engine uses |
| `ABADA_FILES_BUCKET` | `abada-files` | Bucket; created by the engine at startup when missing |
| `ABADA_FILES_ACCESS_KEY`, `ABADA_FILES_SECRET_KEY` | development values | RustFS credentials; required (`:?`) in prod and server, generated by the server launcher |
| `ABADA_FILES_SSE_MASTER_KEY` | development value | RustFS server-side encryption key (base64, 32 bytes). **Files cannot be read without it.** |
| `ABADA_FILES_REQUIRE_TLS` | `true` under the prod profile; `false` in the release Compose stacks | Refuses a plain-HTTP endpoint. The bundled RustFS sits on the internal `data` network and opts out; an external endpoint must be `https` |
| `ABADA_FILES_MAX_FILE_BYTES`, `ABADA_FILES_MAX_TASK_BYTES` | 10 MB, 50 MB | Caps |

Every object is written with server-side encryption (SSE-S3). RustFS 1.0.x
refuses SSE-S3 unless `RUSTFS_SSE_S3_MASTER_KEY` (or a KMS) is configured; the
Compose stacks set it from `ABADA_FILES_SSE_MASTER_KEY`.

## Readiness

The object store is a readiness dependency (`/api/actuator/health/readiness`
includes `objectStore`). At startup the engine creates the bucket when missing
and, until one write has succeeded, writes and removes a one-byte probe object
with the upload options. An unreachable store, a missing bucket, wrong
credentials or a store that refuses encrypted writes make readiness fail with
the reason; the engine stays alive and becomes ready by itself once the store
answers. The health details never contain a credential.

## Backup and restore

Back up PostgreSQL **and** the RustFS volume (`abada_rustfs_data`), and keep
`ABADA_FILES_SSE_MASTER_KEY` with them. Take the database dump first, then the
volume: every row in the dump then has its object, and objects newer than the
dump are orphans the sweep removes. Restoring one without the other means:

- PostgreSQL newer than the files: rows whose object is missing show as
  "file unavailable" (410) and can be deleted by their retention;
- files newer than PostgreSQL: objects without a row, removed by the orphan
  sweep after one hour.

`scripts/test/verify-backup-restore.sh` runs the drill on the dev stack,
including a check that every file row has its object in the RustFS archive.
