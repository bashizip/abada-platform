-- E4: boundaries, SLA escalation and agent model fallback. Portable SQL (H2 and PostgreSQL).

-- A job is now one of three kinds: EVENT (a timer catch event, as before),
-- BOUNDARY_TIMEOUT (an on_timeout boundary of a task) or SLA (escalation of
-- an open human task). Existing rows are timer events.
ALTER TABLE jobs ADD COLUMN job_kind VARCHAR(32) DEFAULT 'EVENT' NOT NULL;
ALTER TABLE jobs ADD COLUMN boundary_id VARCHAR(255);
-- At most one pending job per token and kind is enforced under the instance
-- lock; this index serves that check and the cancellation when a token leaves.
CREATE INDEX idx_jobs_instance_token_kind ON jobs(process_instance_id, token_id, job_kind, status);

-- Human task service level: when it falls due and when it was escalated.
ALTER TABLE tasks ADD COLUMN due_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE tasks ADD COLUMN escalated_at TIMESTAMP WITH TIME ZONE;

-- An operator may retry failed agent work on another allowed model; the
-- override applies to this external task only. Deferrals count rate-limit
-- waits that did not consume an attempt.
ALTER TABLE external_tasks ADD COLUMN model_override VARCHAR(255);
ALTER TABLE external_tasks ADD COLUMN deferrals INTEGER DEFAULT 0 NOT NULL;
