-- The resolved inputs of each decision-table application, kept as evidence next to the matched rule. Portable SQL
-- (H2 and PostgreSQL). Governed by the project's evidence policy like agent payloads and start inputs: encrypted,
-- masked when the policy is "redacted", absent when it is "none", and cleared after retention. activity_history
-- keeps only the row's id (DECISION_TABLE_APPLIED.evidenceId), never a value.
CREATE TABLE decision_input_evidence (
    id               VARCHAR(64)  PRIMARY KEY,
    instance_id      VARCHAR(255) NOT NULL,
    project_id       VARCHAR(255),
    activity_id      VARCHAR(255) NOT NULL,
    decision_key     VARCHAR(255),
    payload_mode     VARCHAR(16)  NOT NULL,
    inputs_enc       TEXT,
    redacted         BOOLEAN DEFAULT FALSE NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL,
    purge_after      TIMESTAMP WITH TIME ZONE NOT NULL,
    purged_at        TIMESTAMP WITH TIME ZONE
);
CREATE INDEX idx_decision_inputs_instance ON decision_input_evidence (instance_id, created_at);
CREATE INDEX idx_decision_inputs_purge ON decision_input_evidence (purge_after);
