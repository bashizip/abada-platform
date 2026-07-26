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

Existing databases created by Hibernate are baselined at Flyway version 1 and
then upgraded by version 2. New databases execute both migrations. Never edit a
migration that has shipped; add a new versioned migration instead.

Process definitions are immutable after deployment. Redeploying changed BPMN
under the same process key creates a new version. New instances use the latest
version, while existing instances retain their original deployment ID.

Image rollback does not reverse a Flyway migration. Restore only from a tested
backup or follow release-specific rollback instructions.
