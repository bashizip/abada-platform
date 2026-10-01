package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ExternalTaskCommandService;
import com.abada.engine.dto.ExternalTaskFailureDto;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.JobErrorDTO;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.util.BpmnTestUtils;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.InputStream;
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
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

/** Error details of a failed external task, shown in Studio's error dialog. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class ProjectJobErrorTest {
    @Autowired private TestRestTemplate rest;
    @Autowired private AbadaEngine engine;
    @Autowired private ExternalTaskCommandService commands;
    @Autowired private DatabaseTestHelper databaseTestHelper;

    private HttpHeaders alice;
    private String projectId;

    @BeforeEach
    void setUp() throws Exception {
        databaseTestHelper.cleanup();
        engine.clearMemory();
        alice = headers("alice");
        ResponseEntity<Map<String, Object>> created = rest.exchange("/v1/projects", HttpMethod.POST,
                new HttpEntity<>(Map.of("slug", "error-details", "name", "Error details", "description", ""), alice),
                new ParameterizedTypeReference<>() {});
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.OK);
        projectId = (String) created.getBody().get("id");
        try (InputStream bpmn = BpmnTestUtils.loadBpmnStream("external-task-test.bpmn")) {
            engine.deploy(projectId, bpmn);
        }
    }

    @Test
    void returnsTheMessageAndStackTraceWhileTheJobIsStillRetrying() {
        String jobId = failOnce(2, "Temporary outage",
                "java.net.ConnectException: Connection refused\n\tat io.abada.agent.X.call(X.java:1)");

        JobErrorDTO error = error(alice, jobId).getBody();

        assertThat(error.jobId()).isEqualTo(jobId);
        assertThat(error.errorMessage()).isEqualTo("Temporary outage");
        assertThat(error.errorDetails()).contains("ConnectException").contains("\tat ");
        assertThat(error.retries()).isEqualTo(2);
        assertThat(error.status()).isNotEqualTo("FAILED");
    }

    @Test
    void anExhaustedJobKeepsItsLastError() {
        String jobId = failOnce(0, "Gave up", "trace");

        JobErrorDTO error = error(alice, jobId).getBody();

        assertThat(error.status()).isEqualTo("FAILED");
        assertThat(error.errorDetails()).isEqualTo("trace");
    }

    @Test
    void isHiddenFromNonMembers() {
        String jobId = failOnce(1, "Secret-ish", "trace");

        assertThat(error(headers("mallory"), jobId).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(error(alice, "missing-job").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    private String failOnce(int retries, String message, String details) {
        engine.startProcess(projectId, "ExternalTaskTestProcess", "alice", Map.of());
        List<LockedExternalTask> locked = commands.fetchAndLock(
                new FetchAndLockRequest("worker-1", List.of("test-topic"), 10_000L));
        String jobId = locked.get(0).id();
        commands.handleFailure(jobId, new ExternalTaskFailureDto("worker-1", message, details, retries, 60_000L));
        return jobId;
    }

    private ResponseEntity<JobErrorDTO> error(HttpHeaders headers, String jobId) {
        return rest.exchange("/v1/projects/{projectId}/jobs/{jobId}/error", HttpMethod.GET,
                new HttpEntity<>(headers), JobErrorDTO.class, projectId, jobId);
    }

    private static HttpHeaders headers(String user) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-User", user);
        headers.set("X-Groups", "customers");
        return headers;
    }
}
