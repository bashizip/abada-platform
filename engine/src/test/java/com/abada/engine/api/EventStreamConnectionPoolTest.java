package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.zaxxer.hikari.HikariDataSource;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * An open event stream holds no database connection. A stream lasts up to
 * 30 minutes; if each held a pooled connection for its life, a handful of
 * Studio users watching instances would exhaust the pool and every other
 * request, worker and scheduler on the replica would time out.
 *
 * <p>Runs on the shipped JPA settings (no open-in-view override), against
 * PostgreSQL, with more streams than the pool has connections.
 */
@Testcontainers
class EventStreamConnectionPoolTest {
    private static final int POOL_SIZE = 3;
    private static final int STREAMS = POOL_SIZE * 3;
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_pool").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext replica;
    private static String project;

    @BeforeAll
    static void start() throws Exception {
        replica = startApplication();
        project = ProjectEventStreamTest.createProject(replica, "alice", "watched");
        ProjectEventStreamTest.engine(replica).deploy(project, ProjectEventStreamTest.source("watched_case"));
    }

    @AfterAll
    static void stop() {
        if (replica != null) replica.close();
    }

    @Test
    void theShippedConfigurationKeepsNoEntityManagerOpenForTheRequest() {
        // open-in-view binds an EntityManager, and with it a connection, to the whole request, a stream included.
        assertThat(replica.getEnvironment().getProperty("spring.jpa.open-in-view")).isEqualTo("false");
    }

    @Test
    void moreOpenStreamsThanPooledConnectionsLeaveThePoolFreeAndTheApiAnswering() throws Exception {
        List<ProjectEventStreamTest.Stream> streams = new ArrayList<>();
        try {
            for (int index = 0; index < STREAMS; index++) {
                streams.add(ProjectEventStreamTest.Stream.open(replica, project, "alice", null));
            }
            awaitConnected(streams);

            assertThat(pool().getHikariPoolMXBean().getActiveConnections())
                    .as("connections checked out while %d streams are open", STREAMS).isZero();

            // Ordinary requests keep being served, well within the pool's acquisition timeout.
            for (int call = 0; call < POOL_SIZE * 4; call++) {
                long started = System.nanoTime();
                HttpResponse<String> response = HTTP.send(HttpRequest.newBuilder(URI.create(
                                "http://localhost:" + ProjectEventStreamTest.port(replica) + "/api/v1/projects/"
                                        + project + "/instances"))
                        .header("X-User", "alice").header("X-Groups", "customers").GET().build(),
                        HttpResponse.BodyHandlers.ofString());
                assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
                assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(2));
            }

            // And every stream still delivers.
            String instance = ProjectEventStreamTest.engine(replica)
                    .startProcess(project, "watched_case", "alice", Map.of()).getId();
            for (ProjectEventStreamTest.Stream stream : streams) {
                stream.await(event -> instance.equals(event.instanceId()) && "TASK_CREATED".equals(event.type()));
            }
            assertThat(pool().getHikariPoolMXBean().getActiveConnections()).isZero();
        } finally {
            streams.forEach(ProjectEventStreamTest.Stream::close);
        }
    }

    private static void awaitConnected(List<ProjectEventStreamTest.Stream> streams) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        while (System.nanoTime() < deadline) {
            if (streams.stream().allMatch(stream -> stream.raw().contains(":connected"))) return;
            Thread.sleep(50);
        }
        throw new AssertionError("not every stream opened");
    }

    private static HikariDataSource pool() throws java.sql.SQLException {
        return replica.getBean(DataSource.class).unwrap(HikariDataSource.class);
    }

    private static ConfigurableApplicationContext startApplication() {
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(initialized -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(initialized,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=" + POOL_SIZE,
                        "spring.datasource.hikari.minimum-idle=1",
                        // Fail fast if the pool is exhausted, instead of the production 30 s.
                        "spring.datasource.hikari.connection-timeout=2000",
                        "spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect",
                        "spring.jpa.hibernate.ddl-auto=validate",
                        "spring.flyway.enabled=true",
                        "spring.task.scheduling.enabled=false",
                        "abada.outbox.dispatcher.enabled=false",
                        "abada.security.mode=disabled",
                        "abada.events.stream.poll-interval-ms=100",
                        "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                        "abada.insight.llm.api-key=test-key",
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
    }
}
