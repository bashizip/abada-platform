# Upgrading Abada Engine

1. Download the new release archive and verify its published SHA-256 file.
2. Back up PostgreSQL and verify that the backup can be restored:

   ```bash
   docker compose --env-file .env.prod -f compose.yaml -f compose.prod.yaml \
     exec -T postgres pg_dump -U abada -d abada_engine -Fc > abada-engine.dump
   shasum -a 256 abada-engine.dump > abada-engine.dump.sha256
   ```

3. Stop all engine replicas for upgrades that cross a schema version until
   rolling-upgrade compatibility is explicitly listed in the release notes.
4. Copy the prior `.env.prod`, change `ABADA_VERSION` to the exact new release,
   then run `./release/abada-platform doctor prod --env-file .env.prod`.
5. Start one new engine replica. Flyway applies pending migrations before
   Hibernate validates the schema.
6. Check `/api/actuator/health`, migration logs, and failed jobs.
7. Start remaining replicas and exercise a representative process.

Flyway owns the schema: a new database runs every migration in
`engine/src/main/resources/db/migration`, and an existing one runs only those it
has not applied yet. Databases first created by Hibernate before Flyway were
baselined at version 1. Never edit a migration that has shipped; add a new
versioned migration instead. Each release's notes list its migrations.

### Upgrading to 1.1.0-rc.1 (V23 execution tokens)

V23 adds the `process_tokens` table and a nullable `token_id` column to tasks,
external tasks, jobs and event subscriptions. It does not rewrite existing
rows, so it runs in seconds. Instances that are in flight during the upgrade
are converted from their stored JSON token state the first time a command
touches them (task completion, message, timer, worker completion, cancel);
work created before the upgrade resumes by activity. Stop all replicas before
the upgrade as for any schema change.

### Upgrading to 1.1.0-rc.1 (V24 incidents, V25 loop counts)

V24 adds the `incidents` table and the `INCIDENT` token state, and drops the
one-subscription-per-activity constraint so a message or signal wait inside a
loop can be armed again. V25 adds the nullable `loop_counts` column to
`process_tokens`. Neither rewrites existing rows. After the upgrade, new
deployments must bound every cycle (`loop.max_iterations` in APL,
`abada:maxIterations` in BPMN); definitions already deployed keep running.
Check `GET /api/v1/projects/{projectId}/incidents?open=true` after the upgrade:
an in-flight message wait without a `correlationKey` variable now opens a
`MISSING_CORRELATION_KEY` incident instead of waiting silently.

### Upgrading to 1.1.0-rc.1 (V26 boundaries)

V26 adds job kinds (`job_kind`, `boundary_id`), `tasks.due_at` and
`escalated_at`, and `external_tasks.model_override` and `deferrals`. It
rewrites no rows. Upgrade the engine and the agent worker together: workers
built on an earlier SDK cannot read agent tasks whose nodes declare
`fallback_models`. After the upgrade:

- `sla_hours` is enforced. Check deployed documents that used it as a
  monitoring hint; a task entered after the upgrade is escalated when it
  passes.
- A last failed attempt with no `on_error` opens a `WORK_FAILED` incident.
  Jobs that failed before the upgrade stay in the failed-jobs list and are
  retried as before.

### Upgrading to 1.1.0-rc.2 (V27–V33, agents that act)

V27 to V33 add tables and nullable or defaulted columns only; no existing row
is rewritten:

| Migration | Adds |
| --- | --- |
| V27 | `TOOL_SERVER` project resources, `tool_credentials`, `process_definitions.tool_bindings` |
| V28 | `agent_steps` (the step journal), `external_tasks.attempt` |
| V29 | Call-process lineage on `process_instances`, `process_definitions.call_targets`, `jobs.related_instance_id` |
| V30 | `model_prices`; cost, evidence and retention columns on `agent_steps` |
| V31 | `tasks.kind` and `tasks.agent_step_id` (tool approvals), `agent_steps.decided_at` |
| V32 | `agent_steps.child_instance_id` (delegation) |
| V33 | `outbox_events.seq` and `project_id` (the project event stream) |

Upgrade the engine, Studio and the agent worker together. Before the upgrade:

- Make sure `ABADA_ENCRYPTION_KEY` (base64, 32 bytes) is set; the server
  profile generates it on first `up server`. Tool credentials and journaled
  step payloads are encrypted with it; without it a public development key is
  used, which is not a secret. Keep the key with the database backup: payloads
  cannot be read without it.
