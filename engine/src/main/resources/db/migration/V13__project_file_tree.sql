-- Project file tree: folders give projects an IDE-like structure. Process
-- documents can be placed into folders and carry an optional display file
-- name that is independent of the immutable process key. Resources are
-- generic typed files (JSON forms today, arbitrary assets later).
--
-- Existing process documents have no folder (root of the tree) and no file
-- name; clients fall back to the process name for display.

CREATE TABLE project_folders (
    id             VARCHAR(36) PRIMARY KEY,
    project_id     VARCHAR(36) NOT NULL REFERENCES projects(id),
    parent_id      VARCHAR(36) REFERENCES project_folders(id),
    name           VARCHAR(255) NOT NULL,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    entity_version BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT ck_project_folder_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
-- Unique index on (project_id, parent_id, name). PostgreSQL treats NULL
-- parent_id rows as distinct inside a unique index, so root-level name
-- uniqueness is enforced by the service (a single write transaction);
-- sibling uniqueness is database-authoritative.
CREATE UNIQUE INDEX uq_project_folder_name
    ON project_folders (project_id, parent_id, name);
CREATE INDEX idx_project_folders_project ON project_folders (project_id);

CREATE TABLE project_resources (
    id             VARCHAR(36) PRIMARY KEY,
    project_id     VARCHAR(36) NOT NULL REFERENCES projects(id),
    folder_id      VARCHAR(36) REFERENCES project_folders(id),
    name           VARCHAR(255) NOT NULL,
    content_type   VARCHAR(127) NOT NULL,
    size_bytes     BIGINT       NOT NULL,
    sha256         VARCHAR(64)  NOT NULL,
    content        BYTEA        NOT NULL,
    kind           VARCHAR(16)  NOT NULL DEFAULT 'RESOURCE'
                   CONSTRAINT ck_project_resource_kind CHECK (kind IN ('FORM', 'RESOURCE')),
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    entity_version BIGINT       NOT NULL DEFAULT 0
);
-- See the note on project_folders: NULL root folders are unique per project
-- via the service; sibling-level names are database-authoritative.
CREATE UNIQUE INDEX uq_project_resource_name
    ON project_resources (project_id, folder_id, name);
CREATE INDEX idx_project_resources_project ON project_resources (project_id);

ALTER TABLE project_process_documents ADD COLUMN folder_id VARCHAR(36);
-- Separate statements: H2 and PostgreSQL both accept inline REFERENCES only in
-- single-column ADD COLUMN statements.
ALTER TABLE project_process_documents ADD COLUMN file_name VARCHAR(255);
ALTER TABLE project_process_documents ADD CONSTRAINT fk_project_document_folder
    FOREIGN KEY (folder_id) REFERENCES project_folders(id);
CREATE INDEX idx_project_documents_project_folder
    ON project_process_documents (project_id, folder_id);