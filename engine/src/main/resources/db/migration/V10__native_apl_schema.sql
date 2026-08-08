-- V10: native APL definition schema (Phase 1 — native APL persistence).
--
-- Definitions are immutable and versioned by (process_key, version). The
-- source column (bpmn_xml) now carries either canonical BPMN 2.0 XML or a
-- native abada.io/v1 APL YAML document; schema_type disambiguates which
-- compiler the runtime must use to build the executable graph.
ALTER TABLE process_definitions ADD COLUMN schema_type VARCHAR(32) DEFAULT 'BPMN_XML';
ALTER TABLE process_definitions ALTER COLUMN schema_type SET NOT NULL;
ALTER TABLE process_definitions
    ADD CONSTRAINT ck_process_definitions_schema_type
    CHECK (schema_type IN ('BPMN_XML', 'APL_NATIVE'));