- Agent nodes that bind tools need `ABADA_AGENT_ALLOWED_TOOLS` on the worker,
  the project's tool server resources, and model prices in **Settings → Model
  Prices** when they declare `budget_usd`.
- A tool name without a server (`web_search`) still deploys with an
  `ABADA-APL-TOOL-001` warning and is passed as an advisory name; it becomes an
  error at 1.1.0.

Events written before V33 have no sequence number and are not replayed by the
project event stream; webhook delivery is unchanged.

### Updating with the one-line installer (1.1.2 and later)

Run the installer again from the directory that holds the installation (or
with the same `ABADA_INSTALL_DIR`). From 1.1.2 it updates in place: it saves
the current `.env.dev` as `.env.dev.backup-<date>`, sets the image tags of the
release it installs, adds settings the release introduced, keeps every other
setting, and says which version it updates from. Installers up to 1.1.1 kept
an existing `.env.dev` untouched and so started the image tags it pinned:
after an update with them, set the four `ABADA_*_IMAGE` lines to the new
version and run `./release/abada-platform up dev`.

### Upgrading to 1.1.1 (V39, live AI providers)

V39 adds three tables and changes no existing row: `model_catalog_prices`
(prices read from the public catalog or the release snapshot, insert-only),
`ai_provider_models` (each provider's model list) and `ai_refresh_state`
(leases so one replica refreshes at a time). On first start the engine imports
the release price snapshot, then reads the catalog and each provider's model
list within the hour. Air-gapped installations set
`ABADA_PRICE_CATALOG_ENABLED=false` (the snapshot still applies) and, if the
providers are unreachable for listing, `ABADA_MODEL_DISCOVERY_ENABLED=false`.
Rolling back to 1.1.0 is an image change only; 1.1.0 ignores the V39 tables.

### Upgrading to 1.1.0 (V34–V38, governed improvement)

V34 to V38 add tables and nullable or defaulted columns only; no existing row
is rewritten:

| Migration | Adds |
| --- | --- |
| V34 | `insight_agent_facts`; four new Insight signal types |
| V35 | `process_definitions.rollback_of`, `deployed_by`, `deploy_comment` |
| V36 | `process_start_inputs` (start variables kept for replay) |
| V37 | `replay_runs`, `replay_cases`; `replay_required`, `replay_min_cases` on approval policies |
| V38 | `for_each_items` |

Upgrade the engine, Studio and the agent worker together. Before the upgrade:

- A tool name without a server (`web_search`) is no longer accepted by new
  deployments or validation (`ABADA-APL-TOOL-001`). Definitions already
  deployed are unaffected. Replace the name with `<server>/<tool>` before
  redeploying such a definition.
- Replay needs the start variables of past cases. They are recorded from the
  moment this release runs, under the project's evidence policy; earlier
  instances cannot be replayed. A project on evidence policy `none` keeps none.
- `ABADA_ENCRYPTION_KEY` protects the start variables and evidence payloads, as
  before: keep it with the database backup.

Finished replays are removed after the evidence retention period.

Process definitions are immutable after deployment. Redeploying changed BPMN
under the same process key creates a new version. New instances use the latest
version, while existing instances retain their original deployment ID.

Image rollback does not reverse a Flyway migration. Restore only from a tested
backup or follow release-specific rollback instructions.

Rolling back from 1.1.0-rc.1 to 1.0.0-rc.8 without a restore is supported for
V23: the engine keeps writing the legacy token columns that rc.8 reads, and
rc.8 ignores the new table and columns. Instances advanced by 1.1.0-rc.1 keep
running on rc.8 with rc.8's join semantics; upgrading again rebuilds the token
rows of any instance rc.8 advanced. rc.8 also ignores the V24 and V25
objects, but it does not know bounded loops or incidents: cancel instances
with open incidents before rolling back. After V26, also cancel pending
timeout and SLA jobs and mark retired external tasks finished, as the
1.1.0-rc.1 release notes show, so rc.8 never fires them as timers. Rolling back further, or past a
release whose notes do not state this, requires the pre-upgrade backup.

Rolling back from 1.1.0-rc.2 to 1.1.0-rc.1 requires the pre-upgrade backup.
The V27–V33 objects are additive, but rc.1 does not know tool server
resources, tool approval tasks, call-process steps or delegated children, and
an in-place rollback with those in use is not tested.
