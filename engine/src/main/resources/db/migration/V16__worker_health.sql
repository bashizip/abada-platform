CREATE TABLE worker_health (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    status TEXT NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_success_at TIMESTAMP WITH TIME ZONE,
    last_error_at TIMESTAMP WITH TIME ZONE,
    last_error_message TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_worker_id TEXT,
    CONSTRAINT uq_worker_health_project_principal_topic UNIQUE (project_id, principal_id, topic)
);

CREATE INDEX idx_worker_health_project_status ON worker_health (project_id, status);