package com.abada.engine.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.filter.CommonsRequestLoggingFilter;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.beans.factory.annotation.Value;

import java.util.Arrays;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final IdentityContextInterceptor identityContextInterceptor;
    private final String[] allowedOrigins;

    public WebConfig(IdentityContextInterceptor identityContextInterceptor,
            @Value("${abada.security.allowed-origins:http://localhost:5173,http://localhost:5602}") String allowedOrigins) {
        this.identityContextInterceptor = identityContextInterceptor;
        this.allowedOrigins = Arrays.stream(allowedOrigins.split(",")).map(String::trim).toArray(String[]::new);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(identityContextInterceptor);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH")
                .allowedHeaders("Authorization", "Content-Type", "Idempotency-Key", "traceparent", "tracestate",
                        "X-Abada-Worker-Protocol-Version", "If-Match")
                .exposedHeaders("X-Page", "X-Page-Size", "X-Total-Count", "X-Total-Pages",
                        "X-Abada-Worker-Protocol-Version", "ETag")
                .allowCredentials(true);
    }

    /**
     * Logs only the request path and query string. Headers and payloads stay disabled
     * so credentials and workflow variables cannot enter request logs.
     *
     * @return The configured logging filter.
     */
    @Bean
    public CommonsRequestLoggingFilter logFilter() {
        CommonsRequestLoggingFilter filter = new CommonsRequestLoggingFilter();
        filter.setIncludeQueryString(true);
        filter.setIncludePayload(false);
        filter.setIncludeHeaders(false);
        filter.setAfterMessagePrefix("REQUEST DATA : ");
        return filter;
    }
}
