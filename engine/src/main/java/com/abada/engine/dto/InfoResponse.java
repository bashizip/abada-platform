package com.abada.engine.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "InfoResponse", description = "Public service metadata and discovery links")
public record InfoResponse(
        @Schema(description = "Human-readable product name", example = "Abada Engine")
        String name,
        @Schema(description = "Stable service identifier", example = "abada-engine")
        String service,
        @Schema(
                description = "Short product description",
                example = "Open-source, self-hosted BPMN 2.0 workflow orchestration engine")
        String description,
        @Schema(description = "Running engine release", example = "1.0.0-rc.3")
        String version,
        Api api,
        Engine engine,
        Health health) {

    @Schema(description = "API contract and documentation links")
    public record Api(
            @Schema(description = "Public REST API version", example = "v1")
            String version,
            @Schema(description = "OpenAPI document path", example = "/api/v3/api-docs")
            String openApi,
            @Schema(description = "Interactive API documentation path", example = "/api/swagger-ui.html")
            String swaggerUi) {}

    @Schema(description = "Workflow-engine contract")
    public record Engine(
            @Schema(description = "Process notation interpreted by the engine", example = "BPMN 2.0")
            String standard,
            @Schema(
                    description = "Support boundary; see the BPMN support contract for exact semantics",
                    example = "documented-subset")
            String supportLevel,
            @Schema(description = "Authoritative production persistence store", example = "PostgreSQL")
            String persistence) {}

    @Schema(description = "Operational probe links; probe responses are authoritative for health")
    public record Health(
            @Schema(description = "Liveness probe path", example = "/api/actuator/health/liveness")
            String liveness,
            @Schema(description = "Readiness probe path", example = "/api/actuator/health/readiness")
            String readiness) {}
}
