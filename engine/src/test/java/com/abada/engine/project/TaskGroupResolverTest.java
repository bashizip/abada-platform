package com.abada.engine.project;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.persistence.entity.ProjectMemberEntity;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.repository.ProjectMemberRepository;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.abada.engine.util.DatabaseTestHelper;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@ActiveProfiles("test")
class TaskGroupResolverTest {

    @Autowired private ProjectService projectService;
    @Autowired private TaskGroupResolver resolver;
    @Autowired private ProjectMemberRepository members;
    @Autowired private PrincipalRepository principals;
    @Autowired private DatabaseTestHelper databaseTestHelper;
    @Autowired private TransactionTemplate tx;

    private String projectId;

    @BeforeEach
    void setUp() {
        databaseTestHelper.cleanup();
        ensurePrincipal("admin", "admin");
        IdentityContext.set(new Identity("admin", "admin", List.of()));
        var project = projectService.create("resolver-test", "Resolver Test", null);
        projectId = project.getId();
    }

    private PrincipalEntity ensurePrincipal(String id, String username) {
        return tx.execute(s -> {
            var existing = principals.findById(id);
            if (existing.isPresent()) return existing.get();
            PrincipalEntity p = new PrincipalEntity();
            p.setId(id);
            p.setIssuer("test");
            p.setSubjectId(id);
            p.setUsername(username);
            p.setFirstSeenAt(Instant.now());
            p.setLastSeenAt(Instant.now());
            return principals.save(p);
        });
    }

    private void addMember(String principalId, Set<String> taskGroups) {
        ensurePrincipal(principalId, principalId);
        tx.executeWithoutResult(s -> {
            ProjectMemberEntity member = new ProjectMemberEntity();
            member.setProjectId(projectId);
            member.setPrincipalId(principalId);
            member.setRoles(Set.of(ProjectMemberEntity.Role.VIEWER));
            member.setTaskGroups(taskGroups);
            member.setCreatedAt(Instant.now());
            member.setCreatedBy("admin");
            members.save(member);
        });
    }

    @Test
    @DisplayName("Effective groups merge identity groups with member task groups")
    void mergesIdentityAndTaskGroups() {
        addMember("alice-id", Set.of("SALES_DIRECTOR"));
        List<String> result = resolver.effectiveGroups(projectId, "alice-id",
                List.of("abada-task-user"));
        assertThat(result).containsExactlyInAnyOrder("abada-task-user", "SALES_DIRECTOR");
    }

    @Test
    @DisplayName("Returns identity groups when user has no membership")
    void returnsIdentityGroupsWhenNoMembership() {
        List<String> result = resolver.effectiveGroups(projectId, "nobody",
                List.of("abada-task-user"));
        assertThat(result).containsExactly("abada-task-user");
    }

    @Test
    @DisplayName("Returns empty list when principalId is null")
    void returnsEmptyWhenNoPrincipal() {
        List<String> result = resolver.effectiveGroups(projectId, null,
                List.of("abada-task-user"));
        assertThat(result).containsExactly("abada-task-user");
    }

    @Test
    @DisplayName("Global effective groups union all memberships")
    void globalGroupsUnionAllMemberships() {
        String otherProjectId = projectService.create("other", "Other", null).getId();
        addMember("bob-id", Set.of("SALES_DIRECTOR"));
        tx.executeWithoutResult(s -> {
            ProjectMemberEntity member = new ProjectMemberEntity();
            member.setProjectId(otherProjectId);
            member.setPrincipalId("bob-id");
            member.setRoles(Set.of(ProjectMemberEntity.Role.VIEWER));
            member.setTaskGroups(Set.of("FINANCE"));
            member.setCreatedAt(Instant.now());
            member.setCreatedBy("admin");
            members.save(member);
        });
        List<String> result = resolver.globalEffectiveGroups("bob-id",
                List.of("abada-task-user"));
        assertThat(result).containsExactlyInAnyOrder(
                "abada-task-user", "SALES_DIRECTOR", "FINANCE");
    }

    @Test
    @DisplayName("Global effective groups with no membership returns identity groups")
    void globalGroupsFallsBackToIdentity() {
        List<String> result = resolver.globalEffectiveGroups("nobody",
                List.of("abada-task-user"));
        assertThat(result).containsExactly("abada-task-user");
    }
}
