-- Loop passes are counted per token and loop step (JSON map step id -> pass),
-- so parallel branches looping on the same step each get their own bound.
-- Null for tokens written before V25; those fall back to the instance-wide
-- <step>_iteration variable.
ALTER TABLE process_tokens ADD COLUMN loop_counts TEXT;
