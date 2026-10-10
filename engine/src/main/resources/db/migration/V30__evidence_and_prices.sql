-- E11: evidence policy, retention and agent cost. Portable SQL (H2 and PostgreSQL).

-- Effective-dated model prices in USD per million tokens. A price is never
-- edited in place: a change is a new row from its effective time. provider is
-- NULL for a price that applies whatever provider serves the model.
CREATE TABLE model_prices (
    id                 VARCHAR(36)   PRIMARY KEY,
    model              VARCHAR(255)  NOT NULL,
    provider           VARCHAR(64),
    input_per_million  NUMERIC(18,6) NOT NULL,
    output_per_million NUMERIC(18,6) NOT NULL,
    effective_from     TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by         VARCHAR(255)  NOT NULL,
    created_at         TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_model_price UNIQUE (model, provider, effective_from)
);
CREATE INDEX idx_model_prices_model ON model_prices (model, effective_from);

-- request_enc/result_enc (V28) stay the worker's working copy: full payloads a
-- resumed lease needs, cleared once the task is completed or cancelled. The
-- evidence kept for auditors is a separate copy shaped by the evidence policy
-- (payload_mode) and purged after retention. Cost of a step is computed by the
-- engine from its tokens and the price in effect (NULL with cost_unpriced when
-- no price applies, never 0).
ALTER TABLE agent_steps ADD COLUMN cost_usd NUMERIC(18,8);
ALTER TABLE agent_steps ADD COLUMN cost_unpriced BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE agent_steps ADD COLUMN payload_mode VARCHAR(16) DEFAULT 'none' NOT NULL;
ALTER TABLE agent_steps ADD COLUMN evidence_request_enc TEXT;
ALTER TABLE agent_steps ADD COLUMN evidence_result_enc TEXT;
ALTER TABLE agent_steps ADD COLUMN purge_after TIMESTAMP WITH TIME ZONE;
ALTER TABLE agent_steps ADD COLUMN purged_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX idx_agent_steps_purge ON agent_steps (purge_after, purged_at);

-- Cost and tokens an agent task's attempts reported in their metadata, summed
-- over attempts (workers that do not journal their model calls). An attempt
-- that journaled its model calls is counted from its steps instead.
ALTER TABLE external_tasks ADD COLUMN attempt_cost_usd NUMERIC(18,8);
ALTER TABLE external_tasks ADD COLUMN attempt_prompt_tokens BIGINT DEFAULT 0 NOT NULL;
ALTER TABLE external_tasks ADD COLUMN attempt_completion_tokens BIGINT DEFAULT 0 NOT NULL;
ALTER TABLE external_tasks ADD COLUMN attempt_cost_unpriced BOOLEAN DEFAULT FALSE NOT NULL;

-- A project's evidence policy: none | redacted | full, and days payloads are kept.
ALTER TABLE projects ADD COLUMN evidence_payloads VARCHAR(16) DEFAULT 'redacted' NOT NULL;
ALTER TABLE projects ADD COLUMN evidence_retention_days INTEGER DEFAULT 30 NOT NULL;
