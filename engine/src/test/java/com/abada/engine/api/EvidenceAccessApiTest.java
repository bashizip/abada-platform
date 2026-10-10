package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.core.agent.AgentStepService;
import com.abada.engine.dto.AgentStepRequest;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.repository.ActivityHistoryRepository;
import com.abada.engine.util.DatabaseTestHelper;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
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
 * Who sees what of agent evidence: project members read step summaries;
 * payloads need the evidence-reader role and project membership (admins are
 * not exempt), and every payload read is recorded.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = AbadaEngineApplication.class,
        properties = {"abada.insight.llm.base-url=http://llm.test.invalid/v1", "abada.insight.llm.api-key=test-key"})
@ActiveProfiles("test")
class EvidenceAccessApiTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired private TestRestTemplate rest;
    @Autowired private AbadaEngine engine;
    @Autowired private ExternalTaskCommandService workers;
    @Autowired private AgentStepService steps;
    @Autowired private ActivityHistoryRepository history;
    @Autowired private DatabaseTestHelper database;

    private String projectId;
    private String instanceId;
    private String stepId;

    @BeforeEach
    void recordAStep() throws Exception {
        database.cleanup();
        engine.clearMemory();
        ResponseEntity<Map<String, Object>> created = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "evidence", "name", "Evidence", "description", ""),
                        headers("alice", "customers")), new ParameterizedTypeReference<>() {});
        projectId = (String) created.getBody().get("id");
        engine.deploy(projectId, new ByteArrayInputStream("""
                version: abada.io/v1
                metadata: { key: evidence_case, name: Evidence case }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: triage }
                    - { id: triage, type: agent, model: gemini-3.6-flash, prompt: Triage, next: done }
                    - { id: done, type: end }
                """.getBytes(StandardCharsets.UTF_8)));
        instanceId = engine.startProcess(projectId, "evidence_case", "alice", Map.of()).getId();
        LockedExternalTask task = workers.fetchAndLock(new FetchAndLockRequest("w", List.of("abada:agent"), 60_000L))
                .getFirst();
        steps.record(task.id(), new AgentStepRequest("w", 1, 1, "MODEL_CALL", "COMPLETED", null,
                JSON.readTree("{\"messages\":1}"), JSON.readTree("{\"verdict\":\"refund\"}"), null,
                "gemini-3.6-flash", "p1", 100, 50));
        ResponseEntity<List<Map<String, Object>>> listed = rest.exchange(stepsUrl(), HttpMethod.GET,
                new HttpEntity<>(headers("alice", "customers")), new ParameterizedTypeReference<>() {});
        assertThat(listed.getStatusCode()).isEqualTo(HttpStatus.OK);
        stepId = (String) listed.getBody().getFirst().get("id");
    }

    @Test
    void membersSeeSummariesWithoutPayloads() {
        ResponseEntity<String> listed = rest.exchange(stepsUrl(), HttpMethod.GET,
                new HttpEntity<>(headers("alice", "customers")), String.class);
        assertThat(listed.getBody()).contains("\"requestDigest\"", "\"promptTokens\":100", "\"payloadMode\":\"redacted\"")
                .doesNotContain("refund");
        assertThat(rest.exchange(stepsUrl(), HttpMethod.GET, new HttpEntity<>(headers("mallory", "customers")),
                String.class).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void payloadsNeedTheEvidenceRoleAndMembershipAndEveryReadIsRecorded() {
        assertThat(payloads("alice", "customers").getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(payloads("root", "abada-admin").getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(payloads("mallory", "abada-evidence-reader").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(history.findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                .noneMatch(event -> event.getEventType().equals("EVIDENCE_READ"));

        ResponseEntity<String> read = payloads("alice", "abada-evidence-reader");
        assertThat(read.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(read.getBody()).contains("refund");
        assertThat(read.getHeaders().getCacheControl()).contains("no-store");
        assertThat(history.findByProcessInstanceIdOrderByOccurredAtAsc(instanceId))
                .filteredOn(event -> event.getEventType().equals("EVIDENCE_READ")).singleElement()
                .satisfies(event -> {
                    assertThat(event.getActor()).isEqualTo("alice");
                    assertThat(event.getDetailsJson()).contains(stepId).doesNotContain("refund");
                });
    }

    @Test
    void onlyOwnersChangeTheEvidencePolicy() {
        HttpHeaders owner = headers("alice", "customers");
        owner.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<String> changed = rest.exchange("/v1/projects/" + projectId + "/evidence-policy", HttpMethod.PUT,
                new HttpEntity<>(Map.of("payloads", "none", "retentionDays", 7), owner), String.class);
        assertThat(changed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(changed.getBody()).contains("\"payloads\":\"none\"", "\"retentionDays\":7");

        HttpHeaders stranger = headers("mallory", "customers");
        stranger.setContentType(MediaType.APPLICATION_JSON);
        assertThat(rest.exchange("/v1/projects/" + projectId + "/evidence-policy", HttpMethod.PUT,
                new HttpEntity<>(Map.of("payloads", "full", "retentionDays", 365), stranger), String.class)
                .getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(rest.exchange("/v1/projects/" + projectId + "/evidence-policy", HttpMethod.PUT,
                new HttpEntity<>(Map.of("payloads", "everything", "retentionDays", 7), owner), String.class)
                .getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    private ResponseEntity<String> payloads(String user, String groups) {
        return rest.exchange(stepsUrl() + "/" + stepId + "/payloads", HttpMethod.GET,
                new HttpEntity<>(headers(user, groups)), String.class);
    }

    private String stepsUrl() {
        return "/v1/projects/" + projectId + "/instances/" + instanceId + "/agent-steps";
    }

    private static HttpHeaders headers(String user, String groups) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-User", user);
        headers.set("X-Groups", groups);
        return headers;
    }
}
