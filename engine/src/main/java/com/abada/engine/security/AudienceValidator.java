package com.abada.engine.security;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/** Requires the configured API audience in every directly validated OIDC JWT. */
final class AudienceValidator implements OAuth2TokenValidator<Jwt> {

    private final String audience;
    private final OAuth2Error error;

    AudienceValidator(String audience) {
        if (audience == null || audience.isBlank()) {
            throw new IllegalArgumentException("OIDC_AUDIENCE must not be blank");
        }
        this.audience = audience;
        this.error = new OAuth2Error("invalid_token", "JWT does not contain the required audience", null);
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        return token.getAudience().contains(audience)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(error);
    }
}
