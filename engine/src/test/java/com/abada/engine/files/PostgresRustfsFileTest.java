package com.abada.engine.files;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.TaskManager;
import com.abada.engine.dto.ProjectTreeNodeDTO;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.persistence.repository.ProcessFileRepository;
import com.abada.engine.project.ProjectService;
import com.abada.engine.project.ProjectTreeService;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;

/**
 * PostgreSQL and RustFS are the reference for process files (S9): the bucket
 * is created at startup, an upload lands in RustFS (server-side encrypted)
 * with only metadata in PostgreSQL, the completion attaches it in one
 * transaction, a restart keeps everything, two replicas sweeping at once delete
 * each file once, and readiness fails while RustFS does not answer.
 */
@Testcontainers
class PostgresRustfsFileTest {
    static final String RUSTFS_IMAGE = "rustfs/rustfs:1.0.3";
    // Shaped like the launcher's generated secrets (48 hex characters).
    private static final String ACCESS = "3f9a1c0e5b7d2a8e4c6f0b1d3e5a7c9e2b4d6f8a0c1e3b5d";
    private static final String SECRET = "9e7c5a3b1d0f2e4c6a8b0d2f4e6c8a0b1d3f5e7c9a2b4d6f";
    private static final ObjectMapper JSON = new ObjectMapper();

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_files").withUsername("abada").withPassword("abada");

