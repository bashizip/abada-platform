-- Locked system root folders. Every project owns exactly six system folders
-- that may never be renamed, moved or deleted, and no user folder may exist
-- at the project root. IDs are deterministic per project/name (derived from
-- the project id) so the migration is idempotent and works on both PostgreSQL
-- and H2 without database-specific functions.

ALTER TABLE project_folders ADD COLUMN system_folder BOOLEAN NOT NULL DEFAULT false;

-- Guarantee at the database level that the root holds only system folders.
ALTER TABLE project_folders ADD CONSTRAINT ck_project_folder_root_locked
    CHECK (parent_id IS NOT NULL OR system_folder = true);

INSERT INTO project_folders (id, project_id, parent_id, name, system_folder,
        created_at, updated_at, entity_version)
SELECT 'root-' || substr(p.id, 1, 16) || '-' || f.name, p.id, NULL, f.name,
        true, NOW(), NOW(), 0
FROM projects p
CROSS JOIN (VALUES ('processes'), ('resources'), ('forms'), ('media'), ('agents'), ('tests'))
    AS f (name)
WHERE NOT EXISTS (
    SELECT 1 FROM project_folders existing
    WHERE existing.project_id = p.id
      AND existing.parent_id IS NULL
      AND existing.name = f.name
);

-- Folders created before this migration that already carry a system name at
-- the root are retroactively locked; any other legacy root folder is frozen
-- (no new root folders can be created) but stays manageable until deleted.
UPDATE project_folders SET system_folder = true
WHERE parent_id IS NULL
  AND name IN ('processes', 'resources', 'forms', 'media', 'agents', 'tests');