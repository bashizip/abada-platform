package com.abada.engine.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.ApiException;
import com.abada.engine.api.ProjectAuthoringController;
import com.abada.engine.core.AbadaEngine;
import com.abada.engine.dto.Mapper;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.abada.engine.util.DatabaseTestHelper;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class ProjectEnvelopeIntegrationTest {
    @Autowired ProjectService projects;
    @Autowired ProjectDocumentService documents;
    @Autowired PrincipalRepository principals;
    @Autowired DatabaseTestHelper database;
    @Autowired AbadaEngine engine;
    @Autowired ProjectAuthoringController authoring;

    private PrincipalEntity owner;

    @BeforeEach
    void setUp() {
        database.cleanup();
        owner = principal("owner", "owner-subject");
        IdentityContext.set(new Identity(owner.getId(), owner.getUsername(), List.of()));
    }

    @AfterEach
    void clearIdentity() { IdentityContext.clear(); }

    @Test
    void scopesStableProcessKeysDefinitionsAndInstancesByProject() {
        var first = projects.create("alpha", "Alpha", "First bounded context");
        var second = projects.create("beta", "Beta", "Second bounded context");
        var firstDocument = documents.create(first.getId(), "shared_flow", "Alpha process", apl("Shared Flow"));
        var secondDocument = documents.create(second.getId(), "shared_flow", "Beta process", apl("Shared Flow"));

        var firstDefinition = documents.deploy(first.getId(), firstDocument.getId(),
                firstDocument.getEntityVersion());
        var secondDefinition = documents.deploy(second.getId(), secondDocument.getId(),
                secondDocument.getEntityVersion());

        assertThat(firstDefinition.getVersion()).isEqualTo(1);
        assertThat(secondDefinition.getVersion()).isEqualTo(1);
        assertThat(firstDefinition.getProjectId()).isEqualTo(first.getId());
        assertThat(secondDefinition.getProjectId()).isEqualTo(second.getId());

        var instance = engine.startProcess(first.getId(), "shared_flow", "owner", java.util.Map.of());
        assertThat(instance.getProjectId()).isEqualTo(first.getId());
        assertThat(Mapper.ProcessInstanceMapper.toDto(instance).processDefinitionDeploymentId())
                .isEqualTo(firstDefinition.getDeploymentId());
        assertThat(engine.getProcessInstances(first.getId(), null, null, PageRequest.of(0, 10)))
                .hasSize(1);
        assertThat(engine.getProcessInstances(second.getId(), null, null, PageRequest.of(0, 10)))
                .isEmpty();
    }

    @Test
    void enforcesOptimisticAutosaveArchiveAndIndependentReviewRole() {
        var project = projects.create("governed", "Governed", "Review separation");
        var document = documents.create(project.getId(), "shared_flow", "", apl("Shared Flow"));
        long initialRevision = document.getEntityVersion();
        var saved = documents.save(project.getId(), document.getId(), initialRevision,
                "Updated", apl("Shared Flow Updated"));
        assertThat(saved.getEntityVersion()).isGreaterThan(initialRevision);
        assertThatThrownBy(() -> documents.save(project.getId(), document.getId(), initialRevision,
                "Stale", apl("Shared Flow"))).isInstanceOf(RuntimeException.class)
                .hasMessageContaining("concurrently");

        assertThat(projects.accessibleProjects()).singleElement().satisfies(value ->
                assertThat(value.getId()).isEqualTo(project.getId()));
        assertThat(projects.members(project.getId())).singleElement().satisfies(member -> {
            assertThat(member.getRoles()).containsExactlyInAnyOrder(
                    Role.OWNER, Role.MAINTAINER, Role.OPERATOR, Role.VIEWER);
            assertThat(member.getRoles()).doesNotContain(Role.REVIEWER);
        });

        var archived = projects.setArchived(project.getId(), project.getEntityVersion(), true);
        assertThat(archived.getStatus().name()).isEqualTo("ARCHIVED");
        assertThatThrownBy(() -> documents.deploy(project.getId(), document.getId(),
                saved.getEntityVersion())).isInstanceOf(ApiException.class)
                .hasMessageContaining("archived");
    }

    @Test
    void hidesProjectFromUnrelatedPrincipalAndProtectsLastOwner() {
        var project = projects.create("private", "Private", "Invisible by default");
        PrincipalEntity outsider = principal("outsider", "outsider-subject");

        assertThatThrownBy(() -> projects.putMember(project.getId(), owner.getId(), null,
                Set.of(Role.VIEWER), Set.of(), Set.of())).isInstanceOf(ApiException.class)
                .hasMessageContaining("owner");

        IdentityContext.set(new Identity(outsider.getId(), outsider.getUsername(), List.of()));
        assertThat(projects.accessibleProjects()).isEmpty();
        assertThatThrownBy(() -> documents.list(project.getId(), PageRequest.of(0, 10)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void restrictsAplAuthoringToOwnersAndMaintainers() {
        var project = projects.create("authoring", "Authoring", "Native APL generation");
        var ownerResponse = authoring.generate(project.getId(),
                new ProjectAuthoringController.GenerateAplRequest(
                        "Review invoice risk", "CREATE", null));
        assertThat(ownerResponse.getBody()).isNotNull();
        assertThat(ownerResponse.getBody().provider()).isEqualTo("LOCAL_FALLBACK");

        PrincipalEntity viewer = principal("viewer", "viewer-subject");
        projects.putMember(project.getId(), viewer.getId(), null, Set.of(Role.VIEWER), Set.of(), Set.of());
        IdentityContext.set(new Identity(viewer.getId(), viewer.getUsername(), List.of()));

        assertThatThrownBy(() -> authoring.generate(project.getId(),
                new ProjectAuthoringController.GenerateAplRequest(
                        "Review invoice risk", "CREATE", null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("not found");
    }

    private PrincipalEntity principal(String username, String subject) {
        Instant now = Instant.now();
        PrincipalEntity principal = new PrincipalEntity();
        principal.setIssuer("test");
        principal.setSubjectId(subject);
        principal.setUsername(username);
        principal.setFirstSeenAt(now);
        principal.setLastSeenAt(now);
        return principals.save(principal);
    }

    private String apl(String name) {
        return """
                version: abada.io/v1
                metadata:
                  key: shared_flow
                  name: %s
                flow:
                  entry: start
                  nodes:
                    - id: start
                      type: webhook
                      next: end
                    - id: end
                      type: end
                """.formatted(name);
    }
}
