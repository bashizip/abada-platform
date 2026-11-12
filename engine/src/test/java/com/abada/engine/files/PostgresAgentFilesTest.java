package com.abada.engine.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.TaskManager;
import com.abada.engine.core.agent.AgentEvidenceService;
import com.abada.engine.core.agent.AgentFileResolver;
import com.abada.engine.core.agent.AgentStepService;
import com.abada.engine.core.model.AgentAttemptMetadata;
import com.abada.engine.dto.AgentStepRequest;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.dto.ProjectTreeNodeDTO;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
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
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
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

/**
 * S15 on PostgreSQL and RustFS: an agent node reads a scanned declaration a person
 * uploaded. The engine resolves the declared file when the work is locked and sends
 * its reference, never its bytes; the worker downloads only declared files with its
 * lease; the step journal keeps the file's sha256 whatever the payload policy; a
 * reference to another instance's file, a pending, deleted or unknown file, or too
 * many files fail the work with a typed code; deployment refuses bad declarations.
 */
@Testcontainers
class PostgresAgentFilesTest {
    private static final String ACCESS = "3f9a1c0e5b7d2a8e4c6f0b1d3e5a7c9e2b4d6f8a0c1e3b5d";
    private static final String SECRET = "9e7c5a3b1d0f2e4c6a8b0d2f4e6c8a0b1d3f5e7c9a2b4d6f";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String WORKER = "agent-worker-1";

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_agent_files").withUsername("abada").withPassword("abada");

    @Container
    @SuppressWarnings("resource")
    private static final GenericContainer<?> RUSTFS = new GenericContainer<>(PostgresRustfsFileTest.RUSTFS_IMAGE)
            .withEnv("RUSTFS_ACCESS_KEY", ACCESS)
            .withEnv("RUSTFS_SECRET_KEY", SECRET)
            .withEnv("RUSTFS_CONSOLE_ENABLE", "false")
            .withEnv("RUSTFS_SSE_S3_MASTER_KEY", Base64.getEncoder().encodeToString(new byte[32]))
            .withCommand("/data")
            .withExposedPorts(9000)
            .waitingFor(Wait.forHttp("/health").forPort(9000).forStatusCode(200)
                    .withStartupTimeout(Duration.ofMinutes(2)));

    private static ConfigurableApplicationContext context;
    private static String projectId;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @BeforeAll
    static void startEngine() throws Exception {
        context = new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(ctx -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(ctx,
                        "server.port=0",
                        "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=" + POSTGRES.getUsername(),
                        "spring.datasource.password=" + POSTGRES.getPassword(),
                        "spring.datasource.driver-class-name=org.postgresql.Driver",
                        "spring.datasource.hikari.maximum-pool-size=6",
                        "spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect",
                        "spring.jpa.hibernate.ddl-auto=validate",
                        "spring.jpa.show-sql=false",
                        "spring.flyway.enabled=true",
                        "spring.task.scheduling.enabled=false",
                        "abada.outbox.dispatcher.enabled=false",
                        "abada.security.mode=disabled",
                        "abada.insight.llm.base-url=http://llm.test.invalid/v1",
                        "abada.insight.llm.api-key=test-key",
                        "abada.files.store=s3",
                        "abada.files.endpoint=http://" + RUSTFS.getHost() + ":" + RUSTFS.getMappedPort(9000),
                        "abada.files.access-key=" + ACCESS,
                        "abada.files.secret-key=" + SECRET,
                        "abada.files.health-cache=PT0S",
                        "otel.sdk.disabled=true",
                        "management.tracing.enabled=false",
                        "management.otlp.metrics.export.enabled=false"))
                .run("--spring.profiles.active=test");
        projectId = project();
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        engine.deploy(projectId, new ByteArrayInputStream(resource("apl/declaration-intake.apl.yaml")));
        engine.deploy(projectId, new ByteArrayInputStream(resource("apl/agent-file-guard.apl.yaml")));
        engine.deploy(projectId, new ByteArrayInputStream(resource("apl/agent-file-limit.apl.yaml")));
    }

