-- Live model lists per provider and a public price catalog. Portable SQL (H2 and PostgreSQL).

-- Prices read from the public catalog (OpenRouter's model list) or from the
-- snapshot shipped with the release. Never edited: a changed price is a new row
-- from the time it was read. model is the catalog id (google/gemini-x),
-- model_key the normalised bare name used to match an agent's model id. An
-- administrator's price in model_prices always wins over these.
CREATE TABLE model_catalog_prices (
    id                 VARCHAR(36)   PRIMARY KEY,
    model              VARCHAR(255)  NOT NULL,
    model_key          VARCHAR(255)  NOT NULL,
    input_per_million  NUMERIC(18,6) NOT NULL,
    output_per_million NUMERIC(18,6) NOT NULL,
    effective_from     TIMESTAMP WITH TIME ZONE NOT NULL,
    source             VARCHAR(64)   NOT NULL,
    created_at         TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_model_catalog_price UNIQUE (model, effective_from)
);
CREATE INDEX idx_model_catalog_prices_key ON model_catalog_prices (model_key, effective_from);

-- The models each provider says its key can use, from its own /models endpoint.
CREATE TABLE ai_provider_models (
    provider_id     VARCHAR(64)   PRIMARY KEY,
    models          TEXT          NOT NULL,
    refreshed_at    TIMESTAMP WITH TIME ZONE,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    last_error      VARCHAR(1000)
);

-- One row per background refresh (the price catalog, each provider's models):
-- a replica claims it with a short lease, refreshes outside any transaction and
-- records the outcome, so replicas never refresh the same thing at once.
CREATE TABLE ai_refresh_state (
    id            VARCHAR(80)   PRIMARY KEY,
    refreshed_at  TIMESTAMP WITH TIME ZONE,
    claimed_until TIMESTAMP WITH TIME ZONE,
    status        VARCHAR(16),
    message       VARCHAR(1000),
    item_count    INTEGER
);
