package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Predicate;
import java.util.stream.Stream;
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
 * E12: the project event stream under the PostgreSQL authority, over real
 * HTTP. Events stream in order with ids only; Last-Event-ID resumes without
 * loss or duplicates; members only; projects never mix; any replica serves
 * any client; a gap left by an uncommitted transaction is held, then skipped.
 */
@Testcontainers
class ProjectEventStreamTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private static final String PROCESS = """
            version: abada.io/v1
            metadata: { key: KEY, name: KEY }
            flow:
              entry: start
              nodes:
                - { id: start, type: webhook, next: review }
                - { id: review, type: human-input, assignees: [reviewers], next: done }
                - { id: done, type: end }
            """;

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_stream").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext replicaA;
    private static ConfigurableApplicationContext replicaB;
    private static String alicesProject;
    private static String bobsProject;

    @BeforeAll
    static void start() throws Exception {
        replicaA = startApplication();
        replicaB = startApplication();
        alicesProject = createProject(replicaA, "alice", "streamed");
        bobsProject = createProject(replicaA, "bob", "elsewhere");
        engine(replicaA).deploy(alicesProject, source("streamed_case"));
        engine(replicaA).deploy(bobsProject, source("other_case"));
    }

    @AfterAll
    static void stop() {
        if (replicaB != null) replicaB.close();
        if (replicaA != null) replicaA.close();
    }

    @Test
    void eventsStreamInOrderWithIdsOnlyAndAnotherProjectNeverAppears() throws Exception {
        try (Stream stream = Stream.open(replicaA, alicesProject, "alice", null)) {
            String bobs = engine(replicaA).startProcess(bobsProject, "other_case", "bob", Map.of("secret", "s3"))
                    .getId();
            String alices = engine(replicaA).startProcess(alicesProject, "streamed_case", "alice",
                    Map.of("iban", "DE89-3704")).getId();
            List<Event> events = stream.await(event -> alices.equals(event.instanceId())
                    && "TASK_CREATED".equals(event.type()));
            assertThat(events).extracting(Event::type).contains("PROCESS_STARTED", "TASK_CREATED");
            assertThat(events).noneMatch(event -> bobs.equals(event.instanceId()));
            assertThat(events).extracting(Event::seq).isSorted();
            assertThat(stream.raw()).doesNotContain("DE89-3704").doesNotContain("\"details\"")
                    .doesNotContain("\"actor\"");
            assertThat(events.getLast().data().path("activityId").asText()).isEqualTo("review");
        }
    }

    @Test
    void lastEventIdResumesWithoutLossOrDuplicates() throws Exception {
        List<Event> first;
        String instance;
        try (Stream stream = Stream.open(replicaA, alicesProject, "alice", null)) {
            instance = engine(replicaA).startProcess(alicesProject, "streamed_case", "alice", Map.of()).getId();
            first = stream.await(event -> instance.equals(event.instanceId()) && "TASK_CREATED".equals(event.type()));
        }
        Event resumeFrom = first.stream().filter(event -> instance.equals(event.instanceId())).findFirst().orElseThrow();
        try (Stream resumed = Stream.open(replicaA, alicesProject, "alice", resumeFrom.seq())) {
            List<Event> replayed = resumed.await(event -> instance.equals(event.instanceId())
                    && "TASK_CREATED".equals(event.type()));
            assertThat(replayed).extracting(Event::seq).allMatch(seq -> seq > resumeFrom.seq()).doesNotHaveDuplicates();
            List<Long> expected = first.stream().map(Event::seq).filter(seq -> seq > resumeFrom.seq()).toList();
            assertThat(replayed).extracting(Event::seq).containsAll(expected);
        }
    }

    @Test
    void onlyMembersMayListen() throws Exception {
        HttpResponse<String> stranger = HTTP.send(request(replicaA, alicesProject, "mallory", null).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(stranger.statusCode()).isEqualTo(404);
    }

    @Test
    void anyReplicaStreamsWhatAnotherCommitted() throws Exception {
        try (Stream onB = Stream.open(replicaB, alicesProject, "alice", null)) {
            String instance = engine(replicaA).startProcess(alicesProject, "streamed_case", "alice", Map.of()).getId();
            assertThat(onB.await(event -> instance.equals(event.instanceId()) && "TASK_CREATED".equals(event.type())))
                    .extracting(Event::type).contains("PROCESS_STARTED");
        }
    }

    @Test
    void aGapFromAnUncommittedTransactionIsHeldThenSkipped() throws Exception {
        try (Stream stream = Stream.open(replicaA, alicesProject, "alice", null);
                Connection open = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                        POSTGRES.getPassword())) {
            open.setAutoCommit(false);
            // Takes the next seq and holds it uncommitted, as a slow transaction would.
            open.createStatement().execute("insert into outbox_events (id, aggregate_type, aggregate_id, event_type,"
                    + " payload_json, occurred_at, attempts, entity_version, project_id) values ('held',"
                    + " 'PROCESS_INSTANCE', 'x', 'HELD', '{}', now(), 0, 0, '" + alicesProject + "')");
            String instance = engine(replicaA).startProcess(alicesProject, "streamed_case", "alice", Map.of()).getId();
            Thread.sleep(800);
            assertThat(stream.events()).noneMatch(event -> instance.equals(event.instanceId()));
            open.rollback();
            // Past the hold the gap is skipped and the committed events stream.
            assertThat(stream.await(event -> instance.equals(event.instanceId())
                    && "TASK_CREATED".equals(event.type()))).isNotEmpty();
        }
    }

    // ---------------------------------------------------------------- helpers

    record Event(long seq, String type, JsonNode data) {
        String instanceId() {
            return data.path("processInstanceId").asText(null);
        }
    }

    /** A streaming client reading frames on a background thread. */
    static final class Stream implements AutoCloseable {
        private final List<Event> events = new CopyOnWriteArrayList<>();
        private final StringBuffer raw = new StringBuffer();
        private final java.util.concurrent.CompletableFuture<HttpResponse<java.util.stream.Stream<String>>> response;

        private Stream(HttpRequest request) {
            response = HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofLines());
            response.thenAccept(lines -> {
                String[] frame = new String[3];
                lines.body().forEach(line -> {
                    raw.append(line).append('\n');
                    if (line.startsWith("id:")) frame[0] = line.substring(3).strip();
                    else if (line.startsWith("event:")) frame[1] = line.substring(6).strip();
                    else if (line.startsWith("data:")) frame[2] = line.substring(5).strip();
                    else if (line.isEmpty() && frame[0] != null && frame[2] != null) {
                        try {
                            events.add(new Event(Long.parseLong(frame[0]), frame[1], JSON.readTree(frame[2])));
                        } catch (Exception exception) {
                            throw new IllegalStateException(exception);
                        }
                        frame[0] = frame[1] = frame[2] = null;
                    }
                });
            });
        }

        static Stream open(ConfigurableApplicationContext replica, String project, String user, Long lastEventId)
                throws Exception {
            Stream stream = new Stream(request(replica, project, user, lastEventId).build());
            Thread.sleep(300);                                    // let the subscription register
            return stream;
        }

        List<Event> await(Predicate<Event> last) throws InterruptedException {
            long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
            while (System.nanoTime() < deadline) {
                if (events.stream().anyMatch(last)) return new ArrayList<>(events);
                Thread.sleep(100);
            }
            throw new AssertionError("event never streamed; got " + events);
        }

        List<Event> events() {
            return new ArrayList<>(events);
        }

        String raw() {
            return raw.toString();
        }

        @Override
        public void close() {
            response.cancel(true);
        }
    }

    static HttpRequest.Builder request(ConfigurableApplicationContext replica, String project, String user,
            Long lastEventId) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port(replica)
                        + "/api/v1/projects/" + project + "/events/stream"))
                .header("Accept", "text/event-stream, application/json").header("X-User", user)
                .header("X-Groups", "customers");
        if (lastEventId != null) builder.header("Last-Event-ID", Long.toString(lastEventId));
        return builder.GET();
    }

    static String createProject(ConfigurableApplicationContext replica, String owner, String slug) throws Exception {
        HttpResponse<String> created = HTTP.send(HttpRequest.newBuilder(URI.create("http://localhost:"
                        + port(replica) + "/api/v1/projects"))
                .header("Content-Type", "application/json").header("X-User", owner).header("X-Groups", "customers")
                .POST(HttpRequest.BodyPublishers.ofString("{\"slug\":\"" + slug + "\",\"name\":\"" + slug
                        + "\",\"description\":\"\"}")).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(created.statusCode()).as(created.body()).isBetween(200, 201);
        return JSON.readTree(created.body()).path("id").asText();
    }

    static int port(ConfigurableApplicationContext replica) {
        return Integer.parseInt(replica.getEnvironment().getProperty("local.server.port"));
    }

    static AbadaEngine engine(ConfigurableApplicationContext replica) {
        return replica.getBean(AbadaEngine.class);
    }

    static ByteArrayInputStream source(String key) {
        return new ByteArrayInputStream(PROCESS.replace("KEY", key).getBytes(StandardCharsets.UTF_8));
    }

    static ConfigurableApplicationContext startApplication() {
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(initialized -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(initialized,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=6",
                        "spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect",
                        "spring.jpa.hibernate.ddl-auto=validate",
                        "spring.jpa.open-in-view=false",
                        "spring.flyway.enabled=true",
                        "spring.task.scheduling.enabled=false",
                        "abada.outbox.dispatcher.enabled=false",
                        "abada.security.mode=disabled",
                        "abada.events.stream.poll-interval-ms=100",
                        "abada.events.stream.gap-hold-ms=2000",
                        "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                        "abada.insight.llm.api-key=test-key",
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
    }
}
