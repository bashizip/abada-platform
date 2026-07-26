package com.abada.engine.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class AudienceValidatorTest {

    private final AudienceValidator validator = new AudienceValidator("abada-api");

    @Test
    void acceptsRequiredAudienceAndRejectsAnotherClient() {
        assertThat(validator.validate(jwt(List.of("abada-api"))).hasErrors()).isFalse();
        assertThat(validator.validate(jwt(List.of("another-client"))).hasErrors()).isTrue();
    }

    private Jwt jwt(List<String> audience) {
        return Jwt.withTokenValue("token").header("alg", "RS256")
                .audience(audience).issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
    }
}
