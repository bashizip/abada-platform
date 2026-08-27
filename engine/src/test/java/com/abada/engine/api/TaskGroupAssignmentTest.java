package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.dto.TaskActionResponse;
import com.abada.engine.dto.TaskDetailsDto;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.project.ProjectService;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.abada.engine.util.BpmnTestUtils;
import com.abada.engine.util.DatabaseTestHelper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
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
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class TaskGroupAssignmentTest {

    @Autowired private TestRestTemplate rest;
    @Autowired private com.abada.engine.core.AbadaEngine engine;
    @Autowired private DatabaseTestHelper databaseTestHelper;
    @Autowired private ProjectService projectService;
    @Autowired private PrincipalRepository principals;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private TransactionTemplate tx;

    private String projectId;
    private HttpHeaders alice;

    @BeforeEach
    void setUp() throws Exception {
        databaseTestHelper.cleanup();
        engine.clearMemory();

        alice = new HttpHeaders();
        alice.set("X-User", "alice");
        alice.set("X-Groups", "abada-task-user");

        ResponseEntity<Map<String, Object>> created = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "task-group-demo", "name", "Task Group Demo",
                        "description", ""), alice),
                new ParameterizedTypeReference<>() {});
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.OK);
        projectId = (String) created.getBody().get("id");

        try (InputStream bpmn = BpmnTestUtils.loadBpmnStream("recipe-cook.bpmn")) {
            engine.deploy(projectId, bpmn);
        }
    }

    @Test
    @DisplayName("Member with task group claims and completes a task without matching identity groups")
    void memberWithTaskGroupCanClaimAndComplete() throws Exception {
        addMember("bob", Set.of("VIEWER"), Set.of("customers"));
        engine.startProcess(projectId, "recipe-cook", "alice", Map.of());

        HttpHeaders bob = new HttpHeaders();
        bob.set("X-User", "bob");
        bob.set("X-Groups", "abada-task-user");

        ResponseEntity<String> rawList = rest.exchange(
                "/v1/projects/" + projectId + "/tasks", HttpMethod.GET,
                new HttpEntity<>(bob), String.class);
        assertThat(rawList.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<TaskDetailsDto> tasks = objectMapper.readValue(rawList.getBody(),
                new TypeReference<>() {});
        assertThat(tasks).hasSize(1);
        TaskDetailsDto task = tasks.get(0);

        ResponseEntity<String> claimedRaw = rest.exchange(
                "/v1/projects/" + projectId + "/tasks/" + task.id() + "/claim",
                HttpMethod.POST, new HttpEntity<>(Map.of(), bob), String.class);
        assertThat(claimedRaw.getStatusCode()).isEqualTo(HttpStatus.OK);
        TaskActionResponse claimed = objectMapper.readValue(claimedRaw.getBody(),
                TaskActionResponse.class);
        assertThat(claimed.status()).isEqualTo("Claimed");

        ResponseEntity<String> completedRaw = rest.exchange(
                "/v1/projects/" + projectId + "/tasks/" + task.id() + "/complete",
                HttpMethod.POST, new HttpEntity<>(Map.of("goodOne", true), bob), String.class);
        assertThat(completedRaw.getStatusCode()).isEqualTo(HttpStatus.OK);
        TaskActionResponse completed = objectMapper.readValue(completedRaw.getBody(),
                TaskActionResponse.class);
        assertThat(completed.status()).isEqualTo("Completed");
    }

    @Test
    @DisplayName("Member without task group cannot see tasks requiring that group")
    void memberWithoutTaskGroupIsRejected() throws Exception {
        addMember("eve", Set.of("VIEWER"), Set.of());
        engine.startProcess(projectId, "recipe-cook", "alice", Map.of());

        HttpHeaders eve = new HttpHeaders();
        eve.set("X-User", "eve");
        eve.set("X-Groups", "abada-task-user");

        ResponseEntity<String> rawList = rest.exchange(
                "/v1/projects/" + projectId + "/tasks", HttpMethod.GET,
                new HttpEntity<>(eve), String.class);
        assertThat(rawList.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<TaskDetailsDto> tasks = objectMapper.readValue(rawList.getBody(),
                new TypeReference<>() {});
        assertThat(tasks).isEmpty();
    }

    @Test
    @DisplayName("Review lanes do NOT grant task access")
    void reviewLanesDoNotGrantTaskAccess() throws Exception {
        addMemberWithReviewLanes("carol", Set.of("VIEWER", "REVIEWER"), Set.of("customers"));
        engine.startProcess(projectId, "recipe-cook", "alice", Map.of());

        HttpHeaders carol = new HttpHeaders();
        carol.set("X-User", "carol");
        carol.set("X-Groups", "abada-task-user");

        ResponseEntity<String> rawList = rest.exchange(
                "/v1/projects/" + projectId + "/tasks", HttpMethod.GET,
                new HttpEntity<>(carol), String.class);
        assertThat(rawList.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<TaskDetailsDto> tasks = objectMapper.readValue(rawList.getBody(),
                new TypeReference<>() {});
        assertThat(tasks).isEmpty();
    }

    @Test
    @DisplayName("Cross-project inbox applies member task groups per project")
    void crossProjectInboxAppliesTaskGroupsPerProject() throws Exception {
        // bob's identity groups do not include "customers"; he holds it only
        // as a project-scoped task group in this project.
        addMember("bob", Set.of("VIEWER"), Set.of("customers"));
        engine.startProcess(projectId, "recipe-cook", "alice", Map.of());

        // A second project where bob has no membership, running a task with
        // the same candidate group. His task group must not leak across.
        ResponseEntity<Map<String, Object>> other = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "task-group-other", "name", "Other",
                        "description", ""), alice),
                new ParameterizedTypeReference<>() {});
        assertThat(other.getStatusCode()).isEqualTo(HttpStatus.OK);
        String otherProjectId = (String) other.getBody().get("id");
        try (InputStream bpmn = BpmnTestUtils.loadBpmnStream("recipe-cook.bpmn")) {
            engine.deploy(otherProjectId, bpmn);
        }
        engine.startProcess(otherProjectId, "recipe-cook", "alice", Map.of());

        HttpHeaders bob = new HttpHeaders();
        bob.set("X-User", "bob");
        bob.set("X-Groups", "abada-task-user");

        ResponseEntity<String> mineRaw = rest.exchange("/v1/tasks/mine", HttpMethod.GET,
                new HttpEntity<>(bob), String.class);
        assertThat(mineRaw.getStatusCode()).isEqualTo(HttpStatus.OK);
        List<TaskDetailsDto> mine = objectMapper.readValue(mineRaw.getBody(),
                new TypeReference<>() {});
        assertThat(mine).hasSize(1);
        assertThat(mine.get(0).projectId()).isEqualTo(projectId);
    }

    private void ensurePrincipal(String username, String displayName) {
        tx.executeWithoutResult(s -> {
            principals.findAll().stream()
                    .filter(p -> username.equals(p.getUsername()))
                    .findFirst()
                    .orElseGet(() -> {
                        PrincipalEntity p = new PrincipalEntity();
                        p.setIssuer("test");
                        p.setSubjectId(username + "-subject");
                        p.setUsername(username);
                        p.setFirstSeenAt(Instant.now());
                        p.setLastSeenAt(Instant.now());
                        return principals.save(p);
                    });
        });
    }

    private void addMember(String username, Set<String> roles, Set<String> taskGroups) {
        // Trigger principal creation via REST interceptor (issuer="local-disabled").
        HttpHeaders userHeaders = new HttpHeaders();
        userHeaders.set("X-User", username);
        userHeaders.set("X-Groups", "abada-task-user");
        rest.exchange("/v1/projects/" + projectId + "/tasks", HttpMethod.GET,
                new HttpEntity<>(userHeaders), String.class);

        PrincipalEntity principal = principals.findAll().stream()
                .filter(p -> username.equals(p.getUsername()))
                .findFirst().orElseThrow();

        IdentityContext.set(new Identity("admin", "alice", List.of("ABADA_ADMIN")));
        var roleSet = roles.stream()
                .map(ProjectMemberEntity.Role::valueOf)
                .collect(Collectors.toSet());
        projectService.putMember(projectId, principal.getId(), null, roleSet, Set.of(), taskGroups);
        IdentityContext.clear();
    }

    private void addMemberWithReviewLanes(String username, Set<String> roles, Set<String> reviewLanes) {
        HttpHeaders userHeaders = new HttpHeaders();
        userHeaders.set("X-User", username);
        userHeaders.set("X-Groups", "abada-task-user");
        rest.exchange("/v1/projects/" + projectId + "/tasks", HttpMethod.GET,
                new HttpEntity<>(userHeaders), String.class);

        PrincipalEntity principal = principals.findAll().stream()
                .filter(p -> username.equals(p.getUsername()))
                .findFirst().orElseThrow();

        IdentityContext.set(new Identity("admin", "alice", List.of("ABADA_ADMIN")));
        var roleSet = roles.stream()
                .map(ProjectMemberEntity.Role::valueOf)
                .collect(Collectors.toSet());
        projectService.putMember(projectId, principal.getId(), null, roleSet, reviewLanes, Set.of());
        IdentityContext.clear();
    }
}