    @Container
    @SuppressWarnings("resource")
    private static final GenericContainer<?> RUSTFS = new GenericContainer<>(RUSTFS_IMAGE)
            .withEnv("RUSTFS_ACCESS_KEY", ACCESS)
            .withEnv("RUSTFS_SECRET_KEY", SECRET)
            .withEnv("RUSTFS_CONSOLE_ENABLE", "false")
            // SSE-S3 without an external KMS: RustFS needs its own master key.
            .withEnv("RUSTFS_SSE_S3_MASTER_KEY", java.util.Base64.getEncoder().encodeToString(new byte[32]))
            .withCommand("/data")
            .withExposedPorts(9000)
            .waitingFor(Wait.forHttp("/health").forPort(9000).forStatusCode(200)
                    .withStartupTimeout(Duration.ofMinutes(2)));

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @Test
    void aFileGoesToRustfsIsAttachedInTheCompletionAndSurvivesARestart() throws Exception {
        byte[] pdf = ProcessFileApiTest.pdf(3000);
        String projectId;
        String instanceId;
        String fileId;
        try (ConfigurableApplicationContext context = start("abada_files_flow")) {
            assertThat(readiness(context)).isEqualTo(200);
            projectId = project(context);
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            engine.deploy(projectId, new ByteArrayInputStream(resource("apl/supplier-onboarding.apl.yaml")));
            instanceId = engine.startProcess(projectId, "supplier_onboarding", "alice", Map.of()).getId();
            String taskId = context.getBean(TaskManager.class).getTasksForProcessInstance(instanceId).getFirst().getId();

            HttpResponse<String> uploaded = http.send(HttpRequest.newBuilder(uri(context,
                    "/v1/projects/" + projectId + "/tasks/" + taskId + "/files?field=iso_certificate&name="
                            + URLEncoder.encode("Certificado ISO.pdf", StandardCharsets.UTF_8)))
                    .header("X-User", "alice").header("X-Groups", "procurement,abada-admin")
                    .header("Content-Type", "application/octet-stream")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(pdf)).build(), HttpResponse.BodyHandlers.ofString());
            assertThat(uploaded.statusCode()).as(uploaded.body()).isEqualTo(201);
            fileId = JSON.readTree(uploaded.body()).path("fileId").asText();

            // The bytes are in RustFS under the project and file id, encrypted at rest; PostgreSQL has no bytes.
            HeadObjectResponse head = s3().headObject(request -> request.bucket("abada-files")
                    .key(projectId + "/" + fileId));
            assertThat(head.contentLength()).isEqualTo(pdf.length);
            assertThat(head.serverSideEncryptionAsString()).isEqualTo("AES256");
            JdbcTemplate jdbc = context.getBean(JdbcTemplate.class);
            assertThat(jdbc.queryForObject("select count(*) from information_schema.columns where table_name = "
                    + "'process_files' and data_type = 'bytea'", Integer.class)).isZero();

            Map<String, Object> values = new HashMap<>(JSON.convertValue(
                    JSON.readTree(resource("forms/submission-conformance.json")).path("valid"), Map.class));
            values.put("iso_certified", true);
            values.put("certificate_expiry", "2027-06-30");
            values.put("iso_certificate", fileId);
            HttpResponse<String> completed = http.send(HttpRequest.newBuilder(uri(context,
                    "/v1/projects/" + projectId + "/tasks/" + taskId + "/complete"))
                    .header("X-User", "alice").header("X-Groups", "procurement,abada-admin")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(values))).build(),
                    HttpResponse.BodyHandlers.ofString());
            assertThat(completed.statusCode()).as(completed.body()).isEqualTo(200);
            assertThat(context.getBean(ProcessFileRepository.class).findById(fileId).orElseThrow().getState())
                    .isEqualTo(ProcessFileEntity.State.ATTACHED);
        }

        try (ConfigurableApplicationContext restarted = start("abada_files_flow")) {
            Object reference = restarted.getBean(AbadaEngine.class).getProcessInstanceById(instanceId).getVariables()
                    .get("iso_certificate");
            assertThat(reference).asString().contains(fileId).contains("Certificado ISO.pdf");
            HttpResponse<byte[]> download = http.send(HttpRequest.newBuilder(uri(restarted,
                    "/v1/projects/" + projectId + "/files/" + fileId)).header("X-User", "alice")
                    .header("X-Groups", "procurement,abada-admin").GET().build(), HttpResponse.BodyHandlers.ofByteArray());
            assertThat(download.statusCode()).isEqualTo(200);
            assertThat(download.body()).isEqualTo(pdf);
            assertThat(restarted.getBean(ActivityHistoryRepository.class)
                    .findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                    .filteredOn(entry -> entry.getEventType().startsWith("FILE_"))
                    .extracting(entry -> entry.getEventType())
                    .containsExactly("FILE_UPLOADED", "FILE_ATTACHED", "FILE_DOWNLOADED");
        }
    }

    @Test
    void twoReplicasSweepingAtOnceDeleteEachFileOnce() throws Exception {
        try (ConfigurableApplicationContext context = start("abada_files_sweep")) {
            assertThat(readiness(context)).isEqualTo(200);
            ObjectStore store = context.getBean(ObjectStore.class);
            ProcessFileRepository files = context.getBean(ProcessFileRepository.class);
            Instant now = Instant.now();
            List<String> ids = new ArrayList<>();
            for (int i = 0; i < 2 * FileSweep.BATCH + 7; i++) {
                String id = UUID.randomUUID().toString();
                store.put("sweep/" + id, new ByteArrayInputStream(new byte[] {1, 2, 3}), 3, "application/octet-stream");
                ProcessFileEntity row = new ProcessFileEntity();
                row.setId(id);
                row.setProjectId("sweep");
                row.setUploadedBy("alice");
                row.setContentType("application/octet-stream");
                row.setSizeBytes(3);
                row.setSha256("0".repeat(64));
                row.setName("x.bin");
                row.setObjectKey("sweep/" + id);
                row.setState(ProcessFileEntity.State.PENDING);
                row.setInstanceId("none");
                row.setTaskId("task");
                row.setFieldId("field");
                row.setCreatedAt(now.minus(Duration.ofHours(30)));
                files.save(row);
                ids.add(id);
            }
            FileSweep sweep = context.getBean(FileSweep.class);
            CountDownLatch go = new CountDownLatch(1);
            ExecutorService pool = Executors.newFixedThreadPool(2);
            try {
                List<Future<FileSweep.Result>> runs = new ArrayList<>();
                for (String replica : List.of("replica-a", "replica-b")) {
                    Callable<FileSweep.Result> run = () -> {
                        go.await();
                        return sweep.sweep(now, replica);
                    };
                    runs.add(pool.submit(run));
                }
                go.countDown();
                int deleted = 0;
                int marked = 0;
                for (Future<FileSweep.Result> run : runs) {
                    deleted += run.get().deleted();
                    marked += run.get().marked();
                }
                assertThat(marked).isEqualTo(ids.size());
                assertThat(deleted).as("each file deleted by exactly one replica").isEqualTo(ids.size());
            } finally {
                pool.shutdownNow();
            }
            assertThat(files.count()).isZero();
            assertThat(store.list(null, 1000).objects()).noneMatch(object -> object.key().startsWith("sweep/"));
            assertThat(context.getBean(ActivityHistoryRepository.class).findAll())
                    .filteredOn(entry -> entry.getEventType().equals("FILE_DELETED")).hasSize(ids.size());
        }
    }

    @Test
    void attachedFilesFollowTheProjectRetentionAfterTheInstanceEnds() throws Exception {
        try (ConfigurableApplicationContext context = start("abada_files_retention")) {
            JdbcTemplate jdbc = context.getBean(JdbcTemplate.class);
            String projectId = project(context);
            AbadaEngine engine = context.getBean(AbadaEngine.class);
            engine.deploy(projectId, new ByteArrayInputStream(resource("apl/supplier-onboarding.apl.yaml")));
            String ended = engine.startProcess(projectId, "supplier_onboarding", "alice", Map.of()).getId();
            String running = engine.startProcess(projectId, "supplier_onboarding", "alice", Map.of()).getId();
            jdbc.update("update process_instances set status = 'COMPLETED', end_date = ? where id = ?",
                    java.sql.Timestamp.from(Instant.now().minus(Duration.ofDays(10))), ended);
            ProcessFileRepository files = context.getBean(ProcessFileRepository.class);
            String old = attached(files, projectId, ended);
            String live = attached(files, projectId, running);

            FileSweep sweep = context.getBean(FileSweep.class);
            assertThat(sweep.mark(Instant.now())).as("no retention: files are kept").isZero();
            jdbc.update("update projects set file_retention_days = 7 where id = ?", projectId);
            assertThat(sweep.mark(Instant.now())).isEqualTo(1);
            assertThat(files.findById(old).orElseThrow().getState()).isEqualTo(ProcessFileEntity.State.DELETING);
            assertThat(files.findById(old).orElseThrow().getDeletingReason()).isEqualTo("retention");
            assertThat(files.findById(live).orElseThrow().getState()).isEqualTo(ProcessFileEntity.State.ATTACHED);
        }
    }

    @Test
    void readinessFailsWhileRustfsDoesNotAnswerAndRecovers() throws Exception {
        try (ConfigurableApplicationContext context = start("abada_files_ready")) {
            assertThat(readiness(context)).isEqualTo(200);
            RUSTFS.getDockerClient().pauseContainerCmd(RUSTFS.getContainerId()).exec();
            try {
                assertThat(readiness(context)).isEqualTo(503);
                JsonNode health = JSON.readTree(http.send(HttpRequest.newBuilder(uri(context,
                        "/actuator/health")).GET().build(), HttpResponse.BodyHandlers.ofString()).body());
                assertThat(health.toString()).doesNotContain(SECRET).doesNotContain(ACCESS);
            } finally {
                RUSTFS.getDockerClient().unpauseContainerCmd(RUSTFS.getContainerId()).exec();
            }
            assertThat(readiness(context)).isEqualTo(200);
        }
        // An engine that cannot reach any store starts, and says it is not ready.
        try (ConfigurableApplicationContext context = start("abada_files_ready",
                "abada.files.endpoint=http://127.0.0.1:1")) {
            assertThat(readiness(context)).isEqualTo(503);
        }
    }

    @Test
    void aStoreThatRefusesEncryptedWritesIsNotReady() throws Exception {
        try (GenericContainer<?> noMasterKey = new GenericContainer<>(RUSTFS_IMAGE)
                .withEnv("RUSTFS_ACCESS_KEY", ACCESS).withEnv("RUSTFS_SECRET_KEY", SECRET)
                .withCommand("/data").withExposedPorts(9000)
                .waitingFor(Wait.forHttp("/health").forPort(9000).forStatusCode(200))) {
            noMasterKey.start();
            try (ConfigurableApplicationContext context = start("abada_files_ready", "abada.files.endpoint=http://"
                    + noMasterKey.getHost() + ":" + noMasterKey.getMappedPort(9000))) {
                assertThat(readiness(context)).isEqualTo(503);
                String health = http.send(HttpRequest.newBuilder(uri(context, "/actuator/health/readiness")).GET()
                        .build(), HttpResponse.BodyHandlers.ofString()).body();
                assertThat(health).doesNotContain(SECRET);
            }
        }
    }

    private String attached(ProcessFileRepository files, String projectId, String instanceId) {
        ProcessFileEntity row = new ProcessFileEntity();
        String id = UUID.randomUUID().toString();
        row.setId(id);
        row.setProjectId(projectId);
        row.setUploadedBy("alice");
        row.setContentType("application/pdf");
        row.setSizeBytes(1);
        row.setSha256("0".repeat(64));
        row.setName("a.pdf");
        row.setObjectKey(projectId + "/" + id);
        row.setState(ProcessFileEntity.State.ATTACHED);
        row.setInstanceId(instanceId);
        row.setTaskId("task");
        row.setFieldId("iso_certificate");
        row.setCreatedAt(Instant.now().minus(Duration.ofDays(11)));
        files.save(row);
        return id;
    }

    private String project(ConfigurableApplicationContext context) throws Exception {
        PrincipalRepository principals = context.getBean(PrincipalRepository.class);
        PrincipalEntity alice = principals.findById("alice-id").orElseGet(PrincipalEntity::new);
        alice.setId("alice-id");
        alice.setIssuer("test");
        alice.setSubjectId("alice-id");
        alice.setUsername("alice");
        alice.setFirstSeenAt(Instant.now());
        alice.setLastSeenAt(Instant.now());
        principals.save(alice);
        IdentityContext.set(new Identity("alice-id", "alice", List.of("abada-admin")));
        try {
            String projectId = context.getBean(ProjectService.class)
                    .create("files-" + UUID.randomUUID().toString().substring(0, 8), "Files", "").getId();
            ProjectTreeService trees = context.getBean(ProjectTreeService.class);
            String forms = trees.tree(projectId).stream()
                    .filter(node -> "FOLDER".equals(node.kind()) && "forms".equals(node.name()))
                    .map(ProjectTreeNodeDTO::id).findFirst().orElseThrow();
            trees.createResource(projectId, forms, "supplier-onboarding.json", "application/json",
                    ProjectResourceEntity.Kind.FORM, resource("apl/forms/supplier-onboarding.json"));
            return projectId;
        } finally {
            IdentityContext.clear();
        }
    }

    private int readiness(ConfigurableApplicationContext context) throws Exception {
        return http.send(HttpRequest.newBuilder(uri(context, "/actuator/health/readiness"))
                .timeout(Duration.ofSeconds(20)).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode();
    }

    private static URI uri(ConfigurableApplicationContext context, String path) {
        return URI.create("http://localhost:" + context.getEnvironment().getProperty("local.server.port") + "/api"
                + path);
    }

    private static S3Client s3() {
        return S3Client.builder().endpointOverride(URI.create(endpoint())).region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(ACCESS, SECRET)))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .httpClient(UrlConnectionHttpClient.create()).build();
    }

    private static String endpoint() {
        return "http://" + RUSTFS.getHost() + ":" + RUSTFS.getMappedPort(9000);
    }

    private static ConfigurableApplicationContext start(String database, String... extra) throws Exception {
        try (var connection = java.sql.DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                POSTGRES.getPassword()); var statement = connection.createStatement()) {
            var exists = statement.executeQuery("select 1 from pg_database where datname = '" + database + "'");
            if (!exists.next()) statement.execute("create database " + database);
        }
        String url = POSTGRES.getJdbcUrl().replace("/abada_files", "/" + database);
        List<String> properties = new ArrayList<>(List.of(
                "server.port=0",
                "spring.datasource.url=" + url,
                "spring.datasource.username=" + POSTGRES.getUsername(),
                "spring.datasource.password=" + POSTGRES.getPassword(),
                "spring.datasource.driver-class-name=org.postgresql.Driver",
                "spring.datasource.hikari.maximum-pool-size=6",
                "spring.datasource.hikari.minimum-idle=1",
                "spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect",
                "spring.jpa.hibernate.ddl-auto=validate",
                "spring.flyway.enabled=true",
                "spring.task.scheduling.enabled=false",
                "abada.outbox.dispatcher.enabled=false",
                "abada.security.mode=disabled",
                "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                "abada.insight.llm.api-key=test-key",
                "abada.files.store=s3",
                "abada.files.endpoint=" + endpoint(),
                "abada.files.access-key=" + ACCESS,
                "abada.files.secret-key=" + SECRET,
                "abada.files.connect-timeout=PT2S",
                "abada.files.read-timeout=PT3S",
                "abada.files.health-cache=PT0S",
                "otel.sdk.disabled=true",
                "management.tracing.enabled=false",
                "management.otlp.metrics.export.enabled=false"));
        properties.addAll(List.of(extra));
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(context,
                        properties.toArray(String[]::new)))
                .run("--spring.profiles.active=test");
    }

    private static byte[] resource(String name) throws Exception {
        try (InputStream in = PostgresRustfsFileTest.class.getClassLoader().getResourceAsStream(name)) {
            return in.readAllBytes();
        }
    }
}
