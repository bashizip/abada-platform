package com.abada.engine.api;

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
 */
@RestController
@RequestMapping("/v1/admin")
public class AdminController {

    private final IdentityAdminService identityAdmin;
    private final IdentityProperties identityProperties;

    public AdminController(IdentityAdminService identityAdmin,
            IdentityProperties identityProperties) {
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
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/users/{id}")
    public ResponseEntity<AdminUserDTO> updateUser(@PathVariable String id,
            @RequestBody UpdateUserRequest request) {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        AdminUserDTO updated = identityAdmin.updateUser(id, request);
        if (updated == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(updated);
    }

    @PutMapping("/users/{userId}/groups/{groupId}")
    public ResponseEntity<Void> assignGroup(@PathVariable String userId,
            @PathVariable String groupId) {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        identityAdmin.assignGroup(userId, groupId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/users/{userId}/groups/{groupId}")
    public ResponseEntity<Void> revokeGroup(@PathVariable String userId,
            @PathVariable String groupId) {
        if (!identityProperties.isConfigured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        identityAdmin.revokeGroup(userId, groupId);
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
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    // ── Status ──

    @GetMapping("/status")
    public ResponseEntity<AdminStatusDTO> status() {
        return ResponseEntity.ok(new AdminStatusDTO(
                identityProperties.isConfigured(),
                identityProperties.isConfigured() ? identityProperties.realm() : null));
    }

    public record AdminStatusDTO(boolean configured, String realm) {
    }
}
