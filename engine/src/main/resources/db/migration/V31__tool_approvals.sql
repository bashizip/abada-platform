-- E10: approval-required tools. Portable SQL (H2 and PostgreSQL).

-- A human task is either a process node's task (USER) or the approval of one
-- proposed tool call (TOOL_APPROVAL). An approval is linked to its agent step,
-- carries the agent's token so cancel and timeout boundaries retire it, and
-- never moves the token itself.
ALTER TABLE tasks ADD COLUMN kind VARCHAR(32) DEFAULT 'USER' NOT NULL;
ALTER TABLE tasks ADD COLUMN agent_step_id VARCHAR(36);
CREATE INDEX idx_tasks_agent_step ON tasks (agent_step_id);

-- When a person approved or rejected a PROPOSED step; resolved_by (V28) holds who.
ALTER TABLE agent_steps ADD COLUMN decided_at TIMESTAMP WITH TIME ZONE;
