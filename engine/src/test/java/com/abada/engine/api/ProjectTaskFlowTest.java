package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.model.TaskStatus;
import com.abada.engine.dto.TaskActionResponse;
import com.abada.engine.dto.TaskDetailsDto;
import com.abada.engine.project.ProjectConstants;
import com.abada.engine.util.BpmnTestUtils;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.InputStream;
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
class ProjectTaskFlowTest {

    @Autowired private TestRestTemplate rest;
    @Autowired private AbadaEngine engine;
    @Autowired private DatabaseTestHelper databaseTestHelper;

    private HttpHeaders alice;
    private String projectId;

    @BeforeEach
    void setUp() throws Exception {
        databaseTestHelper.cleanup();
        engine.clearMemory();
        alice = new HttpHeaders();
        alice.set("X-User", "alice");
        alice.set("X-Groups", "customers");

        ResponseEntity<Map<String, Object>> created = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "human-demo", "name", "Human Demo", "description", ""), alice),
                new ParameterizedTypeReference<>() {});
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.OK);
        projectId = (String) created.getBody().get("id");

        try (InputStream bpmn = BpmnTestUtils.loadBpmnStream("recipe-cook.bpmn")) {
            engine.deploy(projectId, bpmn);
        }
    }

    @Test
    @DisplayName("Project task carries the BPMN formKey and completes the lifecycle")
    void projectTaskLifecycleCarriesFormKey() {
        engine.startProcess(projectId, "recipe-cook", "alice", Map.of());

        ResponseEntity<List<TaskDetailsDto>> list = rest.exchange(
                "/v1/projects/" + projectId + "/tasks", HttpMethod.GET,
                new HttpEntity<>(alice), new ParameterizedTypeReference<>() {});
        assertThat(list.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(list.getBody()).hasSize(1);
        TaskDetailsDto task = list.getBody().get(0);
        assertThat(task.formKey()).isEqualTo("fk_choose_recipe");
        assertThat(task.projectId()).isEqualTo(projectId);
        assertThat(task.taskDefinitionKey()).isEqualTo("choose-recipe");
        assertThat(task.status()).isEqualTo(TaskStatus.AVAILABLE);

        // Detail
        ResponseEntity<TaskDetailsDto> detail = rest.exchange(
                "/v1/projects/" + projectId + "/tasks/" + task.id(), HttpMethod.GET,
                new HttpEntity<>(alice), new ParameterizedTypeReference<>() {});
        assertThat(detail.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(detail.getBody().formKey()).isEqualTo("fk_choose_recipe");

        // Claim → unclaim → claim → complete
        assertClaim(task.id(), "Claimed");
        assertAction(task.id(), "/unclaim", "Unclaimed");
        assertClaim(task.id(), "Claimed");

        ResponseEntity<TaskActionResponse> completed = rest.exchange(
                "/v1/projects/" + projectId + "/tasks/" + task.id() + "/complete",
                HttpMethod.POST, new HttpEntity<>(Map.of("goodOne", true), alice),
                TaskActionResponse.class);
        assertThat(completed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(completed.getBody().status()).isEqualTo("Completed");
    }

    @Test
    @DisplayName("Project claim rejects a user outside the candidate groups")
    void claimRejectsIneligibleUser() {
        engine.startProcess(projectId, "recipe-cook", "bob", Map.of());
        ResponseEntity<List<TaskDetailsDto>> list = rest.exchange(
                "/v1/projects/" + projectId + "/tasks", HttpMethod.GET,
                new HttpEntity<>(alice), new ParameterizedTypeReference<>() {});
        TaskDetailsDto task = list.getBody().get(0);

        HttpHeaders eve = new HttpHeaders();
        eve.set("X-User", "eve");
        eve.set("X-Groups", "nothing");
        ResponseEntity<String> res = rest.exchange(
                "/v1/projects/" + projectId + "/tasks/" + task.id() + "/claim",
                HttpMethod.POST, new HttpEntity<>(eve), String.class);
        // eve is not a member of the project and not an eligible candidate, so
        // the claim must be rejected.
        assertThat(res.getStatusCode()).isNotEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("Tasks fail via the project-scoped endpoint")
    void failTaskProjectScoped() {
        engine.startProcess(projectId, "recipe-cook", "alice", Map.of());
        ResponseEntity<List<TaskDetailsDto>> list = rest.exchange(
                "/v1/projects/" + projectId + "/tasks", HttpMethod.GET,
                new HttpEntity<>(alice), new ParameterizedTypeReference<>() {});
        TaskDetailsDto task = list.getBody().get(0);

        ResponseEntity<TaskActionResponse> res = rest.exchange(
                "/v1/projects/" + projectId + "/tasks/" + task.id() + "/fail",
                HttpMethod.POST, new HttpEntity<>(alice), TaskActionResponse.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(res.getBody().status()).isEqualTo("Failed");
    }

    @Test
    @DisplayName("Cross-project inbox lists visible tasks across projects with their projectId")
    void mineListsTasksAcrossProjects() throws Exception {
        // Deploy to the Default project and start there too.
        try (InputStream bpmn = BpmnTestUtils.loadBpmnStream("recipe-cook.bpmn")) {
            engine.deploy(bpmn);
        }
        engine.startProcess("recipe-cook");
        engine.startProcess(projectId, "recipe-cook", "alice", Map.of());

        ResponseEntity<List<TaskDetailsDto>> mine = rest.exchange(
                "/v1/tasks/mine", HttpMethod.GET, new HttpEntity<>(alice),
                new ParameterizedTypeReference<>() {});
        assertThat(mine.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(mine.getBody()).isNotNull().hasSize(2);
        assertThat(mine.getBody()).extracting(TaskDetailsDto::projectId)
                .contains(projectId, ProjectConstants.DEFAULT_PROJECT_ID);
        assertThat(mine.getBody()).allMatch(t -> t.formKey() != null);
    }

    private void assertClaim(String taskId, String expected) {
        ResponseEntity<TaskActionResponse> res = rest.exchange(
                "/v1/projects/" + projectId + "/tasks/" + taskId + "/claim",
                HttpMethod.POST, new HttpEntity<>(alice), TaskActionResponse.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(res.getBody().status()).isEqualTo(expected);
    }

    private void assertAction(String taskId, String action, String expected) {
        ResponseEntity<TaskActionResponse> res = rest.exchange(
                "/v1/projects/" + projectId + "/tasks/" + taskId + action,
                HttpMethod.POST, new HttpEntity<>(alice), TaskActionResponse.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(res.getBody().status()).isEqualTo(expected);
    }
}
