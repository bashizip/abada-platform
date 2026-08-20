package com.abada.engine.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;

@Configuration
public class SecurityConfig {
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http,
            @Value("${abada.security.mode:disabled}") String mode, ObjectMapper objectMapper) throws Exception {
        http.csrf(csrf -> csrf.disable())
                .cors(cors -> {})
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint(ApiSecurityHandlers.authenticationEntryPoint(objectMapper))
                        .accessDeniedHandler(ApiSecurityHandlers.accessDeniedHandler(objectMapper)));

        if ("oidc".equalsIgnoreCase(mode)) {
            authorize(http);
            http.oauth2ResourceServer(oauth2 -> oauth2
                    .authenticationEntryPoint(ApiSecurityHandlers.authenticationEntryPoint(objectMapper))
                    .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())));
        } else if ("proxy".equalsIgnoreCase(mode)) {
            authorize(http);
            http.addFilterBefore(new ProxyHeaderAuthenticationFilter(objectMapper), AnonymousAuthenticationFilter.class);
        } else {
            // "disabled" is restricted to local and automated test profiles.
            http.authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        }
        return http.build();
    }

    private void authorize(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth
                .requestMatchers("/v1", "/v1/info", "/actuator/health", "/actuator/health/**", "/swagger-ui/**", "/swagger-ui.html",
                        "/v3/api-docs/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/v1/projects")
                        .hasAnyAuthority("SCOPE_project:create", AbadaRoles.PROJECT_CREATOR, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.POST, "/v1/projects/*/documents/*/deploy")
                        .hasAnyAuthority("SCOPE_process:deploy", AbadaRoles.DEPLOYER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.POST, "/v1/projects/*/authoring/generate").authenticated()
                .requestMatchers(HttpMethod.POST, "/v1/projects/*/processes/*/start")
                        .hasAnyAuthority("SCOPE_process:control", AbadaRoles.PROCESS_CONTROLLER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.POST, "/v1/projects/*/events/**")
                        .hasAnyAuthority("SCOPE_process:control", AbadaRoles.PROCESS_CONTROLLER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.GET, "/v1/projects/*/tasks/**")
                        .hasAnyAuthority("SCOPE_task:read", AbadaRoles.TASK_USER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.POST, "/v1/projects/*/tasks/**")
                        .hasAnyAuthority("SCOPE_task:write", AbadaRoles.TASK_USER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.GET, "/v1/projects/*/instances/**")
                        .hasAnyAuthority("SCOPE_operations:read", AbadaRoles.OPERATOR, AbadaRoles.ADMIN)
                .requestMatchers("/v1/projects/*/instances/**")
                        .hasAnyAuthority("SCOPE_operations:write", AbadaRoles.OPERATOR, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.GET, "/v1/projects/*/jobs/**")
                        .hasAnyAuthority("SCOPE_operations:read", AbadaRoles.OPERATOR, AbadaRoles.ADMIN)
                .requestMatchers("/v1/projects/*/jobs/**")
                        .hasAnyAuthority("SCOPE_operations:write", AbadaRoles.OPERATOR, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.GET, "/v1/projects/*/insight/**")
                        .hasAnyAuthority("SCOPE_insight:read", AbadaRoles.INSIGHT_REVIEWER,
                                AbadaRoles.OPERATOR, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.POST, "/v1/projects/*/insight/proposals/*/reviews")
                        .hasAnyAuthority("SCOPE_insight:review", AbadaRoles.INSIGHT_REVIEWER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.PUT, "/v1/projects/*/insight/policies/**")
                        .hasAnyAuthority("SCOPE_insight:configure", AbadaRoles.ADMIN)
                .requestMatchers("/v1/projects/**").authenticated()
                .requestMatchers(HttpMethod.POST, "/v1/processes/deploy")
                        .hasAnyAuthority("SCOPE_process:deploy", AbadaRoles.DEPLOYER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.POST, "/v1/processes/start", "/v1/processes/instance/*/fail",
                        "/v1/events/**")
                        .hasAnyAuthority("SCOPE_process:control", AbadaRoles.PROCESS_CONTROLLER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.GET, "/v1/processes/**")
                        .hasAnyAuthority("SCOPE_process:read", AbadaRoles.TASK_USER, AbadaRoles.PROCESS_CONTROLLER,
                                AbadaRoles.OPERATOR, AbadaRoles.DEPLOYER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.GET, "/v1/tasks/**")
                        .hasAnyAuthority("SCOPE_task:read", AbadaRoles.TASK_USER, AbadaRoles.ADMIN)
                .requestMatchers("/v1/tasks/**")
                        .hasAnyAuthority("SCOPE_task:write", AbadaRoles.TASK_USER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.GET, "/v1/jobs/**", "/v1/process-instances/**")
                        .hasAnyAuthority("SCOPE_operations:read", AbadaRoles.OPERATOR, AbadaRoles.ADMIN)
                .requestMatchers("/v1/jobs/**", "/v1/process-instances/**")
                        .hasAnyAuthority("SCOPE_operations:write", AbadaRoles.OPERATOR, AbadaRoles.ADMIN)
                .requestMatchers("/v1/external-tasks/**", "/v1/workers/**")
                        .hasAnyAuthority("SCOPE_worker:execute", AbadaRoles.WORKER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.GET, "/v1/insight/config/**", "/v1/insight/proposals/**",
                        "/v1/insight/policies/**")
                        .hasAnyAuthority("SCOPE_insight:read", AbadaRoles.INSIGHT_REVIEWER,
                                AbadaRoles.OPERATOR, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.POST, "/v1/insight/proposals/*/reviews")
                        .hasAnyAuthority("SCOPE_insight:review", AbadaRoles.INSIGHT_REVIEWER, AbadaRoles.ADMIN)
                .requestMatchers(HttpMethod.PUT, "/v1/insight/policies/**")
                        .hasAnyAuthority("SCOPE_insight:configure", AbadaRoles.ADMIN)
                .requestMatchers("/v1/admin/**")
                        .hasAnyAuthority(AbadaRoles.ADMIN)
                .anyRequest().denyAll());
    }

    @Bean
    JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter scopes = new JwtGrantedAuthoritiesConverter();
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setPrincipalClaimName("preferred_username");
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            var authorities = new java.util.ArrayList<>(scopes.convert(jwt));
            java.util.List<String> groups = jwt.getClaimAsStringList("groups");
            if (groups != null) {
                groups.stream().map(AbadaRoles::fromGroup).filter(java.util.Objects::nonNull)
                        .map(org.springframework.security.core.authority.SimpleGrantedAuthority::new)
                        .forEach(authorities::add);
            }
            return authorities;
        });
        return converter;
    }
}
