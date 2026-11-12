package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
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

/** A malformed variable patch is the client's error (400), never an engine error (500). */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class ProjectVariablePatchApiTest {
    @Autowired private TestRestTemplate rest;
    @Autowired private AbadaEngine engine;
    @Autowired private DatabaseTestHelper database;

    private String projectId;
    private String instanceId;

    @BeforeEach
    void startAnInstance() {
        database.cleanup();
        engine.clearMemory();
        ResponseEntity<Map<String, Object>> created = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "variable-patch", "name", "Variable patch", "description", ""),
                        headers("alice")), new ParameterizedTypeReference<>() {});
        projectId = (String) created.getBody().get("id");
        engine.deploy(projectId, new ByteArrayInputStream("""
                version: abada.io/v1
                metadata: { key: charge, name: Charge }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: charge }
                    - { id: charge, type: engine-task, service: charge-card, next: done }
                    - { id: done, type: end }
                """.getBytes(StandardCharsets.UTF_8)));
        instanceId = engine.startProcess(projectId, "charge", "alice", Map.of("card_ok", false)).getId();
    }

    @Test
    void anOperatorSetsAVariable() {
        assertThat(patch("alice", "{\"modifications\": {\"card_ok\": {\"value\": true}}}").getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(engine.getProcessInstanceById(instanceId).getVariables()).containsEntry("card_ok", true);
    }

    @Test
    void aBodyWithoutModificationsIsABadRequest() {
        for (String body : new String[] {"{}", "{\"variables\": {\"card_ok\": true}}", "{\"modifications\": {}}"}) {
            ResponseEntity<String> rejected = patch("alice", body);
            assertThat(rejected.getStatusCode()).as(body).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(rejected.getBody()).as(body).contains("INVALID_REQUEST").contains("modifications");
        }
        assertThat(engine.getProcessInstanceById(instanceId).getVariables()).containsEntry("card_ok", false);
    }

    @Test
    void aVariableWithoutAValueIsABadRequest() {
        for (String body : new String[] {"{\"modifications\": {\"card_ok\": null}}",
                "{\"modifications\": {\"card_ok\": {\"value\": null}}}", "{\"modifications\": {\"card_ok\": {}}}"}) {
            ResponseEntity<String> rejected = patch("alice", body);
            assertThat(rejected.getStatusCode()).as(body).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(rejected.getBody()).as(body).contains("card_ok");
        }
        assertThat(engine.getProcessInstanceById(instanceId).getVariables()).containsEntry("card_ok", false);
    }

    @Test
    void aMissingBodyIsABadRequest() {
        HttpHeaders headers = headers("alice");
        ResponseEntity<String> rejected = rest.exchange("/v1/projects/{projectId}/instances/{instanceId}/variables",
                HttpMethod.PATCH, new HttpEntity<>(headers), String.class, projectId, instanceId);
        assertThat(rejected.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void nonMembersStillLearnNothing() {
        assertThat(patch("mallory", "{}").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    private ResponseEntity<String> patch(String user, String body) {
        HttpHeaders headers = headers(user);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return rest.exchange("/v1/projects/{projectId}/instances/{instanceId}/variables", HttpMethod.PATCH,
                new HttpEntity<>(body, headers), String.class, projectId, instanceId);
    }

    private static HttpHeaders headers(String user) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-User", user);
        headers.set("X-Groups", "customers");
        return headers;
    }
}
