-- E20a: call-process. Portable SQL (H2 and PostgreSQL).

-- The child definition versions a parent's call-process nodes are pinned to,
-- resolved at deployment (JSON by node id). NULL when the definition calls none.
ALTER TABLE process_definitions ADD COLUMN call_targets TEXT;

-- Lineage: a child instance names the instance, token and call activity that
-- started it, the root of its tree and its depth (0 for a root). A parent's
-- descendants are cancelled with it; a child never locks its parent.
ALTER TABLE process_instances ADD COLUMN parent_instance_id VARCHAR(255);
ALTER TABLE process_instances ADD COLUMN parent_token_id VARCHAR(36);
ALTER TABLE process_instances ADD COLUMN parent_activity_id VARCHAR(255);
ALTER TABLE process_instances ADD COLUMN root_instance_id VARCHAR(255);
ALTER TABLE process_instances ADD COLUMN call_depth INTEGER DEFAULT 0 NOT NULL;
-- Reserved for E20b: the agent identity (node, definition version, prompt
-- version, model) that proposed the delegation, as JSON.
ALTER TABLE process_instances ADD COLUMN started_by_agent TEXT;
CREATE INDEX idx_process_instances_parent ON process_instances (parent_instance_id, parent_token_id);
CREATE INDEX idx_process_instances_root ON process_instances (root_instance_id);

-- A CHILD_DONE job resumes the parent token once its child ended; it names
-- that child here and is unique per child.
ALTER TABLE jobs ADD COLUMN related_instance_id VARCHAR(255);
CREATE INDEX idx_jobs_related_instance ON jobs (related_instance_id, job_kind);
