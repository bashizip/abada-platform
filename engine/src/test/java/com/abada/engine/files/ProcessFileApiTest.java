package com.abada.engine.files;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.TaskManager;
import com.abada.engine.persistence.entity.ActivityHistoryEntity;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.persistence.repository.ProcessFileRepository;
import com.abada.engine.project.ProjectService;
import com.abada.engine.security.Identity;
import com.abada.engine.util.DatabaseTestHelper;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

/**
 * Files in human tasks (S9), end to end on the API with the in-memory store:
 * upload, attachment in the completion transaction, the reference in the
 * variable, proxied download, and every refusal. The RustFS and PostgreSQL
 * behaviour is covered by {@code PostgresRustfsFileTest}.
 * Fixture: {@code apl/supplier-onboarding.apl.yaml} with its pinned form, whose
 * {@code iso_certificate} (single, .pdf or image/*, 5 MB, visible when
 * {@code iso_certified}) and {@code supporting_documents} (up to 3, .pdf or
 * .docx) are file fields.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = AbadaEngineApplication.class,
        properties = {"abada.files.max-file-bytes=4096", "abada.files.max-task-bytes=6000"})
@ActiveProfiles("test")
class ProcessFileApiTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    static final byte[] PDF = pdf(1200);

    @Autowired private TestRestTemplate rest;
    @Autowired private AbadaEngine engine;
    @Autowired private TaskManager tasks;
    @Autowired private DatabaseTestHelper database;
    @Autowired private ActivityHistoryRepository history;
    @Autowired private ProcessFileRepository files;
    @Autowired private ObjectStore objectStore;
    @Autowired private PrincipalRepository principals;
    @Autowired private ProjectService projectService;

    private InMemoryObjectStore store;
    private String projectId;
    private Map<String, Object> valid;

    @BeforeEach
    void projectWithTheSupplierForm() throws Exception {
        store = (InMemoryObjectStore) objectStore;
        store.setAvailable(true);
        store.clear();
        files.deleteAll();
        database.cleanup();
        engine.clearMemory();
        ResponseEntity<Map<String, Object>> created = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "suppliers", "name", "Suppliers", "description", ""), json("alice")),
                new ParameterizedTypeReference<>() {});
        projectId = (String) created.getBody().get("id");
        rest.exchange("/v1/projects/{p}/resources", HttpMethod.POST,
                new HttpEntity<>(Map.of("name", "supplier-onboarding.json", "folderId", formsFolder(), "kind", "FORM",
                        "contentType", "application/json", "contentBase64",
                        Base64.getEncoder().encodeToString(resource("apl/forms/supplier-onboarding.json"))),
                        json("alice")), String.class, projectId);
        engine.deploy(projectId, new ByteArrayInputStream(resource("apl/supplier-onboarding.apl.yaml")));
        valid = new HashMap<>(JSON.convertValue(JSON.readTree(resource("forms/submission-conformance.json"))
                .path("valid"), Map.class));
        valid.put("iso_certified", true);
        valid.put("certificate_expiry", "2027-06-30");
    }

    @AfterEach
    void storeBackUp() {
        store.setAvailable(true);
    }

    @Test
    void anUploadedFileIsAttachedByTheCompletionAndServedByTheEngine() throws Exception {
        String instanceId = start();
        String taskId = taskOf(instanceId);

        ResponseEntity<Map<String, Object>> uploaded = upload(taskId, "iso_certificate", "ISO 9001 – Ribeira.pdf",
                PDF, "alice");
        assertThat(uploaded.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        String fileId = (String) uploaded.getBody().get("fileId");
        assertThat(uploaded.getBody()).containsEntry("state", "PENDING").containsEntry("contentType", "application/pdf")
                .containsEntry("size", PDF.length).containsEntry("sha256", sha256(PDF));
        ProcessFileEntity row = files.findById(fileId).orElseThrow();
        assertThat(row.getObjectKey()).isEqualTo(projectId + "/" + fileId).doesNotContain("Ribeira");
        assertThat(store.contains(row.getObjectKey())).isTrue();

        Map<String, Object> values = new HashMap<>(valid);
        values.put("iso_certificate", fileId);
        assertThat(complete(taskId, values, "alice").getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(files.findById(fileId).orElseThrow().getState()).isEqualTo(ProcessFileEntity.State.ATTACHED);
        Object reference = engine.getProcessInstanceById(instanceId).getVariables().get("iso_certificate");
        assertThat(reference).isEqualTo(Map.of("fileId", fileId, "name", "ISO 9001 – Ribeira.pdf",
                "contentType", "application/pdf", "size", PDF.length, "sha256", sha256(PDF)));

        ResponseEntity<byte[]> download = rest.exchange("/v1/projects/{p}/files/{f}", HttpMethod.GET,
                new HttpEntity<>(json("alice")), byte[].class, projectId, fileId);
        assertThat(download.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(download.getBody()).isEqualTo(PDF);
        assertThat(download.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION)).startsWith("attachment;")
                .contains("filename*=UTF-8''ISO%209001%20%E2%80%93%20Ribeira.pdf");
        assertThat(download.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(download.getHeaders().getContentType().toString()).isEqualTo("application/pdf");

        List<ActivityHistoryEntity> audit = history.findByProcessInstanceIdOrderByOccurredAtAsc(instanceId);
        assertThat(audit).extracting(ActivityHistoryEntity::getEventType)
                .contains("FILE_UPLOADED", "FILE_ATTACHED", "FILE_DOWNLOADED");
        assertThat(audit).filteredOn(entry -> entry.getEventType().startsWith("FILE_"))
                .allSatisfy(entry -> assertThat(entry.getDetailsJson()).contains(fileId).doesNotContain("Ribeira"))
                .allSatisfy(entry -> assertThat(entry.getActor()).isEqualTo("alice"));
    }

    @Test
    void aRefusedCompletionLeavesTheFilesPendingAndAttachesNothing() throws Exception {
        String instanceId = start();
        String taskId = taskOf(instanceId);
        String fileId = fileId(upload(taskId, "supporting_documents", "letter.pdf", PDF, "alice"));

        Map<String, Object> broken = new HashMap<>(valid);
        broken.remove("legal_name");
        broken.put("supporting_documents", List.of(fileId));
        ResponseEntity<Map<String, Object>> refused = complete(taskId, broken, "alice");
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(files.findById(fileId).orElseThrow().getState()).isEqualTo(ProcessFileEntity.State.PENDING);
        assertThat(engine.getProcessInstanceById(instanceId).getVariables()).doesNotContainKey("supporting_documents");
        assertThat(history.findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                .noneMatch(entry -> entry.getEventType().equals("FILE_ATTACHED"));

        Map<String, Object> fixed = new HashMap<>(valid);
        fixed.put("supporting_documents", List.of(fileId));
        assertThat(complete(taskId, fixed, "alice").getStatusCode()).isEqualTo(HttpStatus.OK);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> references = (List<Map<String, Object>>) engine.getProcessInstanceById(instanceId)
                .getVariables().get("supporting_documents");
        assertThat(references).singleElement().satisfies(ref -> assertThat(ref).containsEntry("fileId", fileId));
    }

    @Test
    void anotherUserCanNeitherAttachNorReadAPendingFile() throws Exception {
        addMember("bob", Set.of("OPERATOR"));
        String instanceId = start();
        String taskId = taskOf(instanceId);
        String fileId = fileId(upload(taskId, "iso_certificate", "cert.pdf", PDF, "alice"));

        Map<String, Object> values = new HashMap<>(valid);
        values.put("iso_certificate", fileId);
        ResponseEntity<Map<String, Object>> stolen = complete(taskId, values, "bob");
        assertThat(stolen.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(stolen.getBody().toString()).contains("file_unknown");
        assertThat(files.findById(fileId).orElseThrow().getState()).isEqualTo(ProcessFileEntity.State.PENDING);

        assertThat(download(fileId, "bob").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(download(fileId, "mallory").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(rest.exchange("/v1/projects/{p}/files/{f}", HttpMethod.DELETE, new HttpEntity<>(json("bob")),
                String.class, projectId, fileId).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        // Once attached, the users of the instance's tasks may read it; a stranger and another project still may not.
        assertThat(complete(taskId, values, "alice").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(download(fileId, "bob").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(download(fileId, "mallory").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(rest.exchange("/v1/projects/{p}/files/{f}", HttpMethod.GET, new HttpEntity<>(json("alice")),
                String.class, "default", fileId).getStatusCode().is4xxClientError()).isTrue();
        // A file id written into another task's field is not that task's file.
        String second = taskOf(start());
        Map<String, Object> reused = new HashMap<>(valid);
        reused.put("iso_certificate", fileId);
        ResponseEntity<Map<String, Object>> refused = complete(second, reused, "alice");
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(refused.getBody().toString()).contains("file_unknown");
    }

    @Test
    void oversizeWrongTypeAndExecutableUploadsAreRefusedBeforeAnythingIsKept() throws Exception {
        String taskId = taskOf(start());
        assertRefused(upload(taskId, "iso_certificate", "big.pdf", pdf(5000), "alice"), HttpStatus.PAYLOAD_TOO_LARGE,
                "size");
        assertRefused(upload(taskId, "supporting_documents", "photo.png", png(), "alice"),
                HttpStatus.UNSUPPORTED_MEDIA_TYPE, "accept");
        assertRefused(upload(taskId, "iso_certificate", "scan.pdf", png(), "alice"),
                HttpStatus.UNSUPPORTED_MEDIA_TYPE, "type_mismatch");
        assertRefused(upload(taskId, "supporting_documents", "setup.pdf", portableExecutable(), "alice"),
                HttpStatus.UNSUPPORTED_MEDIA_TYPE, "executable");
        assertRefused(upload(taskId, "iso_certificate", "../", PDF, "alice"), HttpStatus.BAD_REQUEST, "name");
        assertThat(files.count()).isZero();
        assertThat(store.size()).isZero();

        // The task's total is capped across uploads: 2 × 3000 B fits in 6000, a third does not.
        assertThat(upload(taskId, "supporting_documents", "a.pdf", pdf(3000), "alice").getStatusCode())
                .isEqualTo(HttpStatus.CREATED);
        assertThat(upload(taskId, "supporting_documents", "b.pdf", pdf(3000), "alice").getStatusCode())
                .isEqualTo(HttpStatus.CREATED);
        assertRefused(upload(taskId, "supporting_documents", "c.pdf", pdf(100), "alice"),
                HttpStatus.PAYLOAD_TOO_LARGE, "task_total");

        // Only file fields of the task's pinned form take files, and only from users who may complete it.
        assertThat(upload(taskId, "legal_name", "a.pdf", PDF, "alice").getStatusCode().is4xxClientError()).isTrue();
        assertThat(upload(taskId, "iso_certificate", "a.pdf", PDF, "mallory").getStatusCode().is4xxClientError())
                .isTrue();
    }

    @Test
    void theObjectStoreIsOutsideTheCompletionTransaction() throws Exception {
        String instanceId = start();
        String taskId = taskOf(instanceId);

        store.setAvailable(false);
        ResponseEntity<Map<String, Object>> down = upload(taskId, "iso_certificate", "cert.pdf", PDF, "alice");
        assertThat(down.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(down.getBody()).containsEntry("code", "OBJECT_STORE_UNAVAILABLE");
        assertThat(files.count()).isZero();
        assertThat(rest.getForEntity("/actuator/health/readiness", String.class).getStatusCode())
                .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);

        store.setAvailable(true);
        String fileId = fileId(upload(taskId, "iso_certificate", "cert.pdf", PDF, "alice"));
        // The store goes away; completing the task needs only PostgreSQL.
        store.setAvailable(false);
        Map<String, Object> values = new HashMap<>(valid);
        values.put("iso_certificate", fileId);
        assertThat(complete(taskId, values, "alice").getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(files.findById(fileId).orElseThrow().getState()).isEqualTo(ProcessFileEntity.State.ATTACHED);
        assertThat(download(fileId, "alice").getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);

        // A restore without the object: the row says what it was, the contents are unavailable.
        store.setAvailable(true);
        store.clear();
        ResponseEntity<String> gone = download(fileId, "alice");
        assertThat(gone.getStatusCode()).isEqualTo(HttpStatus.GONE);
        assertThat(gone.getBody()).contains("FILE_UNAVAILABLE");
        assertThat(rest.exchange("/v1/projects/{p}/files/{f}/metadata", HttpMethod.GET, new HttpEntity<>(json("alice")),
                String.class, projectId, fileId).getBody()).contains("ATTACHED");
    }

    @Test
    void anUploaderRemovesAFileBeforeSubmittingAndItCannotBeAttachedAfter() throws Exception {
        String taskId = taskOf(start());
        String fileId = fileId(upload(taskId, "iso_certificate", "cert.pdf", PDF, "alice"));
        assertThat(rest.exchange("/v1/projects/{p}/files/{f}", HttpMethod.DELETE, new HttpEntity<>(json("alice")),
                String.class, projectId, fileId).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(files.findById(fileId).orElseThrow().getState()).isEqualTo(ProcessFileEntity.State.DELETING);
        assertThat(download(fileId, "alice").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        Map<String, Object> values = new HashMap<>(valid);
        values.put("iso_certificate", fileId);
        ResponseEntity<Map<String, Object>> refused = complete(taskId, values, "alice");
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(refused.getBody().toString()).contains("file_not_pending");
    }

    @Test
    void theFilePolicyIsSetByOwnersOnly() throws Exception {
        addMember("bob", Set.of("OPERATOR"));
        ResponseEntity<Map<String, Object>> set = rest.exchange("/v1/projects/{p}/file-policy", HttpMethod.PUT,
                new HttpEntity<>(Map.of("retentionDays", 30), json("alice")), new ParameterizedTypeReference<>() {},
                projectId);
        assertThat(set.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(set.getBody()).containsEntry("retentionDays", 30);
        assertThat(rest.exchange("/v1/projects/{p}/file-policy", HttpMethod.PUT,
                new HttpEntity<>(Map.of("retentionDays", 1), json("bob")), String.class, projectId)
                .getStatusCode().is4xxClientError()).isTrue();
        assertThat(rest.exchange("/v1/projects/{p}/file-policy", HttpMethod.PUT,
                new HttpEntity<>(Map.of("retentionDays", 0), json("alice")), String.class, projectId)
                .getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    // --- helpers -----------------------------------------------------------------

    private void assertRefused(ResponseEntity<Map<String, Object>> response, HttpStatus status, String reason) {
        assertThat(response.getStatusCode()).isEqualTo(status);
        assertThat(response.getBody()).containsEntry("code", "FILE_REJECTED");
        assertThat(response.getBody().get("details")).isEqualTo(Map.of("reason", reason));
    }

    private ResponseEntity<Map<String, Object>> upload(String taskId, String field, String name, byte[] bytes,
            String user) {
        HttpHeaders headers = json(user);
        headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        return rest.exchange("/v1/projects/{p}/tasks/{t}/files?field={f}&name={n}", HttpMethod.POST,
                new HttpEntity<>(bytes, headers), new ParameterizedTypeReference<>() {}, projectId, taskId, field, name);
    }

    private ResponseEntity<String> download(String fileId, String user) {
        return rest.exchange("/v1/projects/{p}/files/{f}", HttpMethod.GET, new HttpEntity<>(json(user)), String.class,
                projectId, fileId);
    }

    private static String fileId(ResponseEntity<Map<String, Object>> uploaded) {
        assertThat(uploaded.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return (String) uploaded.getBody().get("fileId");
    }

    private String start() {
        return engine.startProcess(projectId, "supplier_onboarding", "alice",
                Map.of("request_id", "SUP-2026-0418", "requested_by", "Ines Duarte")).getId();
    }

    private String taskOf(String instanceId) {
        return tasks.getTasksForProcessInstance(instanceId).getFirst().getId();
    }

    private ResponseEntity<Map<String, Object>> complete(String taskId, Map<String, Object> values, String user) {
        return rest.exchange("/v1/projects/{p}/tasks/{t}/complete", HttpMethod.POST,
                new HttpEntity<>(values, json(user)), new ParameterizedTypeReference<>() {}, projectId, taskId);
    }

    private void addMember(String username, Set<String> roles) {
        rest.exchange("/v1/projects/" + projectId + "/tasks", HttpMethod.GET, new HttpEntity<>(json(username)),
                String.class);
        PrincipalEntity principal = principals.findAll().stream().filter(p -> username.equals(p.getUsername()))
                .findFirst().orElseThrow();
        com.abada.engine.security.IdentityContext.set(new Identity("admin", "admin", List.of("ABADA_ADMIN")));
        try {
            projectService.putMember(projectId, principal.getId(), null,
                    roles.stream().map(ProjectMemberEntity.Role::valueOf).collect(java.util.stream.Collectors.toSet()),
                    Set.of(), Set.of());
        } finally {
            com.abada.engine.security.IdentityContext.clear();
        }
    }

    private String formsFolder() {
        ResponseEntity<List<Map<String, Object>>> tree = rest.exchange("/v1/projects/{p}/tree", HttpMethod.GET,
                new HttpEntity<>(json("alice")), new ParameterizedTypeReference<>() {}, projectId);
        return tree.getBody().stream().filter(node -> "FOLDER".equals(node.get("kind")) && "forms".equals(node.get("name")))
                .map(node -> (String) node.get("id")).findFirst().orElseThrow();
    }

    static byte[] pdf(int size) {
        byte[] bytes = new byte[size];
        Arrays.fill(bytes, (byte) 'x');
        byte[] head = "%PDF-1.7\n".getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(head, 0, bytes, 0, head.length);
        return bytes;
    }

    static byte[] png() {
        byte[] bytes = new byte[200];
        byte[] head = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
        System.arraycopy(head, 0, bytes, 0, head.length);
        return bytes;
    }

    static byte[] portableExecutable() {
        byte[] bytes = new byte[256];
        bytes[0] = 'M';
        bytes[1] = 'Z';
        bytes[0x3C] = (byte) 0x80;
        bytes[0x80] = 'P';
        bytes[0x81] = 'E';
        return bytes;
    }

    static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static byte[] resource(String name) throws Exception {
        try (InputStream in = ProcessFileApiTest.class.getClassLoader().getResourceAsStream(name)) {
            return in.readAllBytes();
        }
    }

    private static HttpHeaders json(String user) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-User", user);
        headers.set("X-Groups", "procurement");
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }
}
