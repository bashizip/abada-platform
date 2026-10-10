-- E9: journaled agent steps. Portable SQL (H2 and PostgreSQL).

-- The attempt an external task is on: a counted failure or an operator retry
-- starts the next one; a lost lease or a deferral resumes the same attempt.
ALTER TABLE external_tasks ADD COLUMN attempt INTEGER DEFAULT 1 NOT NULL;

-- One row per model call or tool call of an agent attempt, appended by the
-- worker holding the lease before and after the call runs. Steps are never
-- deleted with their task; only their state moves forward. Payloads are
-- AES-GCM encrypted (ABADA_ENCRYPTION_KEY); digests stay readable.
CREATE TABLE agent_steps (
    id                  VARCHAR(36)  PRIMARY KEY,
    external_task_id    VARCHAR(255) NOT NULL,
    process_instance_id VARCHAR(255) NOT NULL,
    token_id            VARCHAR(36),
    activity_id         VARCHAR(255) NOT NULL,
    attempt             INTEGER      NOT NULL,
    sequence_no         INTEGER      NOT NULL,
    kind                VARCHAR(32)  NOT NULL,
    tool_ref            VARCHAR(255),
    policy              VARCHAR(32),
    state               VARCHAR(32)  NOT NULL,
    idempotency_key     VARCHAR(64),
    request_digest      VARCHAR(64)  NOT NULL,
    result_digest       VARCHAR(64),
    request_enc         TEXT,
    result_enc          TEXT,
    error_type          VARCHAR(255),
    model               VARCHAR(255),
    prompt_version      VARCHAR(128),
    prompt_tokens       INTEGER,
    completion_tokens   INTEGER,
    worker_id           VARCHAR(255) NOT NULL,
    resolved_by         VARCHAR(255),
    started_at          TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at         TIMESTAMP WITH TIME ZONE,
    entity_version      BIGINT       DEFAULT 0 NOT NULL,
    CONSTRAINT uk_agent_step_sequence UNIQUE (external_task_id, attempt, sequence_no)
);
CREATE INDEX idx_agent_steps_instance ON agent_steps (process_instance_id, started_at);
