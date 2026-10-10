-- E7: tool registry. Portable SQL (H2 and PostgreSQL).

-- A project resource may now describe an MCP tool server (YAML validated
-- against tool-server-v1.schema.json by the engine on every save).
ALTER TABLE project_resources DROP CONSTRAINT ck_project_resource_kind;
ALTER TABLE project_resources ADD CONSTRAINT ck_project_resource_kind
    CHECK (kind IN ('FORM', 'RESOURCE', 'TOOL_SERVER'));

-- The tool bindings resolved at deployment, frozen with the definition
-- version: editing a tool server later never changes a running instance.
-- JSON, keyed by agent node id. NULL for BPMN and for APL without tools.
ALTER TABLE process_definitions ADD COLUMN tool_bindings TEXT;

-- Secrets a tool server document names in `credential`. Encrypted with
-- ABADA_ENCRYPTION_KEY like AI provider keys; write-only through the API and
-- served only to the worker holding the lease of a task bound to the server.
CREATE TABLE tool_credentials (
    project_id   VARCHAR(36)  NOT NULL REFERENCES projects(id),
    name         VARCHAR(128) NOT NULL,
    secret_enc   TEXT         NOT NULL,
    secret_hint  VARCHAR(16),
    version      BIGINT       NOT NULL DEFAULT 0,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_tool_credentials PRIMARY KEY (project_id, name)
);