    @AfterAll
    static void stopEngine() {
        if (context != null) context.close();
    }

    private static String project() throws Exception {
        PrincipalRepository principals = context.getBean(PrincipalRepository.class);
        PrincipalEntity alice = principals.findById("alice-id").orElseGet(PrincipalEntity::new);
        alice.setId("alice-id");
        alice.setIssuer("test");
        alice.setSubjectId("alice-id");
        alice.setUsername("alice");
        alice.setFirstSeenAt(Instant.now());
        alice.setLastSeenAt(Instant.now());
        principals.save(alice);
        asAdmin();
        try {
            String id = context.getBean(ProjectService.class)
                    .create("agent-files-" + UUID.randomUUID().toString().substring(0, 8), "Agent files", "").getId();
            ProjectTreeService trees = context.getBean(ProjectTreeService.class);
            String forms = trees.tree(id).stream()
                    .filter(node -> "FOLDER".equals(node.kind()) && "forms".equals(node.name()))
                    .map(ProjectTreeNodeDTO::id).findFirst().orElseThrow();
            trees.createResource(id, forms, "declaration-depot.json", "application/json",
                    ProjectResourceEntity.Kind.FORM, resource("apl/forms/declaration-depot.json"));
            return id;
        } finally {
            IdentityContext.clear();
        }
    }

    private static void asAdmin() {
        IdentityContext.set(new Identity("alice-id", "alice", List.of("abada-admin")));
    }

    // ── Helpers ──

    /** Starts an intake, uploads a scan (and an annex), completes the upload task. */
    private Intake intake(byte[] scan, String scanName) throws Exception {
        return intake("declaration_intake", scan, scanName);
    }

