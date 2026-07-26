package com.abada.engine.api;

import com.abada.engine.dto.InfoResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/info")
public class InfoController {

    private static final String DESCRIPTION =
            "Open-source, self-hosted BPMN 2.0 workflow orchestration engine";
    private static final String SERVICE_NAME = "abada-engine";

    private final String appVersion;
    private final String contextPath;

    public InfoController(
            @Value("${spring.application.version}") String appVersion,
            @Value("${server.servlet.context-path:}") String contextPath) {
        this.appVersion = appVersion;
        this.contextPath = normalizeContextPath(contextPath);
    }

    @GetMapping
    public InfoResponse info() {
        return new InfoResponse(
                "Abada Engine",
                SERVICE_NAME,
                DESCRIPTION,
                appVersion,
                new InfoResponse.Api(
                        "v1",
                        endpoint("/v3/api-docs"),
                        endpoint("/swagger-ui.html")),
                new InfoResponse.Engine(
                        "BPMN 2.0",
                        "documented-subset",
                        "PostgreSQL"),
                new InfoResponse.Health(
                        endpoint("/actuator/health/liveness"),
                        endpoint("/actuator/health/readiness")));
    }

    private String endpoint(String path) {
        return contextPath + path;
    }

    private static String normalizeContextPath(String path) {
        if (path == null || path.isBlank() || "/".equals(path)) {
            return "";
        }
        String normalized = path.startsWith("/") ? path : "/" + path;
        return normalized.endsWith("/")
                ? normalized.substring(0, normalized.length() - 1)
                : normalized;
    }
}
