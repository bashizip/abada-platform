package com.abada.engine.project;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.persistence.repository.ProjectWorkerBindingRepository;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.abada.engine.util.DatabaseTestHelper;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class FirstPartyWorkerBindingTest {
    @Autowired ProjectService projects;
    @Autowired ProjectWorkerBindingRepository bindings;
    @Autowired PrincipalRepository principals;
    @Autowired FirstPartyWorkerBindingSweep sweep;
    @Autowired DatabaseTestHelper database;

    private PrincipalEntity owner;
    private PrincipalEntity agent;

    @BeforeEach
    void setUp() {
        database.cleanup();
        owner = principal("owner", "owner-subject", PrincipalEntity.Type.HUMAN);
        agent = principal("service-account-abada-agent-worker", "agent-subject",
                PrincipalEntity.Type.SERVICE);
        IdentityContext.set(new Identity(owner.getId(), owner.getUsername(), List.of()));
    }

    @AfterEach
    void clearIdentity() { IdentityContext.clear(); }

    private PrincipalEntity principal(String username, String subject, PrincipalEntity.Type type) {
        var entity = new PrincipalEntity();
        entity.setIssuer("test");
        entity.setSubjectId(subject);
        entity.setUsername(username);
        entity.setPrincipalType(type);
        entity.setFirstSeenAt(Instant.now());
        entity.setLastSeenAt(Instant.now());
        return principals.save(entity);
    }

    @Test
    void creatingAProjectAutoBindsTheConfiguredFirstPartyWorker() {
        var project = projects.create("auto-project", "Auto", "desc");

        var binding = bindings.findByProjectIdAndPrincipalId(project.getId(), agentId());
        assertThat(binding).isPresent();
        assertThat(binding.orElseThrow().getTopics()).isEqualTo("abada:agent");
    }

    @Test
    void startupSweepBackfillsProjectsCreatedBeforeThePrincipalExisted() {
        String agentId = agent.getId();
        principals.delete(agent);
        var project = projects.create("early-project", "Early", "desc");
        assertThat(bindings.findByProjectIdAndPrincipalId(project.getId(), agentId)).isEmpty();

        principals.save(agent);

        sweep.run(new DefaultApplicationArguments());

        assertThat(bindings.findByProjectIdAndPrincipalId(project.getId(), agentId)).isPresent();
    }

    @Test
    void sweepIsIdempotent() {
        var project = projects.create("twice-project", "Twice", "desc");

        sweep.run(new DefaultApplicationArguments());
        sweep.run(new DefaultApplicationArguments());

        assertThat(bindings.findByProjectIdAndPrincipalId(project.getId(), agentId()))
                .isPresent();
        assertThat(bindings.findByProjectId(project.getId())).hasSize(1);
    }

    @Test
    void noBindingIsCreatedWhenTheWorkerPrincipalIsUnknown() {
        principals.delete(agent);
        var project = projects.create("bare-project", "Bare", "desc");

        assertThat(bindings.findByProjectId(project.getId())).isEmpty();
    }

    private String agentId() {
        return principals.findFirstByUsernameIgnoreCase("service-account-abada-agent-worker")
                .orElseThrow().getId();
    }
}