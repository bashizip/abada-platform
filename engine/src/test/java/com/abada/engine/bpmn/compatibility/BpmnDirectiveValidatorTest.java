package com.abada.engine.bpmn.compatibility;

import com.abada.engine.parser.BpmnParser;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BpmnDirectiveValidatorTest {
    @Test void rejectsUnknownExecutionRelevantCamundaDirective() {
        assertThatThrownBy(() -> parse("camunda:delegateExpression=\"${worker}\"", BpmnParseOptions.defaults()))
                .isInstanceOf(BpmnValidationException.class)
                .satisfies(error -> assertThat(((BpmnValidationException) error).getIssues())
                        .extracting(BpmnValidationIssue::code).contains(BpmnErrorCodes.UNSUPPORTED_EXTENSION));
    }

    @Test void acceptsFormKeyAsSupportedMetadataDirective() {
        var result = parse("camunda:formKey=\"approval\"", BpmnParseOptions.defaults());
        assertThat(result.report().issues()).isEmpty();

        // Strict mode must no longer reject the form key: it maps to the
        // canonical task formKey used by the Studio and task clients.
        var strict = parse("camunda:formKey=\"approval\"",
                new BpmnParseOptions(List.of(CompatibilityProfiles.STANDARD, CompatibilityProfiles.CAMUNDA_7), true, true));
        assertThat(strict.report().issues()).isEmpty();
    }

    @Test void stillRejectsUnknownExecutionRelevantCamundaDirectiveInStrictMode() {
        assertThatThrownBy(() -> parse("camunda:asyncBefore=\"true\"",
                new BpmnParseOptions(List.of(CompatibilityProfiles.STANDARD, CompatibilityProfiles.CAMUNDA_7), true, true)))
                .isInstanceOf(BpmnValidationException.class);
    }

    private BpmnParseResult parse(String directive, BpmnParseOptions options) {
        String xml = """
            <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
              xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="test">
              <bpmn:process id="p"><bpmn:startEvent id="s"/><bpmn:userTask id="t" %s/><bpmn:endEvent id="e"/>
              <bpmn:sequenceFlow id="a" sourceRef="s" targetRef="t"/><bpmn:sequenceFlow id="b" sourceRef="t" targetRef="e"/>
              </bpmn:process></bpmn:definitions>
            """.formatted(directive);
        return new BpmnParser().parseDetailed(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)), options);
    }
}
