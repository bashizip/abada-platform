-- Project is the durable authorization and authoring boundary. Existing
-- global data is preserved in the deterministic Default project.
CREATE TABLE projects (
    id             VARCHAR(36) PRIMARY KEY,
    slug           VARCHAR(128) NOT NULL UNIQUE,
    name           VARCHAR(255) NOT NULL,
    description    TEXT         NOT NULL DEFAULT '',
    status         VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE'
                   CONSTRAINT ck_project_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_by     VARCHAR(255) NOT NULL,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    entity_version BIGINT       NOT NULL DEFAULT 0
);

INSERT INTO projects (id, slug, name, description, status, created_by, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'default', 'Default',
        'Compatibility project for definitions created before project envelopes.',
        'ACTIVE', 'system-migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE principals (
    id             VARCHAR(36)  PRIMARY KEY,
    issuer         VARCHAR(512) NOT NULL,
    subject_id     VARCHAR(255) NOT NULL,
    username       VARCHAR(255) NOT NULL,
    principal_type VARCHAR(16)  NOT NULL DEFAULT 'HUMAN'
                   CONSTRAINT ck_principal_type CHECK (principal_type IN ('HUMAN', 'SERVICE')),
    first_seen_at  TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_principal_issuer_subject UNIQUE (issuer, subject_id)
);
CREATE INDEX idx_principals_username ON principals (username);

CREATE TABLE project_members (
    id             VARCHAR(36) PRIMARY KEY,
    project_id     VARCHAR(36) NOT NULL REFERENCES projects(id),
    principal_id   VARCHAR(36) NOT NULL REFERENCES principals(id),
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by     VARCHAR(255) NOT NULL,
    entity_version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_project_member UNIQUE (project_id, principal_id)
);
CREATE INDEX idx_project_members_principal ON project_members (principal_id, project_id);

CREATE TABLE project_member_roles (
    member_id VARCHAR(36) NOT NULL REFERENCES project_members(id) ON DELETE CASCADE,
    role_name VARCHAR(32) NOT NULL
              CONSTRAINT ck_project_member_role
              CHECK (role_name IN ('OWNER', 'MAINTAINER', 'OPERATOR', 'REVIEWER', 'VIEWER')),
    PRIMARY KEY (member_id, role_name)
);

CREATE TABLE project_member_review_lanes (
    member_id VARCHAR(36) NOT NULL REFERENCES project_members(id) ON DELETE CASCADE,
    lane_name VARCHAR(128) NOT NULL,
    PRIMARY KEY (member_id, lane_name)
);

CREATE TABLE project_worker_bindings (
    id             VARCHAR(36) PRIMARY KEY,
    project_id     VARCHAR(36) NOT NULL REFERENCES projects(id),
    principal_id   VARCHAR(36) NOT NULL REFERENCES principals(id),
    topics         VARCHAR(2048) NOT NULL,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by     VARCHAR(255) NOT NULL,
    entity_version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_project_worker_binding UNIQUE (project_id, principal_id)
);

CREATE TABLE project_process_documents (
    id                     VARCHAR(36) PRIMARY KEY,
    project_id             VARCHAR(36) NOT NULL REFERENCES projects(id),
    process_key            VARCHAR(128) NOT NULL,
    name                   VARCHAR(255) NOT NULL,
    description            TEXT NOT NULL DEFAULT '',
    apl_source             TEXT NOT NULL,
    status                 VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
                           CONSTRAINT ck_project_document_status CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    last_deployment_id     VARCHAR(255),
    last_deployed_checksum VARCHAR(64),
    created_at             TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at             TIMESTAMP WITH TIME ZONE NOT NULL,
    last_saved_by          VARCHAR(255) NOT NULL,
    entity_version         BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_project_document_key UNIQUE (project_id, process_key)
);
CREATE INDEX idx_project_documents_project_updated
    ON project_process_documents (project_id, status, updated_at DESC);

ALTER TABLE process_definitions ADD COLUMN project_id VARCHAR(36);
UPDATE process_definitions SET project_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE process_definitions ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE process_definitions ADD CONSTRAINT fk_process_definition_project
    FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE process_definitions DROP CONSTRAINT uk_process_definition_key_version;
ALTER TABLE process_definitions ADD CONSTRAINT uk_project_process_definition_key_version
    UNIQUE (project_id, process_key, version);
CREATE INDEX idx_process_definitions_project_key
    ON process_definitions (project_id, process_key, version DESC);

ALTER TABLE process_instances ADD COLUMN project_id VARCHAR(36);
UPDATE process_instances SET project_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE process_instances ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE process_instances ADD CONSTRAINT fk_process_instance_project
    FOREIGN KEY (project_id) REFERENCES projects(id);
CREATE INDEX idx_process_instances_project_started
    ON process_instances (project_id, start_date DESC);

ALTER TABLE insight_execution_facts ADD COLUMN project_id VARCHAR(36);
UPDATE insight_execution_facts SET project_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE insight_execution_facts ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE insight_execution_facts ADD CONSTRAINT fk_insight_fact_project
    FOREIGN KEY (project_id) REFERENCES projects(id);

ALTER TABLE insight_findings ADD COLUMN project_id VARCHAR(36);
UPDATE insight_findings SET project_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE insight_findings ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE insight_findings ADD CONSTRAINT fk_insight_finding_project
    FOREIGN KEY (project_id) REFERENCES projects(id);

ALTER TABLE insight_proposals ADD COLUMN project_id VARCHAR(36);
UPDATE insight_proposals SET project_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE insight_proposals ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE insight_proposals ADD CONSTRAINT fk_insight_proposal_project
    FOREIGN KEY (project_id) REFERENCES projects(id);
CREATE INDEX idx_insight_proposals_project_status
    ON insight_proposals (project_id, status, created_at DESC);

-- Rebuild the policy table so definition keys are local to a project without
-- relying on database-generated primary-key constraint names.
CREATE TABLE insight_approval_policies_v12 (
    project_id           VARCHAR(36) NOT NULL REFERENCES projects(id),
    definition_key       VARCHAR(255) NOT NULL,
    policy_version       BIGINT       NOT NULL DEFAULT 0,
    required_approvals   INT          NOT NULL DEFAULT 1 CHECK (required_approvals BETWEEN 1 AND 20),
    required_groups      VARCHAR(1024) NOT NULL DEFAULT 'oidc:abada-insight-reviewer',
    approval_mode        VARCHAR(16)  NOT NULL DEFAULT 'PARALLEL'
                         CONSTRAINT ck_project_insight_policy_mode
                         CHECK (approval_mode IN ('PARALLEL', 'SEQUENTIAL')),
    updated_at           TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_by           VARCHAR(255) NOT NULL,
    PRIMARY KEY (project_id, definition_key)
);
INSERT INTO insight_approval_policies_v12
    (project_id, definition_key, policy_version, required_approvals, required_groups,
     approval_mode, updated_at, updated_by)
SELECT '00000000-0000-0000-0000-000000000001', definition_key, policy_version,
       required_approvals, required_groups, approval_mode, updated_at, updated_by
FROM insight_approval_policies;
DROP TABLE insight_approval_policies;
ALTER TABLE insight_approval_policies_v12 RENAME TO insight_approval_policies;
