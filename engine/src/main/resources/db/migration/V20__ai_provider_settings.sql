CREATE TABLE ai_provider_settings (
    id              VARCHAR(64) PRIMARY KEY,
    provider_type   VARCHAR(64) NOT NULL DEFAULT 'openai-compatible',
    base_url        VARCHAR(512),
    api_key_enc     TEXT,
    api_key_hint    VARCHAR(16),
    model           VARCHAR(128),
    timeout_ms      BIGINT NOT NULL DEFAULT 30000,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

INSERT INTO ai_provider_settings (id, provider_type, enabled)
VALUES ('default', 'openai-compatible', false);
