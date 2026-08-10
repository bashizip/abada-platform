package com.abada.engine.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.api.ApiException;
import com.abada.engine.dto.ProjectTreeNodeDTO;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.entity.ProjectMemberEntity.Role;
import com.abada.engine.persistence.entity.ProjectResourceEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;
import com.abada.engine.util.DatabaseTestHelper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class ProjectFileTreeIntegrationTest {
    @Autowired ProjectService projects;
    @Autowired ProjectDocumentService documents;
    @Autowired ProjectTreeService trees;
    @Autowired PrincipalRepository principals;
    @Autowired DatabaseTestHelper database;

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
    void seedsSixLockedSystemRootFoldersAndBuildsAnOrderedTreeWithPaths() {
        var project = projects.create("workspace", "Workspace", null);

        var tree = trees.tree(project.getId());
        assertThat(tree).extracting(ProjectTreeNodeDTO::name)
                .containsExactly("processes", "resources", "forms", "media", "agents", "tests");
        assertThat(tree).allSatisfy(node -> {
            assertThat(node.kind()).isEqualTo("FOLDER");
            assertThat(node.system()).isTrue();
            assertThat(node.path()).isEqualTo(node.name());
        });

        var processes = find(tree, "processes");
        var manifest = documents.create(project.getId(), "stable_key", "Manifest", apl(),
                processes.id(), "manifest.apl.yaml");
        assertThat(manifest.getFolderId()).isEqualTo(processes.id());
        assertThat(manifest.getFileName()).isEqualTo("manifest.apl.yaml");

        var updated = trees.tree(project.getId());
        assertThat(find(updated, "processes").children()).singleElement().satisfies(node -> {
            assertThat(node.kind()).isEqualTo("DOCUMENT");
            assertThat(node.name()).isEqualTo("manifest.apl.yaml");
            assertThat(node.path()).isEqualTo("processes/manifest.apl.yaml");
            assertThat(node.processKey()).isEqualTo("stable_key");
        });
        assertThat(find(updated, "forms").children()).isEmpty();
    }

    @Test
    void locksTheSixSystemRootFoldersAndForbidsRootFolderCreation() {
        var project = projects.create("locked", "Locked", null);
        var processes = find(trees.tree(project.getId()), "processes");
        var resources = find(trees.tree(project.getId()), "resources");

        assertThatThrownBy(() -> trees.renameFolder(project.getId(), processes.id(), "other"))
                .isInstanceOf(ApiException.class).hasMessageContaining("locked");
        assertThatThrownBy(() -> trees.moveFolder(project.getId(), processes.id(), resources.id()))
                .isInstanceOf(ApiException.class).hasMessageContaining("locked");
        assertThatThrownBy(() -> trees.deleteFolder(project.getId(), processes.id()))
                .isInstanceOf(ApiException.class).hasMessageContaining("locked");

        assertThatThrownBy(() -> trees.createFolder(project.getId(), null, "custom"))
                .isInstanceOf(ApiException.class).hasMessageContaining("system folders");
        assertThatThrownBy(() -> trees.createFolder(project.getId(), "", "custom"))
                .isInstanceOf(ApiException.class).hasMessageContaining("system folders");
        assertThatThrownBy(() -> trees.createFolder(project.getId(), processes.id(), "processes"))
                .isInstanceOf(ApiException.class).hasMessageContaining("reserved");

        var nested = trees.createFolder(project.getId(), processes.id(), "custom");
        assertThat(nested.isSystemFolder()).isFalse();
        assertThatThrownBy(() -> trees.moveFolder(project.getId(), nested.getId(), ""))
                .isInstanceOf(ApiException.class).hasMessageContaining("reserved for the system folders");
        assertThatThrownBy(() -> trees.moveFolder(project.getId(), nested.getId(), null))
                .isInstanceOf(ApiException.class).hasMessageContaining("reserved for the system folders");

        assertThat(trees.tree(project.getId())).extracting(ProjectTreeNodeDTO::name)
                .containsExactly("processes", "resources", "forms", "media", "agents", "tests");
    }

    @Test
    void enforcesUniqueFolderAndFileNamePerParentInsideSystemFolders() {
        var project = projects.create("unique", "Unique", null);
        var workflows = find(trees.tree(project.getId()), "processes");
        trees.createFolder(project.getId(), workflows.id(), "workflows");
        assertThatThrownBy(() -> trees.createFolder(project.getId(), workflows.id(), "workflows"))
                .isInstanceOf(ApiException.class).hasMessageContaining("already exists");
        var nested = trees.createFolder(project.getId(), workflows.id(), "nested");
        assertThatThrownBy(() -> trees.createFolder(project.getId(), workflows.id(), "nested"))
                .isInstanceOf(ApiException.class).hasMessageContaining("already exists");

        trees.createResource(project.getId(), null, "assets.json", "application/json",
                ProjectResourceEntity.Kind.RESOURCE, "{}".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> trees.createResource(project.getId(), null, "assets.json",
                "application/json", ProjectResourceEntity.Kind.RESOURCE,
                "{}".getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ApiException.class).hasMessageContaining("already exists");
    }

    @Test
    void renamesAndMovesDocumentsWithoutChangingProcessKey() {
        var project = projects.create("rename", "Rename", null);
        var document = documents.create(project.getId(), "stable_key", "Stable", apl());
        var processes = find(trees.tree(project.getId()), "processes");

        var renamed = documents.rename(project.getId(), document.getId(),
                document.getEntityVersion(), "stable.apl.yaml");
        assertThat(renamed.getFileName()).isEqualTo("stable.apl.yaml");
        assertThat(renamed.getProcessKey()).isEqualTo("stable_key");

        var moved = documents.move(project.getId(), document.getId(), renamed.getEntityVersion(),
                processes.id());
        assertThat(moved.getFolderId()).isEqualTo(processes.id());

        var node = find(trees.tree(project.getId()), "processes").children().get(0);
        assertThat(node.path()).isEqualTo("processes/stable.apl.yaml");
        assertThat(node.processKey()).isEqualTo("stable_key");

        var deployed = documents.deploy(project.getId(), document.getId(), moved.getEntityVersion());
        assertThat(deployed.getProcessKey()).isEqualTo("stable_key");
    }

    @Test
    void rejectsFolderMovesIntoOwnSubtreeAndFolderNamesWithSlashes() {
        var project = projects.create("cycles", "Cycles", null);
        var processes = find(trees.tree(project.getId()), "processes");
        var nested = trees.createFolder(project.getId(), processes.id(), "nested");
        var deeper = trees.createFolder(project.getId(), nested.getId(), "deeper");

        assertThatThrownBy(() -> trees.moveFolder(project.getId(), nested.getId(), nested.getId()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("cannot be moved into itself");
        assertThatThrownBy(() -> trees.moveFolder(project.getId(), nested.getId(), deeper.getId()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("cannot be moved into itself");
        assertThatThrownBy(() -> trees.createFolder(project.getId(), processes.id(), "a/b"))
                .isInstanceOf(ApiException.class).hasMessageContaining("without '/'");
    }

    @Test
    void deletingAFolderArchivesContainedDocumentsAndRemovesResourcesAndFolders() {
        var project = projects.create("remove", "Remove", null);
        var processes = find(trees.tree(project.getId()), "processes");
        assertThatThrownBy(() -> trees.deleteFolder(project.getId(), processes.id()))
                .isInstanceOf(ApiException.class).hasMessageContaining("locked");
        var doomed = trees.createFolder(project.getId(), processes.id(), "archive-me");
        var document = documents.create(project.getId(), "stable_key", "Doomed", apl(), doomed.getId(), null);
        documents.deploy(project.getId(), document.getId(), document.getEntityVersion());
        trees.createResource(project.getId(), doomed.getId(), "note.txt", "text/plain",
                ProjectResourceEntity.Kind.RESOURCE, "bye".getBytes(StandardCharsets.UTF_8));

        trees.deleteFolder(project.getId(), doomed.getId());

        assertThat(documents.get(project.getId(), document.getId()).getStatus().name())
                .isEqualTo("ARCHIVED");
        assertThat(documents.get(project.getId(), document.getId()).getFolderId()).isNull();
        assertThat(find(trees.tree(project.getId()), "processes").children()).isEmpty();
        assertThat(trees.tree(project.getId())).extracting(ProjectTreeNodeDTO::name)
                .containsExactly("processes", "resources", "forms", "media", "agents", "tests");
    }

    @Test
    void supportsResourceLifecycleWithOptimisticReplacement() {
        var project = projects.create("res", "Resources", null);
        byte[] initial = "{\"version\":1}".getBytes(StandardCharsets.UTF_8);
        var created = trees.createResource(project.getId(), null, "form.json", "application/json",
                ProjectResourceEntity.Kind.FORM, initial);
        assertThat(created.getKind()).isEqualTo(ProjectResourceEntity.Kind.FORM);
        assertThat(created.getSizeBytes()).isEqualTo(initial.length);
        assertThat(created.getSha256()).hasSize(64);

        var content = trees.getResource(project.getId(), created.getId());
        assertThat(content.getContent()).isEqualTo(initial);

        byte[] updated = "{\"version\":2}".getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> trees.replaceResource(project.getId(), created.getId(),
                created.getEntityVersion() + 100, "application/json", updated))
                .isInstanceOf(RuntimeException.class).hasMessageContaining("concurrently");
        var replaced = trees.replaceResource(project.getId(), created.getId(),
                created.getEntityVersion(), "application/json", updated);
        assertThat(new String(trees.getResource(project.getId(), created.getId()).getContent(),
                StandardCharsets.UTF_8)).isEqualTo("{\"version\":2}");

        var forms = find(trees.tree(project.getId()), "forms");
        trees.moveResource(project.getId(), created.getId(), replaced.getEntityVersion(), forms.id());
        assertThat(find(trees.tree(project.getId()), "forms").children()).singleElement()
                .satisfies(node -> assertThat(node.path()).isEqualTo("forms/form.json"));

        trees.deleteResource(project.getId(), created.getId());
        assertThatThrownBy(() -> trees.getResource(project.getId(), created.getId()))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void allowsLegacyCompoundRootFilesButForbidsMovingUserFoldersToRoot() {
        var project = projects.create("root-move", "Root Move", null);
        var processes = find(trees.tree(project.getId()), "processes");
        var nested = trees.createFolder(project.getId(), processes.id(), "nested");
        var document = documents.create(project.getId(), "stable_key", "Stable", apl(),
                nested.getId(), null);
        var resource = trees.createResource(project.getId(), nested.getId(), "note.txt",
                "text/plain", ProjectResourceEntity.Kind.RESOURCE,
                "bye".getBytes(StandardCharsets.UTF_8));

        assertThatThrownBy(() -> trees.moveFolder(project.getId(), nested.getId(), ""))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("reserved for the system folders");
        var movedDocument = documents.move(project.getId(), document.getId(),
                document.getEntityVersion(), "");
        assertThat(movedDocument.getFolderId()).isNull();
        var movedResource = trees.moveResource(project.getId(), resource.getId(),
                resource.getEntityVersion(), "");
        assertThat(movedResource.getFolderId()).isNull();

        var tree = trees.tree(project.getId());
        assertThat(tree).extracting(ProjectTreeNodeDTO::kind)
                .contains("FOLDER", "FOLDER", "FOLDER", "FOLDER", "FOLDER", "FOLDER",
                        "DOCUMENT", "RESOURCE");
        assertThat(find(find(tree, "processes").children(), "nested").children()).isEmpty();
        var rootDocument = tree.stream()
                .filter(node -> node.kind().equals("DOCUMENT")).findFirst().orElseThrow();
        assertThat(rootDocument.path()).isEqualTo("Stable Display Name.apl.yaml");
        var rootResource = tree.stream()
                .filter(node -> node.kind().equals("RESOURCE")).findFirst().orElseThrow();
        assertThat(rootResource.path()).isEqualTo("note.txt");
    }
    void enforcesProjectMembershipAndRequiresMaintainer() {
        var project = projects.create("permissions", "Permissions", null);
        PrincipalEntity viewer = principal("viewer", "viewer-subject");
        projects.putMember(project.getId(), viewer.getId(), null, Set.of(Role.VIEWER), Set.of());

        IdentityContext.set(new Identity(viewer.getId(), viewer.getUsername(), List.of()));
        assertThatThrownBy(() -> trees.createFolder(project.getId(), null, "blocked"))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> trees.createResource(project.getId(), null, "blocked.txt",
                "text/plain", ProjectResourceEntity.Kind.RESOURCE, new byte[0]))
                .isInstanceOf(ApiException.class);
        assertThat(trees.tree(project.getId())).hasSize(6);

        IdentityContext.clear();
        assertThatThrownBy(() -> trees.createFolder(project.getId(), null, "anonymous"))
                .isInstanceOf(ApiException.class);
    }

    private ProjectTreeNodeDTO find(List<ProjectTreeNodeDTO> roots, String name) {
        return roots.stream().filter(byName(name)).findFirst().orElseThrow();
    }

    private Predicate<ProjectTreeNodeDTO> byName(String name) {
        return node -> node.name().equals(name);
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

    private String apl() {
        return """
                version: abada.io/v1
                metadata:
                  key: stable_key
                  name: Stable Display Name
                flow:
                  entry: start
                  nodes:
                    - id: start
                      type: webhook
                      next: end
                    - id: end
                      type: end
                """;
    }
}