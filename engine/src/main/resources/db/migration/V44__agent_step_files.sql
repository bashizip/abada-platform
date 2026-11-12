-- S15: the files a model call was given, as the engine verified them: per file the
-- declared name, id, name, content type, size and sha256, as a JSON array. Metadata
-- only, never the bytes, kept whatever the evidence payload policy and not purged
-- with the payloads, so an auditor can prove which document the agent read.
-- Portable SQL (H2 and PostgreSQL); additive.
ALTER TABLE agent_steps ADD COLUMN files_json TEXT;
