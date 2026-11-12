package com.abada.engine.api;

import com.abada.engine.audit.AdminAuditActions;
import com.abada.engine.audit.AdminAuditDetails;
import com.abada.engine.audit.AdminAuditRecorder;
import com.abada.engine.dto.AdminGroupDTO;
import com.abada.engine.dto.AdminUserDTO;
import com.abada.engine.dto.CreateUserRequest;
import com.abada.engine.dto.UpdateUserRequest;
import com.abada.engine.identity.IdentityAdminService;
import com.abada.engine.identity.IdentityProperties;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Platform administration REST surface.
 * Proxies user and group management to the configured external IdP (Keycloak).
 * All endpoints require the abada-admin role.
 *
 * <p>Users and groups live in the identity provider, outside the engine's database,
 * so each change is recorded in the administration audit trail in its own
 * transaction once the provider has accepted it (S10). Passwords are never recorded.
 */
@RestController
@RequestMapping("/v1/admin")
public class AdminController {

    private final IdentityAdminService identityAdmin;
    private final IdentityProperties identityProperties;
    private final AdminAuditRecorder audit;

    public AdminController(IdentityAdminService identityAdmin,
            IdentityProperties identityProperties, AdminAuditRecorder audit) {
        this.audit = audit;
        this.identityAdmin = identityAdmin;
        this.identityProperties = identityProperties;
    }

    // ── Users ──

    @GetMapping("/users")
    public ResponseEntity<List<AdminUserDTO>> listUsers(
            @RequestParam(required = false) String query) {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(List.of());
        }
        return ResponseEntity.ok(identityAdmin.listUsers(query));
    }

    @GetMapping("/users/{id}")
    public ResponseEntity<AdminUserDTO> getUser(@PathVariable String id) {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        AdminUserDTO user = identityAdmin.getUser(id);
        if (user == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(user);
    }

    @PostMapping("/users")
    public ResponseEntity<AdminUserDTO> createUser(@RequestBody CreateUserRequest request) {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        AdminUserDTO created = identityAdmin.createUser(request);
        if (created == null) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
        audit.recordExternalSuccess(AdminAuditActions.USER_CREATE, AdminAuditActions.TARGET_USER, created.id(),
                AdminAuditDetails.create().put("username", created.username()).put("email", created.email())
                        .put("enabled", created.enabled()).put("groups", created.groups())
                        .put("initialPasswordSet", request.password() != null && !request.password().isBlank()));
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/users/{id}")
    public ResponseEntity<AdminUserDTO> updateUser(@PathVariable String id,
            @RequestBody UpdateUserRequest request) {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        AdminUserDTO before = identityAdmin.getUser(id);
        AdminUserDTO updated = identityAdmin.updateUser(id, request);
        if (updated == null) {
            return ResponseEntity.notFound().build();
        }
        AdminAuditDetails details = AdminAuditDetails.create().put("username", updated.username());
        if (before != null) {
            details.change("email", before.email(), updated.email())
                    .change("firstName", before.firstName(), updated.firstName())
                    .change("lastName", before.lastName(), updated.lastName())
                    .change("enabled", before.enabled(), updated.enabled())
                    .change("groups", before.groups(), updated.groups());
        }
        audit.recordExternalSuccess(AdminAuditActions.USER_UPDATE, AdminAuditActions.TARGET_USER, id, details);
        return ResponseEntity.ok(updated);
    }

    @PutMapping("/users/{userId}/groups/{groupId}")
    public ResponseEntity<Void> assignGroup(@PathVariable String userId,
            @PathVariable String groupId) {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        identityAdmin.assignGroup(userId, groupId);
        audit.recordExternalSuccess(AdminAuditActions.USER_GROUP_ASSIGN, AdminAuditActions.TARGET_USER, userId,
                AdminAuditDetails.create().put("groupId", groupId));
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/users/{userId}/groups/{groupId}")
    public ResponseEntity<Void> revokeGroup(@PathVariable String userId,
            @PathVariable String groupId) {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        identityAdmin.revokeGroup(userId, groupId);
        audit.recordExternalSuccess(AdminAuditActions.USER_GROUP_REVOKE, AdminAuditActions.TARGET_USER, userId,
                AdminAuditDetails.create().put("groupId", groupId));
        return ResponseEntity.noContent().build();
    }

    // ── Groups ──

    @GetMapping("/groups")
    public ResponseEntity<List<AdminGroupDTO>> listGroups() {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(List.of());
        }
        return ResponseEntity.ok(identityAdmin.listGroups());
    }

    @PostMapping("/groups")
    public ResponseEntity<AdminGroupDTO> createGroup(
            @RequestParam(name = "name") String name) {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        AdminGroupDTO created = identityAdmin.createGroup(name);
        if (created == null) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
        audit.recordExternalSuccess(AdminAuditActions.GROUP_CREATE, AdminAuditActions.TARGET_GROUP, created.id(),
                AdminAuditDetails.create().put("name", created.name()));
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    // ── Status ──

    @GetMapping("/status")
    public ResponseEntity<AdminStatusDTO> status() {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.ok(new AdminStatusDTO(false, null));
        }
        try {
            // Verify connectivity
            identityAdmin.listGroups();
            return ResponseEntity.ok(new AdminStatusDTO(true, identityProperties.realm()));
        } catch (Exception e) {
            return ResponseEntity.ok(new AdminStatusDTO(false, null));
        }
    }

    public record AdminStatusDTO(boolean configured, String realm) {
    }
}
