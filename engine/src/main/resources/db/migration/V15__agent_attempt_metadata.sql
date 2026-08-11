-- Persist optional abada.agent attempt metadata on the durable external-task
-- record: model, provider, attempt number, duration, tools, result variable,
-- prompt hash and error type. JSON text; no prompts, tokens or credentials.
ALTER TABLE external_tasks ADD COLUMN agent_metadata TEXT;
