package com.abada.engine.security;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiErrors;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;

public final class ApiSecurityHandlers {
    private ApiSecurityHandlers() {}

    public static AuthenticationEntryPoint authenticationEntryPoint(ObjectMapper objectMapper) {
        return (request, response, exception) -> write(objectMapper, request, response,
                HttpStatus.UNAUTHORIZED, ApiErrorCode.AUTHENTICATION_REQUIRED,
                "A valid access token or trusted-proxy identity is required");
    }

    public static AccessDeniedHandler accessDeniedHandler(ObjectMapper objectMapper) {
        return accessDeniedHandler(objectMapper, null);
    }

    /** As above, and records a refused administrative call in the administration audit trail (S10). */
    public static AccessDeniedHandler accessDeniedHandler(ObjectMapper objectMapper,
            com.abada.engine.audit.AdminAuditRecorder audit) {
        return (request, response, exception) -> {
            if (audit != null) audit.deniedIfAdministrative(request, ApiErrorCode.ACCESS_DENIED.name());
            write(objectMapper, request, response,
                    HttpStatus.FORBIDDEN, ApiErrorCode.ACCESS_DENIED,
                    "The authenticated identity does not have permission for this operation");
        };
    }

    public static void write(ObjectMapper objectMapper, HttpServletRequest request, HttpServletResponse response,
            HttpStatus status, ApiErrorCode code, String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), ApiErrors.response(status, code, message, request));
    }
}
