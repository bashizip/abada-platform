-- Outcome of the engine-side agent output contract for the last reported
-- attempt of an abada:agent external task: OK, INVALID_OUTPUT, LOW_CONFIDENCE
-- or ERROR. Nullable; ordinary external tasks keep NULL.
ALTER TABLE external_tasks ADD COLUMN agent_outcome VARCHAR(32);