    private Intake intake(String processKey, byte[] scan, String scanName) throws Exception {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String instanceId = engine.startProcess(projectId, processKey, "alice", Map.of()).getId();
        String taskId = context.getBean(TaskManager.class).getTasksForProcessInstance(instanceId).getFirst().getId();
        String scanId = upload(taskId, "bordereau_scan", scanName, scan);
        String annexId = upload(taskId, "annexe", "annexe.pdf", ProcessFileApiTest.pdf(900));
        HttpResponse<String> completed = send(HttpRequest.newBuilder(uri("/v1/projects/" + projectId + "/tasks/"
                        + taskId + "/complete")).header("X-User", "alice").header("X-Groups", "declarations,abada-admin")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(Map.of(
                        "bordereau_scan", scanId, "annexe", annexId)))).build());
        assertThat(completed.statusCode()).as(completed.body()).isEqualTo(200);
        return new Intake(instanceId, scanId, annexId);
    }

    private record Intake(String instanceId, String scanId, String annexId) {}

    private String upload(String taskId, String field, String name, byte[] bytes) throws Exception {
        HttpResponse<String> uploaded = send(HttpRequest.newBuilder(uri("/v1/projects/" + projectId + "/tasks/"
                        + taskId + "/files?field=" + field + "&name=" + name))
                .header("X-User", "alice").header("X-Groups", "declarations,abada-admin")
                .header("Content-Type", "application/octet-stream")
                .POST(HttpRequest.BodyPublishers.ofByteArray(bytes)).build());
        assertThat(uploaded.statusCode()).as(uploaded.body()).isEqualTo(201);
        return JSON.readTree(uploaded.body()).path("fileId").asText();
    }

    private HttpResponse<String> send(HttpRequest request) throws Exception {
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private LockedExternalTask lockFor(String instanceId) {
        ExternalTaskCommandService commands = context.getBean(ExternalTaskCommandService.class);
        for (int i = 0; i < 20; i++) {
            List<LockedExternalTask> locked = commands.fetchAndLock(
                    new FetchAndLockRequest(WORKER, List.of("abada:agent"), 60_000L, 10));
            for (LockedExternalTask task : locked) if (task.processInstanceId().equals(instanceId)) return task;
            if (locked.isEmpty()) break;
        }
        return null;
    }

    private ExternalTaskEntity agentTask(String instanceId) {
        return context.getBean(ExternalTaskRepository.class).findAll().stream()
                .filter(task -> task.getProcessInstanceId().equals(instanceId)).findFirst().orElseThrow();
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static URI uri(String path) {
        return URI.create("http://localhost:" + context.getEnvironment().getProperty("local.server.port") + "/api"
                + path);
    }

    private static byte[] resource(String name) throws Exception {
        try (InputStream in = PostgresAgentFilesTest.class.getClassLoader().getResourceAsStream(name)) {
            return in.readAllBytes();
        }
    }

    // ── Tests ──

    @Test
    void aScannedDeclarationReachesTheAgentAsAReferenceAndLeavesItsSha256InTheEvidence() throws Exception {
        byte[] scan = ProcessFileApiTest.pdf(4200);
        Intake intake = intake(scan, "bordereau-2026-10.pdf");

        LockedExternalTask task = lockFor(intake.instanceId());
        assertThat(task).isNotNull();
        var files = task.agentWork().resolvedFiles();
        assertThat(files).hasSize(1);
        assertThat(files.getFirst().fileId()).isEqualTo(intake.scanId());
        assertThat(files.getFirst().name()).isEqualTo("bordereau");
        assertThat(files.getFirst().contentType()).isEqualTo("application/pdf");
        assertThat(files.getFirst().sizeBytes()).isEqualTo(scan.length);
        assertThat(files.getFirst().sha256()).isEqualTo(sha256(scan));
        // The descriptor and the payload carry references only: never the bytes, never the annex.
        String wire = context.getBean(ObjectMapper.class).writeValueAsString(task);
        assertThat(wire).doesNotContain("%PDF").doesNotContain(Base64.getEncoder().encodeToString(scan))
                .doesNotContain(intake.annexId());

        // The worker holding the lease downloads the declared file, and only that one.
        HttpResponse<byte[]> download = http.send(HttpRequest.newBuilder(uri("/v1/external-tasks/" + task.id()
                + "/files/" + intake.scanId() + "?workerId=" + WORKER)).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertThat(download.statusCode()).isEqualTo(200);
        assertThat(sha256(download.body())).isEqualTo(sha256(scan));
        assertThat(http.send(HttpRequest.newBuilder(uri("/v1/external-tasks/" + task.id() + "/files/"
                + intake.annexId() + "?workerId=" + WORKER)).GET().build(),
                HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(404);
        assertThat(http.send(HttpRequest.newBuilder(uri("/v1/external-tasks/" + task.id() + "/files/"
                + intake.scanId() + "?workerId=someone-else")).GET().build(),
                HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(409);

        // The model call names the file; the engine verifies it and keeps id, type, size and sha256.
        AgentStepService steps = context.getBean(AgentStepService.class);
        JsonNode forged = JSON.valueToTree(Map.of("turn", 1, "model", "gemini-3.6-flash",
                "files", List.of(Map.of("fileId", intake.scanId(), "sha256", "0".repeat(64)))));
        assertThatThrownBy(() -> steps.record(task.id(), new AgentStepRequest(WORKER, task.attempt(), 1,
                "MODEL_CALL", "STARTED", null, forged, null, null, "gemini-3.6-flash", null, null, null)))
                .hasMessageContaining("other contents");
        JsonNode annex = JSON.valueToTree(Map.of("turn", 1, "model", "gemini-3.6-flash",
                "files", List.of(Map.of("fileId", intake.annexId(), "sha256", "x"))));
        assertThatThrownBy(() -> steps.record(task.id(), new AgentStepRequest(WORKER, task.attempt(), 1,
                "MODEL_CALL", "STARTED", null, annex, null, null, "gemini-3.6-flash", null, null, null)))
                .hasMessageContaining("only the files its node declares");
        JsonNode request = JSON.valueToTree(Map.of("turn", 1, "model", "gemini-3.6-flash",
                "files", List.of(Map.of("name", "bordereau", "fileId", intake.scanId(), "sha256", sha256(scan)))));
        steps.record(task.id(), new AgentStepRequest(WORKER, task.attempt(), 1, "MODEL_CALL", "STARTED", null,
                request, null, null, "gemini-3.6-flash", null, null, null));
        steps.record(task.id(), new AgentStepRequest(WORKER, task.attempt(), 1, "MODEL_CALL", "COMPLETED", null,
                request, JSON.valueToTree(Map.of("value", Map.of("payroll", 1200, "headcount", 3),
                        "confidence", 42)), null, "gemini-3.6-flash", null, 1800, 40));

        // Low confidence: the engine routes to manual entry, as for any agent.
        context.getBean(ExternalTaskCommandService.class).complete(task.id(), WORKER,
                Map.of("lecture", Map.of("payroll", 1200, "headcount", 3)),
                new AgentAttemptMetadata("gemini-3.6-flash", "google-gemini", 1, 900L, List.of(), "lecture", null,
                        null, 42.0, 1800, 40, null));
        var manual = context.getBean(TaskManager.class).getTasksForProcessInstance(intake.instanceId());
        assertThat(manual).anyMatch(next -> "saisie".equals(next.getTaskDefinitionKey()));

        asAdmin();
        try {
            var evidence = context.getBean(AgentEvidenceService.class).steps(projectId, intake.instanceId());
            JsonNode recorded = evidence.stream().filter(step -> "MODEL_CALL".equals(step.kind()))
                    .findFirst().orElseThrow().files();
            assertThat(recorded).hasSize(1);
            assertThat(recorded.get(0).path("sha256").asText()).isEqualTo(sha256(scan));
            assertThat(recorded.get(0).path("fileName").asText()).isEqualTo("bordereau-2026-10.pdf");
            assertThat(recorded.get(0).path("contentType").asText()).isEqualTo("application/pdf");
        } finally {
            IdentityContext.clear();
        }
        JdbcTemplate jdbc = context.getBean(JdbcTemplate.class);
        String filesJson = jdbc.queryForObject("select files_json from agent_steps where external_task_id = ?",
                String.class, task.id());
        assertThat(filesJson).contains(sha256(scan)).doesNotContain("%PDF");
        String locked = jdbc.queryForObject("select details_json from activity_history where process_instance_id = ?"
                + " and event_type = 'EXTERNAL_TASK_LOCKED'", String.class, intake.instanceId());
        assertThat(locked).contains(sha256(scan));
    }

    @Test
    void aReferenceToAnotherInstancesFileFailsTheWorkWithATypedCode() throws Exception {
        Intake other = intake(ProcessFileApiTest.pdf(1500), "other.pdf");
        Map<String, Object> stolen = ProcessFileService.reference(
                context.getBean(ProcessFileRepository.class).findById(other.scanId()).orElseThrow());
        assertGuardFails(Map.of("doc_ref", stolen), AgentFileResolver.INVALID, "another process instance");
    }

    @Test
    void unknownPendingAndMalformedReferencesFailTheWork() throws Exception {
        assertGuardFails(Map.of("doc_ref", Map.of("fileId", UUID.randomUUID().toString())),
                AgentFileResolver.INVALID, "no longer exists");
        assertGuardFails(Map.of("doc_ref", "just text"), AgentFileResolver.INVALID, "not a file reference");

        // Uploaded but never submitted: PENDING.
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String intakeId = engine.startProcess(projectId, "declaration_intake", "alice", Map.of()).getId();
        String taskId = context.getBean(TaskManager.class).getTasksForProcessInstance(intakeId).getFirst().getId();
        String pending = upload(taskId, "bordereau_scan", "draft.pdf", ProcessFileApiTest.pdf(700));
        assertGuardFails(Map.of("doc_ref", Map.of("fileId", pending)), AgentFileResolver.INVALID, "not attached");
    }

    @Test
    void moreFilesThanMaxFilesFailTheWork() throws Exception {
        // The node reads two files with max_files: 1; both are attached to this instance.
        Intake intake = intake("agent_file_limit", ProcessFileApiTest.pdf(800), "a.pdf");
        assertThat(lockFor(intake.instanceId())).as("the work is not handed to a worker").isNull();
        ExternalTaskEntity task = agentTask(intake.instanceId());
        assertThat(task.getExceptionMessage()).contains("max_files (1)");
        String failed = context.getBean(JdbcTemplate.class).queryForObject("select details_json from activity_history"
                + " where process_instance_id = ? and event_type = 'EXTERNAL_TASK_FAILED'", String.class,
                intake.instanceId());
        assertThat(failed).contains(AgentFileResolver.LIMIT);
    }

    private void assertGuardFails(Map<String, Object> variables, String code, String reason) {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String instanceId = engine.startProcess(projectId, "agent_file_guard", "alice", variables).getId();
        assertThat(lockFor(instanceId)).as("the work is not handed to a worker").isNull();
        ExternalTaskEntity task = agentTask(instanceId);
        assertThat(task.getStatus()).isNotIn(ExternalTaskEntity.Status.LOCKED, ExternalTaskEntity.Status.OPEN);
        assertThat(task.getExceptionMessage()).contains(reason);
        String failed = context.getBean(JdbcTemplate.class).queryForObject("select details_json from activity_history"
                + " where process_instance_id = ? and event_type = 'EXTERNAL_TASK_FAILED'", String.class, instanceId);
        assertThat(failed).contains(code);
        Integer incidents = context.getBean(JdbcTemplate.class).queryForObject(
                "select count(*) from incidents where process_instance_id = ?", Integer.class, instanceId);
        assertThat(incidents).as("WORK_FAILED incident").isEqualTo(1);
    }

    @Test
    void deploymentRefusesBadFileDeclarations() {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String base = """
                version: abada.io/v1
                metadata:
                  key: bad_files_%s
                  name: Bad files
                flow:
                  entry: start
                  nodes:
                    - id: start
                      type: webhook
                      next: lecture
                    - id: lecture
                      type: agent
                      model: gemini-3.6-flash
                      prompt: Read it.
                %s
                      next: done
                    - id: done
                      type: end
                """;
        List<String[]> cases = new ArrayList<>();
        cases.add(new String[] {"syntax", "      files:\n        doc: \"doc_ref +\"", "lecture"});
        cases.add(new String[] {"clash", "      inputs:\n        doc: doc_ref\n      files:\n        doc: doc_ref",
                "both in inputs and in files"});
        cases.add(new String[] {"name", "      files:\n        \"9doc\": doc_ref", "must be letters"});
        cases.add(new String[] {"max", "      files:\n        doc: doc_ref\n      max_files: 50", "max_files"});
        cases.add(new String[] {"orphan_max", "      max_files: 2", "declares no files"});
        cases.add(new String[] {"empty", "      files: {}", "files is empty"});
        for (String[] bad : cases) {
            byte[] source = base.formatted(bad[0], bad[1]).getBytes(StandardCharsets.UTF_8);
            assertThatThrownBy(() -> engine.deploy(projectId, new ByteArrayInputStream(source)))
                    .as(bad[0]).satisfies(error -> assertThat(String.valueOf(error.getMessage())
                            + describe(error)).contains(bad[2]));
        }
    }

    private static String describe(Throwable error) {
        if (error instanceof com.abada.engine.bpmn.compatibility.BpmnValidationException validation) {
            return validation.getIssues().toString();
        }
        return "";
    }
}
