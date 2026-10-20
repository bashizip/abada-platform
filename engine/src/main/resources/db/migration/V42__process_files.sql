-- S9: files uploaded to human-task forms. The bytes live in the object store
-- (RustFS, S3 API) under object_key = '<project>/<id>', never the file name;
-- PostgreSQL keeps only the metadata and the state of each file, so it decides
-- what a process may see. Portable SQL (H2 and PostgreSQL); additive.
--
-- state: PENDING (uploaded, not yet part of a completed task), ATTACHED (written
-- to the process by a task completion, in that transaction), DELETING (the
-- sweep removes the object, then the row). lease_* make the deletion
-- cluster-safe: a replica claims a row, deletes the object outside any
-- transaction, then removes the row it still holds.
CREATE TABLE process_files (
    id               VARCHAR(36)   PRIMARY KEY,
    project_id       VARCHAR(255)  NOT NULL,
    uploaded_by      VARCHAR(255)  NOT NULL,
    content_type     VARCHAR(255)  NOT NULL,
    size_bytes       BIGINT        NOT NULL,
    sha256           VARCHAR(64)   NOT NULL,
    name             VARCHAR(255)  NOT NULL,
    object_key       VARCHAR(512)  NOT NULL,
    state            VARCHAR(16)   NOT NULL,
    instance_id      VARCHAR(255)  NOT NULL,
    task_id          VARCHAR(255)  NOT NULL,
    field_id         VARCHAR(255)  NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL,
    attached_at      TIMESTAMP WITH TIME ZONE,
    deleting_reason  VARCHAR(32),
    lease_owner      VARCHAR(255),
    lease_expires_at TIMESTAMP WITH TIME ZONE,
    attempts         INTEGER       DEFAULT 0 NOT NULL,
    last_error       VARCHAR(1000),
    entity_version   BIGINT        DEFAULT 0 NOT NULL,
    CONSTRAINT uk_process_files_object_key UNIQUE (object_key),
    CONSTRAINT ck_process_files_state CHECK (state IN ('PENDING', 'ATTACHED', 'DELETING'))
);
-- The sweep's acquisition paths and the completion check.
CREATE INDEX idx_process_files_state_created ON process_files (state, created_at);
CREATE INDEX idx_process_files_task_uploader ON process_files (task_id, uploaded_by, state);
CREATE INDEX idx_process_files_instance ON process_files (instance_id, state);

-- How long a finished instance keeps its attached files; NULL keeps them.
ALTER TABLE projects ADD COLUMN file_retention_days INTEGER;

-- Singleton leases for sweeps that one replica runs at a time (the orphan scan
-- lists the bucket). last_completed_at spaces the runs.
CREATE TABLE file_sweep_leases (
    name              VARCHAR(64)  PRIMARY KEY,
    lease_owner       VARCHAR(255),
    lease_expires_at  TIMESTAMP WITH TIME ZONE,
    last_completed_at TIMESTAMP WITH TIME ZONE
);
INSERT INTO file_sweep_leases (name) VALUES ('orphans');
