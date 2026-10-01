-- Named AI providers configured in Studio (Settings -> AI Providers). Each row
-- is one provider endpoint with its own encrypted key; agent models route to a
-- provider by the longest matching prefix in model_patterns ('*' matches any
-- model). At most one row is the insight_default (enforced by the service).
-- A saved, enabled provider with a key takes precedence over the environment
-- (ABADA_LLM_*) provider of the same id.
CREATE TABLE ai_providers (
    id              VARCHAR(64) PRIMARY KEY,
    display_name    VARCHAR(128) NOT NULL,
    provider_type   VARCHAR(32) NOT NULL,
    base_url        VARCHAR(512),
    api_key_enc     TEXT,
    api_key_hint    VARCHAR(16),
    model_patterns  VARCHAR(1024),
    default_model   VARCHAR(128),
    timeout_ms      BIGINT NOT NULL DEFAULT 30000,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    insight_default BOOLEAN NOT NULL DEFAULT FALSE,
    version         BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Carry over the single workspace key saved through the 1.0.0-rc.7 Studio
-- settings. The ciphertext is reused as-is (same ABADA_ENCRYPTION_KEY). Gemini
-- rows drop the stored base URL so the corrected preset (/v1beta/openai)
-- applies. ai_provider_settings is kept, unused, for rollback to rc.7.
INSERT INTO ai_providers (id, display_name, provider_type, base_url, api_key_enc, api_key_hint,
                          model_patterns, default_model, timeout_ms, enabled, insight_default)
SELECT CASE WHEN provider_type = 'gemini' THEN 'gemini' ELSE 'openai-compatible' END,
       CASE WHEN provider_type = 'gemini' THEN 'Google Gemini' ELSE 'OpenAI-compatible' END,
       CASE WHEN provider_type = 'gemini' THEN 'gemini' ELSE 'openai-compatible' END,
       CASE WHEN provider_type = 'gemini' THEN NULL ELSE base_url END,
       api_key_enc,
       api_key_hint,
       CASE WHEN provider_type = 'gemini' THEN 'gemini,google/' ELSE '*' END,
       model,
       timeout_ms,
       TRUE,
       TRUE
FROM ai_provider_settings
WHERE id = 'default'
  AND enabled = TRUE
  AND api_key_enc IS NOT NULL
  AND api_key_enc <> '';
