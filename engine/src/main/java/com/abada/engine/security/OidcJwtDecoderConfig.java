package com.abada.engine.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/** Builds the direct OIDC decoder with issuer and API-audience validation. */
@Configuration
@ConditionalOnProperty(name = "abada.security.mode", havingValue = "oidc")
public class OidcJwtDecoderConfig {

    @Bean
    @ConditionalOnMissingBean(JwtDecoder.class)
    JwtDecoder oidcJwtDecoder(
            @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri}") String issuer,
            @Value("${abada.security.audience}") String audience,
            @Value("${abada.security.jwk-set-uri:}") String jwkSetUri) {
        NimbusJwtDecoder decoder = jwkSetUri == null || jwkSetUri.isBlank()
                ? NimbusJwtDecoder.withIssuerLocation(issuer).build()
                : NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(issuer), new AudienceValidator(audience)));
        return decoder;
    }
}
