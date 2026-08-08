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
    @ValueSource(ints = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11})
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
        assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("12");

        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
             var columns = connection.getMetaData().getColumns(null, schema, "process_instances",
                     "process_definition_deployment_id")) {
            assertThat(columns.next()).isTrue();
        }
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
             var columns = connection.getMetaData().getColumns(null, schema, "process_definitions",
                     "schema_type")) {
            assertThat(columns.next()).isTrue();
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
