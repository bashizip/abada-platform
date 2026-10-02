-- E3: bounded loops. Portable SQL (H2 and PostgreSQL).

-- A loop that reaches its limit with no on_exhausted route parks its token in
-- the new INCIDENT state and opens an incident operators can see.
ALTER TABLE process_tokens DROP CONSTRAINT ck_process_tokens_state;
ALTER TABLE process_tokens ADD CONSTRAINT ck_process_tokens_state CHECK (state IN
    ('ACTIVE', 'WAITING', 'ARRIVED', 'FORKED', 'EVENT_WAIT', 'INCIDENT', 'COMPLETED', 'CONSUMED', 'CANCELLED'));

CREATE TABLE incidents (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    process_instance_id VARCHAR(255) NOT NULL,
    token_id VARCHAR(36),
    activity_id VARCHAR(255) NOT NULL,
    incident_type VARCHAR(64) NOT NULL,
    message VARCHAR(1024) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution VARCHAR(64),
    CONSTRAINT fk_incidents_instance FOREIGN KEY (process_instance_id)
        REFERENCES process_instances(id) ON DELETE CASCADE
);
CREATE INDEX idx_incidents_project_open ON incidents(project_id, resolved_at);
CREATE INDEX idx_incidents_instance ON incidents(process_instance_id);

-- A token that loops back to a catch event subscribes again. Consumed rows are
-- kept, so one (instance, activity) pair can now have several subscriptions;
-- duplicates of an open wait are prevented under the instance lock.
ALTER TABLE event_subscriptions DROP CONSTRAINT uk_event_subscription;
CREATE INDEX idx_event_subscription_instance_activity
    ON event_subscriptions(process_instance_id, activity_id, consumed_at);
