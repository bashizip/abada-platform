package com.abada.engine.dto;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ProcessDefinitionDtoTest {
    private static final String REPORT = """
            {"detectedProfiles":["abada-native"],"mappings":[],"issues":[{"code":"ABADA-APL-SCHEMA-001",
            "severity":"WARNING","message":"/flow/nodes/1/retries: unknown field 'retries' is ignored by the engine",
            "elementId":"work","namespace":"abada.io/v1","path":"/flow/nodes/1/retries"}]}""";

    @Test
    void deploymentResponseCarriesTheRecordedWarnings() {
        var issues = ProcessDefinitionDto.deployed(entity(REPORT)).validationIssues();
        assertThat(issues).singleElement().satisfies(issue -> {
            assertThat(issue.severity()).isEqualTo(ValidationSeverity.WARNING);
            assertThat(issue.elementId()).isEqualTo("work");
            assertThat(issue.path()).isEqualTo("/flow/nodes/1/retries");
        });
    }

    @Test
    void listingsOmitTheField() throws Exception {
        String json = new ObjectMapper().findAndRegisterModules()
                .writeValueAsString(ProcessDefinitionDto.from(entity(REPORT)));
        assertThat(json).doesNotContain("validationIssues");
    }

    private static ProcessDefinitionEntity entity(String report) {
        ProcessDefinitionEntity entity = new ProcessDefinitionEntity();
        entity.setProcessKey("warned");
        entity.setCompatibilityReport(report);
        return entity;
    }
}
