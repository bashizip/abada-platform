package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.TaskManager;
import com.abada.engine.forms.FormSnapshotService;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.util.DatabaseTestHelper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
 * The engine enforces a task's form (S8): the form is pinned when the
 * definition is deployed, completion is checked against that pin and refused
 * as a whole, and editing the form changes only versions deployed after it.
 * Fixture: {@code apl/supplier-onboarding.apl.yaml} with {@code apl/forms/supplier-onboarding.json}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class TaskFormApiTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired private TestRestTemplate rest;
    @Autowired private AbadaEngine engine;
    @Autowired private TaskManager tasks;
    @Autowired private DatabaseTestHelper database;
    @Autowired private ActivityHistoryRepository history;

    private String projectId;
    private String formId;
    private ObjectNode form;
    private Map<String, Object> valid;

    @BeforeEach
    void projectWithTheSupplierForm() throws Exception {
        database.cleanup();
        engine.clearMemory();
        ResponseEntity<Map<String, Object>> created = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "suppliers", "name", "Suppliers", "description", ""), json("alice")),
                new ParameterizedTypeReference<>() {});
        projectId = (String) created.getBody().get("id");
        form = (ObjectNode) JSON.readTree(resource("apl/forms/supplier-onboarding.json"));
        ResponseEntity<Map<String, Object>> stored = rest.exchange("/v1/projects/{p}/resources", HttpMethod.POST,
                new HttpEntity<>(Map.of("name", "supplier-onboarding.json", "folderId", formsFolder(), "kind", "FORM",
                        "contentType", "application/json", "contentBase64", base64(form)), json("alice")),
                new ParameterizedTypeReference<>() {}, projectId);
        assertThat(stored.getStatusCode()).isEqualTo(HttpStatus.OK);
        formId = (String) stored.getBody().get("id");
        valid = new HashMap<>(JSON.convertValue(JSON.readTree(resource("forms/submission-conformance.json")).path("valid"),
                Map.class));
    }

    @Test
    void theTaskServesThePinnedFormAndRefusesValuesThatBreakIt() throws Exception {
        deploy();
        String instanceId = start();
        String taskId = taskOf(instanceId);

        ResponseEntity<Map<String, Object>> served = rest.exchange("/v1/projects/{p}/tasks/{t}/form", HttpMethod.GET,
                new HttpEntity<>(json("alice")), new ParameterizedTypeReference<>() {}, projectId, taskId);
        assertThat(served.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(served.getBody()).containsEntry("formKey", "supplier-onboarding").containsEntry("pinned", true);
        assertThat((Object) JSON.valueToTree(served.getBody().get("schema"))).isEqualTo(form);

        Map<String, Object> broken = new HashMap<>(valid);
        broken.put("vat_id", "PT50987");
        broken.put("annual_spend", 6_000_000);
        broken.remove("legal_name");
        ResponseEntity<Map<String, Object>> refused = complete(taskId, broken, "alice");
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(refused.getBody()).containsEntry("code", "FORM_INVALID");
        @SuppressWarnings("unchecked")
        Map<String, Object> details = (Map<String, Object>) refused.getBody().get("details");
        assertThat(details.get("violations")).isEqualTo(List.of(Map.of("field", "legal_name", "rule", "required"),
                Map.of("field", "vat_id", "rule", "pattern"), Map.of("field", "annual_spend", "rule", "max")));
        assertThat(JSON.writeValueAsString(refused.getBody())).doesNotContain("PT50987").doesNotContain("6000000");

        // All or nothing: the task is still open and nothing was written.
        assertThat(engine.getProcessInstanceById(instanceId).getActiveTokens()).containsExactly("review");
        assertThat(engine.getProcessInstanceById(instanceId).getVariables()).doesNotContainKeys("vat_id", "country");
        assertThat(history.findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                .noneMatch(entry -> entry.getEventType().equals("TASK_COMPLETED"));

        // A hidden field is not required and its value is discarded.
        Map<String, Object> hidden = new HashMap<>(valid);
        hidden.put("vat_registered", false);
        hidden.put("vat_id", "anything");
        ResponseEntity<Map<String, Object>> done = complete(taskId, hidden, "alice");
        assertThat(done.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> variables = engine.getProcessInstanceById(instanceId).getVariables();
        assertThat(variables).containsEntry("country", "Portugal").doesNotContainKey("vat_id");
        assertThat(history.findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                .filteredOn(entry -> entry.getEventType().equals("TASK_COMPLETED")).singleElement()
                .satisfies(entry -> assertThat(entry.getDetailsJson()).contains("discardedHiddenFields")
                        .contains("supplier-onboarding").doesNotContain("anything"));
    }

    @Test
    void editingTheFormChangesOnlyVersionsDeployedAfterIt() throws Exception {
        int first = deploy();
        String openTask = taskOf(start());

        // The edit: trading_name becomes required.
        ((ObjectNode) form.withArray("fields").get(3)).put("required", true);
        replaceForm();

        assertThat(complete(openTask, valid, "alice").getStatusCode()).isEqualTo(HttpStatus.OK);

        int second = deploy();
        assertThat(second).isEqualTo(first + 1);
        String newTask = taskOf(start());
        ResponseEntity<Map<String, Object>> refused = complete(newTask, valid, "alice");
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(refused.getBody().toString()).contains("trading_name");
        assertThat(deploy()).as("same source and form: no new version").isEqualTo(second);
    }

    @Test
    void anInvalidFormFailsTheDeploymentLoudly() throws Exception {
        ((ObjectNode) form.withArray("fields").get(4)).put("pattern", "(?=lookahead)x");
        ((ObjectNode) form.withArray("fields").get(5)).put("type", "file").putArray("accept").add("bogus");
        replaceForm();
        assertThatThrownBy(this::deploy).isInstanceOfSatisfying(BpmnValidationException.class, invalid ->
                assertThat(invalid.getIssues()).allSatisfy(issue -> {
                    assertThat(issue.code()).isEqualTo(FormSnapshotService.FORM_CODE);
                    assertThat(issue.elementId()).isEqualTo("review");
                }).anySatisfy(issue -> assertThat(issue.message()).contains("not a portable regular expression"))
                        .anySatisfy(issue -> assertThat(issue.message()).contains("accept entry 'bogus'")));
    }

    @Test
    void aStrangerCannotReadTheFormAndATaskWithoutAFormHasNone() throws Exception {
        deploy();
        String taskId = taskOf(start());
        ResponseEntity<String> stranger = rest.exchange("/v1/projects/{p}/tasks/{t}/form", HttpMethod.GET,
                new HttpEntity<>(json("mallory")), String.class, projectId, taskId);
        assertThat(stranger.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(stranger.getBody()).doesNotContain("legal_name");
        ResponseEntity<String> wrongProject = rest.exchange("/v1/projects/{p}/tasks/{t}/form", HttpMethod.GET,
                new HttpEntity<>(json("alice")), String.class, "default", taskId);
        assertThat(wrongProject.getStatusCode().is4xxClientError()).isTrue();

        String noForm = new String(resource("apl/supplier-onboarding.apl.yaml"), StandardCharsets.UTF_8)
                .replace("supplier_onboarding", "no_form").replace("      formKey: supplier-onboarding\n", "");
        engine.deploy(projectId, new ByteArrayInputStream(noForm.getBytes(StandardCharsets.UTF_8)));
        String plain = taskOf(engine.startProcess(projectId, "no_form", "alice", Map.of()).getId());
        assertThat(rest.exchange("/v1/projects/{p}/tasks/{t}/form", HttpMethod.GET, new HttpEntity<>(json("alice")),
                String.class, projectId, plain).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(complete(plain, Map.of("anything", 1), "alice").getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    void aFormCreatedAfterTheDeploymentIsServedLiveAndNotEnforced() throws Exception {
        String source = new String(resource("apl/supplier-onboarding.apl.yaml"), StandardCharsets.UTF_8)
                .replace("supplier_onboarding", "late_form").replace("formKey: supplier-onboarding", "formKey: late");
        engine.deploy(projectId, new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)));
        rest.exchange("/v1/projects/{p}/resources", HttpMethod.POST,
                new HttpEntity<>(Map.of("name", "late.json", "folderId", formsFolder(), "kind", "FORM",
                        "contentType", "application/json", "contentBase64", base64(form)), json("alice")),
                String.class, projectId);
        String taskId = taskOf(engine.startProcess(projectId, "late_form", "alice", Map.of()).getId());

        ResponseEntity<Map<String, Object>> served = rest.exchange("/v1/projects/{p}/tasks/{t}/form", HttpMethod.GET,
                new HttpEntity<>(json("alice")), new ParameterizedTypeReference<>() {}, projectId, taskId);
        assertThat(served.getBody()).containsEntry("formKey", "late").containsEntry("pinned", false);
        assertThat(complete(taskId, Map.of("vat_id", "nonsense"), "alice").getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private int deploy() throws Exception {
        return engine.deploy(projectId, new ByteArrayInputStream(resource("apl/supplier-onboarding.apl.yaml")))
                .getVersion();
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

    private void replaceForm() throws Exception {
        ResponseEntity<Map<String, Object>> current = rest.exchange("/v1/projects/{p}/resources/{r}", HttpMethod.GET,
                new HttpEntity<>(json("alice")), new ParameterizedTypeReference<>() {}, projectId, formId);
        long revision = ((Number) current.getBody().get("revision")).longValue();
        ResponseEntity<String> replaced = rest.exchange("/v1/projects/{p}/resources/{r}", HttpMethod.PUT,
                new HttpEntity<>(Map.of("expectedRevision", revision, "contentType", "application/json",
                        "contentBase64", base64(form)), json("alice")), String.class, projectId, formId);
        assertThat(replaced.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private String formsFolder() {
        ResponseEntity<List<Map<String, Object>>> tree = rest.exchange("/v1/projects/{p}/tree", HttpMethod.GET,
                new HttpEntity<>(json("alice")), new ParameterizedTypeReference<>() {}, projectId);
        return tree.getBody().stream().filter(node -> "FOLDER".equals(node.get("kind")) && "forms".equals(node.get("name")))
                .map(node -> (String) node.get("id")).findFirst().orElseThrow();
    }

    private static String base64(Object json) throws Exception {
        return Base64.getEncoder().encodeToString(JSON.writeValueAsBytes(json));
    }

    private static byte[] resource(String name) throws Exception {
        try (InputStream in = TaskFormApiTest.class.getClassLoader().getResourceAsStream(name)) {
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
