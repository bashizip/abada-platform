-- S8: the task forms a definition version's human nodes are pinned to,
-- resolved at deployment (JSON by node id: form key, resource revision, sha256
-- and the schema itself). NULL when the definition pins no form, and for
-- versions deployed before 1.2, whose tasks keep the unpinned behaviour.
-- Portable SQL (H2 and PostgreSQL); additive, no backfill.
ALTER TABLE process_definitions ADD COLUMN form_snapshots TEXT;
