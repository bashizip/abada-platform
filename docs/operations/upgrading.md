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

Process definitions are immutable after deployment. Redeploying changed BPMN
under the same process key creates a new version. New instances use the latest
version, while existing instances retain their original deployment ID.

Image rollback does not reverse a Flyway migration. Restore only from a tested
backup or follow release-specific rollback instructions.

Rolling back from 1.1.0-rc.1 to 1.0.0-rc.8 without a restore is supported for
V23: the engine keeps writing the legacy token columns that rc.8 reads, and
rc.8 ignores the new table and columns. Instances advanced by 1.1.0-rc.1 keep
running on rc.8 with rc.8's join semantics; upgrading again rebuilds the token
rows of any instance rc.8 advanced. Rolling back further, or past a
release whose notes do not state this, requires the pre-upgrade backup.
