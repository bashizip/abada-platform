package com.abada.engine.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.ApiException;
import com.abada.engine.dto.WorkerHealthDTO;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.abada.engine.util.DatabaseTestHelper;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class WorkerHealthServiceTest {
    @Autowired ProjectService projects;
    @Autowired ProjectWorkerService workerBindings;
    @Autowired WorkerHealthService health;
    @Autowired WorkerCapabilityService workerCapabilities;
    @Autowired FirstPartyWorkerCapabilitySweep sweep;
    @Autowired PrincipalRepository principals;
    @Autowired DatabaseTestHelper database;

    private PrincipalEntity owner;
    private PrincipalEntity agent;

    @BeforeEach
    void setUp() {
        database.cleanup();
        owner = principal("owner", "owner-subject");
        agent = principal("service-account-abada-agent-worker", "agent-subject");
        IdentityContext.set(new Identity(owner.getId(), owner.getUsername(), List.of()));
    }

    @AfterEach
    void clearIdentity() { IdentityContext.clear(); }

    private PrincipalEntity principal(String username, String subject) {
        var entity = new PrincipalEntity();
        entity.setIssuer("test");
        entity.setSubjectId(subject);
        entity.setUsername(username);
        entity.setPrincipalType(PrincipalEntity.Type.SERVICE);
        entity.setFirstSeenAt(Instant.now());
        entity.setLastSeenAt(Instant.now());
        return principals.save(entity);
    }

    @Test
    void rejectedFetchForNonFirstPartyWorkerSurfacesAsBoundFalseErrorRow() {
        var project = projects.create("p1", "Project One", "desc");
        PrincipalEntity external = principal("service-account-external-worker", "external-subject");
        health.noteFetchFailure(project.getId(), external.getId(), "external-worker-1",
                List.of("abada:agent"), "Worker is not bound to this project");

        List<WorkerHealthDTO> rows = health.healthForProject(project.getId());
        assertThat(rows).hasSize(1);
        WorkerHealthDTO row = rows.get(0);
        assertThat(row.principalUsername()).isEqualTo("service-account-external-worker");
        assertThat(row.topic()).isEqualTo("abada:agent");
        assertThat(row.bound()).isFalse();
        assertThat(row.status()).isEqualTo("ERROR");
        assertThat(row.lastErrorMessage()).isEqualTo("Worker is not bound to this project");
        assertThat(row.consecutiveFailures()).isEqualTo(1);
        assertThat(row.lastWorkerId()).isEqualTo("external-worker-1");
    }

    @Test
    void firstPartyWorkerWithGlobalCapabilityAndHeartbeatIsOnlineInGlobalHealth() {
        sweep.run(new org.springframework.boot.DefaultApplicationArguments());
        health.noteFetchSuccess(null, agent.getId(), "agent-worker-1",
                List.of("abada:agent"), false);

        List<WorkerHealthDTO> rows = health.globalHealth();
        WorkerHealthDTO row = rows.stream()
                .filter(candidate -> candidate.principalId().equals(agent.getId()))
                .findFirst().orElseThrow();
        assertThat(row.principalUsername()).isEqualTo("service-account-abada-agent-worker");
        assertThat(row.topic()).isEqualTo("abada:agent");
        assertThat(row.projectId()).isNull();
        assertThat(row.bound()).isTrue();
        assertThat(row.status()).isEqualTo("ONLINE");
        assertThat(row.lastSeenAt()).isNotNull();
    }

    @Test
    void globalCapabilityWithoutHeartbeatIsOfflineButBound() {
        sweep.run(new org.springframework.boot.DefaultApplicationArguments());

        List<WorkerHealthDTO> rows = health.globalHealth();
        WorkerHealthDTO row = rows.stream()
                .filter(candidate -> candidate.principalId().equals(agent.getId()))
                .findFirst().orElseThrow();
        assertThat(row.bound()).isTrue();
        assertThat(row.status()).isEqualTo("OFFLINE");
        assertThat(row.lastSeenAt()).isNull();
    }

    @Test
    void selfRegisteredWorkerCanBeRevokedByUnregistering() {
        IdentityContext.set(new Identity(agent.getId(), agent.getUsername(), List.of()));
        workerCapabilities.register(List.of("abada:agent"), List.of());
        assertThat(workerCapabilities.capabilitiesForCurrentWorker()).hasSize(1);

        workerCapabilities.unregister(List.of("abada:agent"));
        assertThat(workerCapabilities.capabilitiesForCurrentWorker()).isEmpty();
        IdentityContext.set(new Identity(owner.getId(), owner.getUsername(), List.of()));
    }

    @Test
    void boundWorkerWithRecentHeartbeatIsOnlineAndFailuresReset() {
        var project = projects.create("p2", "Project Two", "desc");
        workerBindings.put(project.getId(), agent.getId(), List.of("abada:agent"));

        health.noteFetchFailure(project.getId(), agent.getId(), "agent-worker-1",
                List.of("abada:agent"), "requested a topic outside its project binding");
        health.noteFetchSuccess(project.getId(), agent.getId(), "agent-worker-1",
                List.of("abada:agent"), false);

        List<WorkerHealthDTO> rows = health.healthForProject(project.getId());
        assertThat(rows).hasSize(1);
        WorkerHealthDTO row = rows.get(0);
        assertThat(row.bound()).isTrue();
        assertThat(row.status()).isEqualTo("ONLINE");
        assertThat(row.lastErrorMessage()).isNull();
        assertThat(row.consecutiveFailures()).isZero();
        assertThat(row.lastSeenAt()).isNotNull();
    }

    @Test
    void boundWorkerThatNeverPollsIsOfflineNotError() {
        var project = projects.create("p3", "Project Three", "desc");
        workerBindings.put(project.getId(), agent.getId(), List.of("abada:agent"));

        List<WorkerHealthDTO> rows = health.healthForProject(project.getId());
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).status()).isEqualTo("OFFLINE");
        assertThat(rows.get(0).bound()).isTrue();
        assertThat(rows.get(0).lastSeenAt()).isNull();
    }

    @Test
    void everyRejectedFetchBumpsTheConsecutiveFailureCounter() {
        var project = projects.create("p4", "Project Four", "desc");
        for (int attempt = 1; attempt <= 3; attempt++) {
            health.noteFetchFailure(project.getId(), agent.getId(), "agent-worker-1",
                    List.of("abada:agent"), "Worker is not bound to this project");
        }
        List<WorkerHealthDTO> rows = health.healthForProject(project.getId());
        assertThat(rows.get(0).consecutiveFailures()).isEqualTo(3);
    }

    @Test
    void globalCapabilityWorkerAppearsBoundInEveryProjectHealthView() {
        sweep.run(new org.springframework.boot.DefaultApplicationArguments());
        health.noteFetchSuccess(null, agent.getId(), "agent-worker-1",
                List.of("abada:agent"), false);
        var project = projects.create("p6", "Project Six", "desc");

        List<WorkerHealthDTO> rows = health.healthForProject(project.getId());
        WorkerHealthDTO row = rows.stream()
                .filter(candidate -> candidate.principalId().equals(agent.getId()))
                .findFirst().orElseThrow();
        assertThat(row.topic()).isEqualTo("abada:agent");
        assertThat(row.bound()).isTrue();
        assertThat(row.status()).isEqualTo("ONLINE");
        assertThat(row.lastSeenAt()).isNotNull();
    }

    @Test
    void globalHeartbeatSupersedesStaleProjectScopedRowForSameWorker() {
        sweep.run(new org.springframework.boot.DefaultApplicationArguments());
        var project = projects.create("p7", "Project Seven", "desc");
        health.noteFetchSuccess(project.getId(), agent.getId(), "agent-worker-1",
                List.of("abada:agent"), false);
        health.noteFetchSuccess(null, agent.getId(), "agent-worker-1",
                List.of("abada:agent"), false);

        List<WorkerHealthDTO> rows = health.healthForProject(project.getId());
        assertThat(rows).hasSize(1);
        WorkerHealthDTO row = rows.get(0);
        assertThat(row.principalId()).isEqualTo(agent.getId());
        assertThat(row.bound()).isTrue();
        assertThat(row.status()).isEqualTo("ONLINE");
        assertThat(row.lastSeenAt()).isNotNull();
    }

    @Test
    void aNonMemberCannotReadHealth() {
        var project = projects.create("p5", "Project Five", "desc");
        health.noteFetchFailure(project.getId(), agent.getId(), "agent-worker-1",
                List.of("abada:agent"), "Worker is not bound to this project");
        PrincipalEntity outsider = principal("outsider", "outsider-subject");
        IdentityContext.set(new Identity(outsider.getId(), outsider.getUsername(), List.of()));
        assertThatThrownBy(() -> health.healthForProject(project.getId()))
                .isInstanceOf(ApiException.class);
    }
}