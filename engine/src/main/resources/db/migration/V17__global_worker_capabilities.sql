-- Global, project-agnostic worker capabilities. A worker registers the topics
-- (and optionally the models) it can serve globally; fetch-and-lock without a
-- projectId is authorized against these rows instead of per-project bindings.
CREATE TABLE worker_capabilities (
    id TEXT PRIMARY KEY,
    principal_id TEXT NOT NULL REFERENCES principals(id),
    topic TEXT NOT NULL,
    -- Comma-separated supported model identifiers; empty means "all models".
    models TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by TEXT NOT NULL,
    entity_version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_worker_capability_principal_topic UNIQUE (principal_id, topic)
);

CREATE INDEX idx_worker_capabilities_topic ON worker_capabilities (topic);

-- Required model for agent tasks, captured from the agent work descriptor at
-- task creation so acquisition can match tasks to worker model capabilities.
ALTER TABLE external_tasks ADD COLUMN required_model TEXT;

-- Worker health rows for global (project-agnostic) fetches.
ALTER TABLE worker_health ALTER COLUMN project_id DROP NOT NULL;