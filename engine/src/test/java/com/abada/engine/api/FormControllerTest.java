package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.dto.ProjectResourceContentDTO;
import com.abada.engine.dto.ProjectResourceDTO;
import com.abada.engine.util.DatabaseTestHelper;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class FormControllerTest {

    @Autowired private TestRestTemplate rest;
    @Autowired private DatabaseTestHelper databaseTestHelper;

    private HttpHeaders alice;
    private String projectId;
    private String formsFolderId;

    @BeforeEach
    void setUp() {
        databaseTestHelper.cleanup();
        alice = new HttpHeaders();
        alice.set("X-User", "alice");
        alice.set("X-Groups", "abada-task-user");

        ResponseEntity<Map<String, Object>> created = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "forms-demo", "name", "Forms Demo", "description", ""), alice),
                new ParameterizedTypeReference<>() {});
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.OK);
        projectId = (String) created.getBody().get("id");

        ResponseEntity<List<Map<String, Object>>> tree = rest.exchange(
                "/v1/projects/" + projectId + "/tree", HttpMethod.GET,
                new HttpEntity<>(alice), new ParameterizedTypeReference<>() {});
        formsFolderId = ((List<Map<String, Object>>) tree.getBody()).stream()
                .filter(node -> "FOLDER".equals(node.get("kind")) && "forms".equals(node.get("name")))
                .map(node -> (String) node.get("id"))
                .findFirst().orElseThrow();
    }

    private String b64(String text) {
        return Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }

    private String createForm(String name) {
        String schema = "{\"title\":\"" + name + "\",\"fields\":[{\"id\":\"approved\","
                + "\"type\":\"boolean\",\"label\":\"Approved\",\"required\":true}]}";
        ResponseEntity<Map<String, Object>> res = rest.exchange("/v1/projects/" + projectId + "/resources",
                HttpMethod.POST, new HttpEntity<>(Map.of(
                        "name", name,
                        "folderId", formsFolderId,
                        "kind", "FORM",
                        "contentType", "application/json",
                        "contentBase64", b64(schema)), alice),
                new ParameterizedTypeReference<>() {});
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        return (String) res.getBody().get("id");
    }

    @Test
    @DisplayName("List forms returns FORM resources ordered by name")
    void listsOnlyFormResources() {
        createForm("zebra-form.json");
        createForm("loan-approval.json");
        // A plain (non-FORM) resource must be excluded from the forms list.
        String schema = "{\"title\":\"readme\"}";
        rest.exchange("/v1/projects/" + projectId + "/resources",
                HttpMethod.POST, new HttpEntity<>(Map.of(
                        "name", "README.md",
                        "folderId", formsFolderId,
                        "kind", "RESOURCE",
                        "contentType", "text/markdown",
                        "contentBase64", b64(schema)), alice),
                new ParameterizedTypeReference<>() {});

        ResponseEntity<List<ProjectResourceDTO>> res = rest.exchange(
                "/v1/projects/" + projectId + "/forms", HttpMethod.GET,
                new HttpEntity<>(alice), new ParameterizedTypeReference<>() {});
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(res.getBody()).isNotNull().hasSize(2);
        assertThat(res.getBody()).extracting(ProjectResourceDTO::name)
                .containsExactly("loan-approval.json", "zebra-form.json");
        assertThat(res.getBody()).allMatch(dto -> "FORM".equals(dto.kind()));
    }

    @Test
    @DisplayName("Resolve form by bare slug and by full file name")
    void resolvesFormBySlugAndName() {
        createForm("loan-approval.json");

        ResponseEntity<ProjectResourceContentDTO> bySlug = rest.exchange(
                "/v1/projects/" + projectId + "/forms/loan-approval", HttpMethod.GET,
                new HttpEntity<>(alice), new ParameterizedTypeReference<>() {});
        assertThat(bySlug.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(bySlug.getBody()).isNotNull();
        assertThat(bySlug.getBody().name()).isEqualTo("loan-approval.json");
        assertThat(bySlug.getBody().kind()).isEqualTo("FORM");
        assertThat(new String(Base64.getDecoder().decode(bySlug.getBody().contentBase64())))
                .contains("\"approved\"");

        ResponseEntity<ProjectResourceContentDTO> byName = rest.exchange(
                "/v1/projects/" + projectId + "/forms/loan-approval.json", HttpMethod.GET,
                new HttpEntity<>(alice), new ParameterizedTypeReference<>() {});
        assertThat(byName.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(byName.getBody().id()).isEqualTo(bySlug.getBody().id());
    }

    @Test
    @DisplayName("Resolving an unknown form key returns 404")
    void unknownFormKeyIsNotFound() {
        ResponseEntity<String> res = rest.exchange(
                "/v1/projects/" + projectId + "/forms/does-not-exist", HttpMethod.GET,
                new HttpEntity<>(alice), String.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("Forms endpoints are hidden from users outside the project")
    void hidesFormsFromNonMembers() {
        createForm("loan-approval.json");
        HttpHeaders outsider = new HttpHeaders();
        outsider.set("X-User", "eve");
        outsider.set("X-Groups", "abada-task-user");

        ResponseEntity<String> res = rest.exchange(
                "/v1/projects/" + projectId + "/forms/loan-approval", HttpMethod.GET,
                new HttpEntity<>(outsider), String.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("Form resource content type is JSON")
    void formContentTypeIsJson() {
        createForm("loan-approval.json");
        ResponseEntity<ProjectResourceContentDTO> res = rest.exchange(
                "/v1/projects/" + projectId + "/forms/loan-approval", HttpMethod.GET,
                new HttpEntity<>(alice), new ParameterizedTypeReference<>() {});
        assertThat(res.getBody().contentType()).contains("json");
    }
}
