-- E20b: agent-proposed delegation. Portable SQL (H2 and PostgreSQL).

-- The child instance a DELEGATION step started: the child's end finds the
-- step (and the parked agent work) by it. Step kind DELEGATION and the
-- external-task status AWAITING_CHILD are plain values of existing columns.
ALTER TABLE agent_steps ADD COLUMN child_instance_id VARCHAR(255);
CREATE INDEX idx_agent_steps_child ON agent_steps (child_instance_id);
