package com.abada.engine.persistence;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.DriverManager;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class PostgresSchemaUpgradeTest {
    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_schema_upgrades")
            .withUsername("abada")
            .withPassword("abada");

    @ParameterizedTest(name = "upgrades schema v{0} to latest")
    @ValueSource(ints = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29})
    void upgradesEveryPreviouslyPublishedSchemaVersion(int sourceVersion) throws Exception {
        String schema = "upgrade_from_v" + sourceVersion;
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .schemas(schema)
                .createSchemas(true)
                .target(MigrationVersion.fromVersion(Integer.toString(sourceVersion)))
                .load()
                .migrate();

        Flyway latest = Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .schemas(schema)
                .load();
        assertThat(latest.migrate().success).isTrue();
        assertThat(latest.validateWithResult().validationSuccessful).isTrue();
        assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("30");

        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema, "process_instances",
                     "process_definition_deployment_id")) {
            assertThat(columns.next()).isTrue();
        }
        assertTokenSchema(schema);
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema, "process_instances",
                     "project_id")) {
            assertThat(columns.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var statement = connection.prepareStatement(
                     "select count(*) from " + schema + ".projects where slug = 'default'")) {
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isEqualTo(1);
            }
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema, "process_definitions",
                     "compatibility_profiles")) {
            assertThat(columns.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var indexes = connection.getMetaData().getIndexInfo(null, schema, "jobs", false, false)) {
            assertThat(indexNames(indexes)).contains(
                    "idx_jobs_available_acquisition", "idx_jobs_expired_lease_acquisition");
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var indexes = connection.getMetaData().getIndexInfo(null, schema, "external_tasks", false, false)) {
            assertThat(indexNames(indexes)).contains("idx_external_tasks_acquisition", "idx_external_tasks_worker_lock");
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema, "external_tasks", "trace_parent")) {
            assertThat(columns.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema, "external_tasks",
                     "agent_metadata")) {
            assertThat(columns.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema, "process_definitions",
                     "schema_type")) {
            assertThat(columns.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema,
                     "project_process_documents", "folder_id")) {
            assertThat(columns.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema,
                     "project_process_documents", "file_name")) {
            assertThat(columns.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var tables = connection.getMetaData().getTables(null, schema, "project_folders", null)) {
            assertThat(tables.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var tables = connection.getMetaData().getTables(null, schema, "project_resources", null)) {
            assertThat(tables.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var tables = connection.getMetaData().getTables(null, schema, "project_member_task_groups", null)) {
            assertThat(tables.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var tables = connection.getMetaData().getTables(null, schema, "ai_provider_settings", null)) {
            assertThat(tables.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema, "ai_providers", "model_patterns")) {
            assertThat(columns.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema,
                     "project_folders", "system_folder")) {
            assertThat(columns.next()).isTrue();
        }
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var statement = connection.prepareStatement(
                     "select count(*) from " + schema + ".project_folders pf "
                             + "join " + schema + ".projects p on p.id = pf.project_id "
                             + "where p.slug = 'default' and pf.parent_id is null "
                             + "and pf.system_folder = true")) {
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isEqualTo(6);
            }
        }
    }

    /** The single rc.7 Studio key becomes the Insight-default provider; the ciphertext is carried over. */
    @org.junit.jupiter.api.Test
    void carriesTheRc7StudioKeyIntoTheProviderTable() throws Exception {
        String schema = "carry_ai_key";
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .schemas(schema).createSchemas(true).target(MigrationVersion.fromVersion("21")).load().migrate();
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var statement = connection.prepareStatement("update " + schema + ".ai_provider_settings set "
                     + "provider_type = 'gemini', base_url = 'https://generativelanguage.googleapis.com/v1beta', "
                     + "api_key_enc = 'ciphertext', api_key_hint = '****abcd', model = 'gemini-3.7-flash', "
                     + "enabled = true where id = 'default'")) {
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }

        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .schemas(schema).load().migrate();

        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var statement = connection.prepareStatement("select id, provider_type, base_url, api_key_enc, "
                     + "model_patterns, default_model, insight_default, enabled from " + schema + ".ai_providers");
             var result = statement.executeQuery()) {
            assertThat(result.next()).isTrue();
            assertThat(result.getString("id")).isEqualTo("gemini");
            assertThat(result.getString("provider_type")).isEqualTo("gemini");
            assertThat(result.getString("base_url")).as("the corrected preset applies").isNull();
            assertThat(result.getString("api_key_enc")).isEqualTo("ciphertext");
            assertThat(result.getString("model_patterns")).isEqualTo("gemini,google/");
            assertThat(result.getString("default_model")).isEqualTo("gemini-3.7-flash");
            assertThat(result.getBoolean("insight_default")).isTrue();
            assertThat(result.getBoolean("enabled")).isTrue();
            assertThat(result.next()).isFalse();
        }
    }

    /** A fresh install (or an rc.7 install that never saved a key) starts with no Studio provider. */
    @org.junit.jupiter.api.Test
    void aFreshDatabaseHasNoStudioProvider() throws Exception {
        String schema = "fresh_ai_providers";
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .schemas(schema).createSchemas(true).load().migrate();
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var statement = connection.prepareStatement("select count(*) from " + schema + ".ai_providers");
             var result = statement.executeQuery()) {
            assertThat(result.next()).isTrue();
            assertThat(result.getInt(1)).isZero();
        }
    }

    /** A fresh install has the V23 token table and every waiting-work table can name its token. */
    @org.junit.jupiter.api.Test
    void aFreshDatabaseHasTheTokenSchema() throws Exception {
        String schema = "fresh_tokens";
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .schemas(schema).createSchemas(true).load().migrate();
        assertTokenSchema(schema);
    }

    private void assertTokenSchema(String schema) throws Exception {
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())) {
            var metadata = connection.getMetaData();
            for (String column : java.util.List.of("id", "process_instance_id", "activity_id", "state",
                    "parent_token_id", "scope_token_id", "loop_counter", "loop_counts", "created_at", "updated_at")) {
                try (var columns = metadata.getColumns(null, schema, "process_tokens", column)) {
                    assertThat(columns.next()).as("process_tokens." + column).isTrue();
                }
            }
            try (var indexes = metadata.getIndexInfo(null, schema, "process_tokens", false, false)) {
                assertThat(indexNames(indexes)).contains("idx_process_tokens_instance_state");
            }
            for (String table : java.util.List.of("tasks", "external_tasks", "jobs", "event_subscriptions")) {
                try (var columns = metadata.getColumns(null, schema, table, "token_id")) {
                    assertThat(columns.next()).as(table + ".token_id").isTrue();
                }
            }
            // V24: incidents, and a loop may subscribe at the same catch event again.
            for (String column : java.util.List.of("id", "project_id", "process_instance_id", "token_id",
                    "activity_id", "incident_type", "message", "created_at", "resolved_at", "resolution")) {
                try (var columns = metadata.getColumns(null, schema, "incidents", column)) {
                    assertThat(columns.next()).as("incidents." + column).isTrue();
                }
            }
            try (var indexes = metadata.getIndexInfo(null, schema, "event_subscriptions", true, false)) {
                assertThat(indexNames(indexes)).doesNotContain("uk_event_subscription");
            }
            // V26: job kinds for boundary timeouts and SLA, task service level, model override and deferrals.
            for (String[] column : new String[][] {{"jobs", "job_kind"}, {"jobs", "boundary_id"},
                    {"tasks", "due_at"}, {"tasks", "escalated_at"}, {"external_tasks", "model_override"},
                    {"external_tasks", "deferrals"}}) {
                try (var columns = metadata.getColumns(null, schema, column[0], column[1])) {
                    assertThat(columns.next()).as(column[0] + "." + column[1]).isTrue();
                }
            }
            try (var indexes = metadata.getIndexInfo(null, schema, "jobs", false, false)) {
                assertThat(indexNames(indexes)).contains("idx_jobs_instance_token_kind");
            }
            // V30: evidence policy, payload copies, retention, cost and model prices.
            for (String[] column : new String[][] {{"agent_steps", "cost_usd"}, {"agent_steps", "cost_unpriced"},
                    {"agent_steps", "payload_mode"}, {"agent_steps", "evidence_request_enc"},
                    {"agent_steps", "evidence_result_enc"}, {"agent_steps", "purge_after"},
                    {"agent_steps", "purged_at"}, {"external_tasks", "attempt_cost_usd"},
                    {"external_tasks", "attempt_cost_unpriced"}, {"external_tasks", "attempt_prompt_tokens"},
                    {"external_tasks", "attempt_completion_tokens"}, {"projects", "evidence_payloads"},
                    {"projects", "evidence_retention_days"}, {"model_prices", "input_per_million"},
                    {"model_prices", "effective_from"}}) {
                try (var columns = metadata.getColumns(null, schema, column[0], column[1])) {
                    assertThat(columns.next()).as(column[0] + "." + column[1]).isTrue();
                }
            }
            // V29: call-process lineage, pinned call targets and the CHILD_DONE job's child.
            for (String[] column : new String[][] {{"process_definitions", "call_targets"},
                    {"process_instances", "parent_instance_id"}, {"process_instances", "parent_token_id"},
                    {"process_instances", "parent_activity_id"}, {"process_instances", "root_instance_id"},
                    {"process_instances", "call_depth"}, {"process_instances", "started_by_agent"},
                    {"jobs", "related_instance_id"}}) {
                try (var columns = metadata.getColumns(null, schema, column[0], column[1])) {
                    assertThat(columns.next()).as(column[0] + "." + column[1]).isTrue();
                }
            }
            try (var indexes = metadata.getIndexInfo(null, schema, "process_instances", false, false)) {
                assertThat(indexNames(indexes)).contains("idx_process_instances_parent", "idx_process_instances_root");
            }
            // V28: journaled agent steps and the attempt an external task is on.
            try (var columns = metadata.getColumns(null, schema, "external_tasks", "attempt")) {
                assertThat(columns.next()).as("external_tasks.attempt").isTrue();
            }
            for (String column : java.util.List.of("id", "external_task_id", "process_instance_id", "token_id",
                    "activity_id", "attempt", "sequence_no", "kind", "tool_ref", "policy", "state",
                    "idempotency_key", "request_digest", "result_digest", "request_enc", "result_enc",
                    "worker_id", "resolved_by", "started_at", "finished_at")) {
                try (var columns = metadata.getColumns(null, schema, "agent_steps", column)) {
                    assertThat(columns.next()).as("agent_steps." + column).isTrue();
                }
            }
            try (var indexes = metadata.getIndexInfo(null, schema, "agent_steps", false, false)) {
                assertThat(indexNames(indexes)).contains("idx_agent_steps_instance", "uk_agent_step_sequence");
            }
            // V27: tool registry (tool server resources, frozen bindings, credentials).
            try (var columns = metadata.getColumns(null, schema, "process_definitions", "tool_bindings")) {
                assertThat(columns.next()).as("process_definitions.tool_bindings").isTrue();
            }
            for (String column : java.util.List.of("project_id", "name", "secret_enc", "secret_hint", "version",
                    "created_at", "updated_at")) {
                try (var columns = metadata.getColumns(null, schema, "tool_credentials", column)) {
                    assertThat(columns.next()).as("tool_credentials." + column).isTrue();
                }
            }
        }
    }

    private java.util.Set<String> indexNames(java.sql.ResultSet indexes) throws Exception {
        java.util.Set<String> names = new java.util.HashSet<>();
        while (indexes.next()) {
            String name = indexes.getString("INDEX_NAME");
            if (name != null) names.add(name);
        }
        return names;
    }
}
