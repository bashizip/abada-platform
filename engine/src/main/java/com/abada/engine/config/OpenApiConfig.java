package com.abada.engine.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

        @Value("${spring.application.version:1.0.0-rc.5}")
        private String appVersion;

        @Value("${spring.application.name:Abada Engine}")
        private String appName;

        @Bean
        public OpenAPI abadaEngineOpenAPI() {
                Schema<?> errorSchema = new ObjectSchema()
                                .description("Machine-readable API error")
                                .addProperty("timestamp", new StringSchema().format("date-time"))
                                .addProperty("status", new IntegerSchema().format("int32"))
                                .addProperty("code", new StringSchema())
                                .addProperty("message", new StringSchema())
                                .addProperty("path", new StringSchema())
                                .addProperty("traceId", new StringSchema())
                                .addProperty("details", new ObjectSchema());
                return new OpenAPI()
                                .components(new Components()
                                                .addSchemas("ApiError", errorSchema)
                                                .addSecuritySchemes("bearer-jwt", new SecurityScheme()
                                                                .type(SecurityScheme.Type.HTTP)
                                                                .scheme("bearer")
                                                                .bearerFormat("JWT")))
                                .info(new Info()
                                                .title(appName + " API")
                                                .description("High-performance, modular BPMN 2.0 process automation engine.")
                                                .version(appVersion)
                                                .contact(new Contact()
                                                                .name("Abada Platform")
                                                                .url("https://github.com/bashizip/abada-engine"))
                                                .license(new License()
                                                                .name("MIT")
                                                                .url("https://opensource.org/licenses/MIT")));
        }

        @Bean
        public OpenApiCustomizer stableErrorResponses() {
                return openApi -> openApi.getPaths().values().forEach(path -> path.readOperations().forEach(operation -> {
                        addError(operation, "400", "Invalid request or rejected command");
                        addError(operation, "401", "Authentication required");
                        addError(operation, "403", "Permission denied");
                        addError(operation, "404", "Resource not found");
                        addError(operation, "409", "Concurrent or idempotency conflict");
                        addError(operation, "500", "Internal error");
                }));
        }

        private void addError(io.swagger.v3.oas.models.Operation operation, String status, String description) {
                operation.getResponses().putIfAbsent(status, new ApiResponse().description(description)
                                .content(new Content().addMediaType(org.springframework.http.MediaType.APPLICATION_JSON_VALUE,
                                                new MediaType().schema(new Schema<>().$ref("#/components/schemas/ApiError")))));
        }
}
