package com.abada.engine.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.abada.engine.identity.IdentityProperties;
import com.abada.engine.identity.KeycloakAdminClient;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

class PrincipalDiscoveryServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String ISSUER = "http://keycloak.localhost/realms/abada-dev";

    private final PrincipalRepository principals = mock(PrincipalRepository.class);
    private final PrincipalService principalService = mock(PrincipalService.class);
    private final KeycloakAdminClient keycloak = mock(KeycloakAdminClient.class);
    private final IdentityProperties identityProperties = mock(IdentityProperties.class);

    private final PrincipalDiscoveryService service = new PrincipalDiscoveryService(
            principals, principalService, keycloak, identityProperties, ISSUER);

    @Test
    void searchUpsertsMatchingIdpUsersAsObservedPrincipals() {
        when(identityProperties.isConfigured()).thenReturn(true);
        when(keycloak.listUsers("charlie")).thenReturn(List.of(
                idpUser("kc-1", "charlie"),
                idpUser("kc-2", "service-account-abada-agent-worker")));
        Page<PrincipalEntity> page = new PageImpl<>(List.of());
        when(principals.findByUsernameContainingIgnoreCase(eq("charlie"), any())).thenReturn(page);

        Page<PrincipalEntity> result = service.search("charlie", PageRequest.of(0, 20));

        verify(principalService).observe(ISSUER, "kc-1", "charlie", PrincipalEntity.Type.HUMAN);
        verify(principalService).observe(ISSUER, "kc-2", "service-account-abada-agent-worker",
                PrincipalEntity.Type.SERVICE);
        assertThat(result).isSameAs(page);
    }

    @Test
    void blankSearchSkipsIdpDiscovery() {
        Page<PrincipalEntity> page = new PageImpl<>(List.of());
        when(principals.findAll(any(PageRequest.class))).thenReturn(page);

        Page<PrincipalEntity> result = service.search("", PageRequest.of(0, 20));

        verifyNoInteractions(keycloak);
        assertThat(result).isSameAs(page);
    }

    @Test
    void searchFallsBackToLocalPrincipalsWhenIdpIsNotConfigured() {
        when(identityProperties.isConfigured()).thenReturn(false);
        Page<PrincipalEntity> page = new PageImpl<>(List.of());
        when(principals.findByUsernameContainingIgnoreCase(eq("alice"), any())).thenReturn(page);

        Page<PrincipalEntity> result = service.search("alice", PageRequest.of(0, 20));

        verifyNoInteractions(keycloak);
        assertThat(result).isSameAs(page);
    }

    @Test
    void searchFallsBackToLocalPrincipalsWhenIdpFails() {
        when(identityProperties.isConfigured()).thenReturn(true);
        when(keycloak.listUsers("alice")).thenThrow(new RuntimeException("idp unreachable"));
        Page<PrincipalEntity> page = new PageImpl<>(List.of());
        when(principals.findByUsernameContainingIgnoreCase(eq("alice"), any())).thenReturn(page);

        Page<PrincipalEntity> result = service.search("alice", PageRequest.of(0, 20));

        verify(principalService, never()).observe(any(), any(), any(), any());
        assertThat(result).isSameAs(page);
    }

    private JsonNode idpUser(String id, String username) {
        return MAPPER.createObjectNode().put("id", id).put("username", username);
    }
}
