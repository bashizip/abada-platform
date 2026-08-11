package com.abada.engine.api;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.ProcessInstance;
import com.abada.engine.dto.ExternalTaskFailureDto;
import com.abada.engine.dto.ErrorResponse;
import com.abada.engine.dto.FailedJobDTO;
import com.abada.engine.dto.FetchAndLockRequest;
import com.abada.engine.dto.LockedExternalTask;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.util.BpmnTestUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.*;
import org.springframework.test.context.ActiveProfiles;

import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
public class ExternalTaskTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private AbadaEngine abadaEngine;
    @Autowired private com.abada.engine.util.DatabaseTestHelper databaseTestHelper;

    @Autowired
    private ExternalTaskRepository externalTaskRepository;

    private HttpHeaders headers;

    @BeforeEach
    void setUp() throws Exception {
        databaseTestHelper.cleanup();
        abadaEngine.clearMemory();
        externalTaskRepository.deleteAll();
        headers = new HttpHeaders();
        headers.set("X-User", "test-user");
        headers.set("X-Groups", "test-group");

        try (InputStream bpmnStream = BpmnTestUtils.loadBpmnStream("external-task-test.bpmn")) {
            abadaEngine.deploy(bpmnStream);
        }
    }

    @Test
    @DisplayName("External worker should fetch, lock, and complete an external task")
    void shouldCreateAndCompleteExternalTaskViaApi() {
        // 1. Start the process
        ProcessInstance pi = abadaEngine.startProcess("ExternalTaskTestProcess");

        // 2. Assert that the process is waiting at the service task and a job was
        // created
        assertEquals("ServiceTask_External", pi.getActiveTokens().get(0));
        assertEquals(1, externalTaskRepository.count());

        // 3. Simulate a worker fetching and locking the task
        FetchAndLockRequest fetchRequest = new FetchAndLockRequest("worker-1", List.of("test-topic"), 10000L);
        HttpEntity<FetchAndLockRequest> requestEntity = new HttpEntity<>(fetchRequest, headers);
        ResponseEntity<List<LockedExternalTask>> lockResponse = restTemplate.exchange(
                "/v1/external-tasks/fetch-and-lock",
                HttpMethod.POST,
                requestEntity,
                new ParameterizedTypeReference<>() {
                });

        assertEquals(HttpStatus.OK, lockResponse.getStatusCode());
        List<LockedExternalTask> lockedTasks = lockResponse.getBody();
        assertNotNull(lockedTasks);
        assertEquals(1, lockedTasks.size());
        LockedExternalTask lockedTask = lockedTasks.get(0);
        assertEquals("test-topic", lockedTask.topicName());

        // 4. Simulate the worker completing the task
        Map<String, Object> outputVariables = Map.of("externalTaskResult", "SUCCESS");
        HttpEntity<Map<String, Object>> completeRequestEntity = new HttpEntity<>(outputVariables, headers);
        restTemplate.postForEntity("/v1/external-tasks/{id}/complete", completeRequestEntity, Void.class,
                lockedTask.id());

        // 5. Assert that the process has resumed and moved to the final user task
        ProcessInstance resumedPi = abadaEngine.getProcessInstanceById(pi.getId());
        assertEquals("FinalTask", resumedPi.getActiveTokens().get(0));
        assertEquals("SUCCESS", resumedPi.getVariable("externalTaskResult"));

        // 6. Durable work records remain available for audit and replay handling.
        assertEquals(ExternalTaskEntity.Status.COMPLETED,
                externalTaskRepository.findById(lockedTask.id()).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("Worker protocol v1 deserializes the optional agent block from the HTTP body")
    void shouldPersistAgentAttemptMetadataFromWireFormat() {
        abadaEngine.startProcess("ExternalTaskTestProcess");
        LockedExternalTask locked = fetch("worker-1");

        HttpEntity<Map<String, Object>> complete = new HttpEntity<>(Map.of(
                "workerId", "worker-1",
                "variables", Map.of("externalTaskResult", "SUCCESS"),
                "agent", Map.of(
                        "model", "gemini-2.0-flash",
                        "provider", "google-gemini",
                        "attempt", 1,
                        "durationMs", 500L,
                        "tools", List.of("crm.read"),
                        "resultVariable", "externalTaskResult",
                        "promptHash", "a1b2c3d4e5f6a7b8")), headers);
        restTemplate.postForEntity("/v1/external-tasks/{id}/complete", complete, Void.class, locked.id());

        ExternalTaskEntity task = externalTaskRepository.findById(locked.id()).orElseThrow();
        assertNotNull(task.getAgentMetadataJson());
        assertTrue(task.getAgentMetadataJson().contains("\"model\":\"gemini-2.0-flash\""));
        assertTrue(task.getAgentMetadataJson().contains("\"provider\":\"google-gemini\""));
        assertTrue(task.getAgentMetadataJson().contains("\"attempt\":1"));
        assertTrue(task.getAgentMetadataJson().contains("\"tools\":[\"crm.read\"]"));
    }

    @Test
    @DisplayName("External worker should report failure and job should appear in failed jobs list")
    void shouldHandleExternalTaskFailure() {
        // 1. Start the process
        ProcessInstance pi = abadaEngine.startProcess("ExternalTaskTestProcess");

        // 2. Fetch and lock
        FetchAndLockRequest fetchRequest = new FetchAndLockRequest("worker-1", List.of("test-topic"), 10000L);
        HttpEntity<FetchAndLockRequest> requestEntity = new HttpEntity<>(fetchRequest, headers);
        ResponseEntity<List<LockedExternalTask>> lockResponse = restTemplate.exchange(
                "/v1/external-tasks/fetch-and-lock",
                HttpMethod.POST,
                requestEntity,
                new ParameterizedTypeReference<>() {
                });
        LockedExternalTask lockedTask = lockResponse.getBody().get(0);

        // 3. Report failure
        ExternalTaskFailureDto failureDto = new ExternalTaskFailureDto(
                "worker-1",
                "Something went wrong",
                "Stack trace details...",
                0,
                1000L);
        HttpEntity<ExternalTaskFailureDto> failureRequestEntity = new HttpEntity<>(failureDto, headers);
        restTemplate.postForEntity("/v1/external-tasks/{id}/failure", failureRequestEntity, Void.class,
                lockedTask.id());

        // 4. Verify task is FAILED in DB
        ExternalTaskEntity task = externalTaskRepository.findById(lockedTask.id()).orElseThrow();
        assertEquals(ExternalTaskEntity.Status.FAILED, task.getStatus());
        assertEquals("Something went wrong", task.getExceptionMessage());
        assertEquals(0, task.getRetries());

        // 5. Verify it appears in failed jobs list
        ResponseEntity<List<FailedJobDTO>> failedJobsResponse = restTemplate.exchange(
                "/v1/jobs",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                new ParameterizedTypeReference<>() {
                });

        List<FailedJobDTO> failedJobs = failedJobsResponse.getBody();
        assertNotNull(failedJobs);
        assertEquals(1, failedJobs.size());
        assertEquals(lockedTask.id(), failedJobs.get(0).jobId());
        assertEquals("Something went wrong", failedJobs.get(0).exceptionMessage());
    }

    @Test
    @DisplayName("Worker protocol v1 enforces lock ownership and supports heartbeat")
    void shouldEnforceWorkerOwnershipAndHeartbeat() {
        abadaEngine.startProcess("ExternalTaskTestProcess");
        LockedExternalTask locked = fetch("worker-1");
        Instant originalExpiry = externalTaskRepository.findById(locked.id()).orElseThrow().getLockExpirationTime();

        ResponseEntity<Void> heartbeat = restTemplate.postForEntity(
                "/v1/external-tasks/{id}/heartbeat",
                new HttpEntity<>(Map.of("workerId", "worker-1", "lockDuration", 20000), headers),
                Void.class, locked.id());
        assertEquals(HttpStatus.NO_CONTENT, heartbeat.getStatusCode());
        assertTrue(externalTaskRepository.findById(locked.id()).orElseThrow().getLockExpirationTime()
                .isAfter(originalExpiry));

        ResponseEntity<ErrorResponse> rejected = restTemplate.exchange(
                "/v1/external-tasks/{id}/complete", HttpMethod.POST,
                new HttpEntity<>(Map.of("workerId", "worker-2", "variables", Map.of()), headers),
                ErrorResponse.class, locked.id());
        assertEquals(HttpStatus.FORBIDDEN, rejected.getStatusCode());
        assertEquals("WORKER_LOCK_NOT_OWNED", rejected.getBody().code());

        ExternalTaskEntity expired = externalTaskRepository.findById(locked.id()).orElseThrow();
        expired.setLockExpirationTime(Instant.now().minusSeconds(1));
        externalTaskRepository.saveAndFlush(expired);
        ResponseEntity<ErrorResponse> expiredResponse = restTemplate.exchange(
                "/v1/external-tasks/{id}/complete", HttpMethod.POST,
                new HttpEntity<>(Map.of("workerId", "worker-1", "variables", Map.of()), headers),
                ErrorResponse.class, locked.id());
        assertEquals(HttpStatus.CONFLICT, expiredResponse.getStatusCode());
        assertEquals("WORKER_LOCK_EXPIRED", expiredResponse.getBody().code());
    }

    @Test
    @DisplayName("Worker protocol v1 records an unhandled BPMN error atomically")
    void shouldHandleBpmnError() {
        ProcessInstance instance = abadaEngine.startProcess("ExternalTaskTestProcess");
        LockedExternalTask locked = fetch("worker-1");

        ResponseEntity<Void> response = restTemplate.postForEntity(
                "/v1/external-tasks/{id}/bpmn-error",
                new HttpEntity<>(Map.of("workerId", "worker-1", "errorCode", "PAYMENT_DECLINED",
                        "errorMessage", "The payment provider declined the charge",
                        "variables", Map.of("declined", true)), headers),
                Void.class, locked.id());

        assertEquals(HttpStatus.NO_CONTENT, response.getStatusCode());
        ExternalTaskEntity failed = externalTaskRepository.findById(locked.id()).orElseThrow();
        assertEquals(ExternalTaskEntity.Status.BPMN_ERROR, failed.getStatus());
        assertEquals("PAYMENT_DECLINED", failed.getBpmnErrorCode());
        assertEquals(com.abada.engine.core.model.ProcessStatus.FAILED,
                abadaEngine.getProcessInstanceById(instance.getId()).getStatus());
    }

    @Test
    @DisplayName("Fetch-and-lock returns bounded batches with protocol metadata")
    void shouldFetchBoundedBatch() {
        abadaEngine.startProcess("ExternalTaskTestProcess");
        abadaEngine.startProcess("ExternalTaskTestProcess");
        FetchAndLockRequest fetchRequest = new FetchAndLockRequest("worker-1", List.of("test-topic"), 10000L, 2);
        ResponseEntity<List<LockedExternalTask>> response = restTemplate.exchange(
                "/v1/external-tasks/fetch-and-lock", HttpMethod.POST,
                new HttpEntity<>(fetchRequest, headers), new ParameterizedTypeReference<>() {});

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("1", response.getHeaders().getFirst("X-Abada-Worker-Protocol-Version"));
        assertEquals(2, response.getBody().size());
        assertTrue(response.getBody().stream().allMatch(task -> "1".equals(task.protocolVersion())));
        assertTrue(response.getBody().stream().allMatch(task -> task.lockExpirationTime() != null));
    }

    private LockedExternalTask fetch(String workerId) {
        FetchAndLockRequest fetchRequest = new FetchAndLockRequest(workerId, List.of("test-topic"), 10000L);
        ResponseEntity<List<LockedExternalTask>> response = restTemplate.exchange(
                "/v1/external-tasks/fetch-and-lock", HttpMethod.POST,
                new HttpEntity<>(fetchRequest, headers), new ParameterizedTypeReference<>() {});
        return response.getBody().getFirst();
    }
}
