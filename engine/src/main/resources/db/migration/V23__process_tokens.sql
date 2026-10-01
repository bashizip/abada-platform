-- E2: tokens become first-class rows. A token is one thread of execution in a
-- process instance; joins count token ids instead of predecessor activities.
-- Portable SQL (H2 and PostgreSQL). Existing instances are converted from the
-- legacy JSON columns on their first command after the upgrade; the engine
-- keeps writing those columns through the 1.1.0-rc line so an image rollback
-- to 1.0.0-rc.8 still finds consistent state.
CREATE TABLE process_tokens (
    id VARCHAR(36) PRIMARY KEY,
    process_instance_id VARCHAR(255) NOT NULL,
    activity_id VARCHAR(255) NOT NULL,
    state VARCHAR(32) NOT NULL,
    parent_token_id VARCHAR(36),
    scope_token_id VARCHAR(36),
    loop_counter INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT fk_process_tokens_instance FOREIGN KEY (process_instance_id)
        REFERENCES process_instances(id) ON DELETE CASCADE,
    CONSTRAINT ck_process_tokens_state CHECK (state IN
        ('ACTIVE', 'WAITING', 'ARRIVED', 'FORKED', 'EVENT_WAIT', 'COMPLETED', 'CONSUMED', 'CANCELLED'))
);
CREATE INDEX idx_process_tokens_instance_state ON process_tokens(process_instance_id, state);

-- Waiting work records the token it resumes. Null for rows created before V23;
-- those still resume by (process instance, activity).
ALTER TABLE tasks ADD COLUMN token_id VARCHAR(36);
ALTER TABLE external_tasks ADD COLUMN token_id VARCHAR(36);
ALTER TABLE jobs ADD COLUMN token_id VARCHAR(36);
ALTER TABLE event_subscriptions ADD COLUMN token_id VARCHAR(36);
CREATE INDEX idx_tasks_token ON tasks(token_id);
CREATE INDEX idx_external_tasks_token ON external_tasks(token_id);
CREATE INDEX idx_jobs_token ON jobs(token_id);
CREATE INDEX idx_event_subscriptions_token ON event_subscriptions(token_id);
