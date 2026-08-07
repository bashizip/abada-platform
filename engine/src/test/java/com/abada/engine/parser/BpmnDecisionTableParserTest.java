package com.abada.engine.parser;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.core.model.DecisionTableMeta;
import com.abada.engine.util.BpmnTestUtils;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BpmnDecisionTableParserTest {

    @Test
    @DisplayName("parses a native abada:decisionTable on a businessRuleTask")
    void parsesNativeDecisionTable() {
        var definition = BpmnTestUtils.parse("decision-table-test.bpmn");

        assertThat(definition.isDecisionTable("CreditRules")).isTrue();
        DecisionTableMeta table = definition.getDecisionTable("CreditRules");
        assertThat(table.decisionKey()).isEqualTo("DMN_CREDIT_RISK_V1");
        assertThat(table.hitPolicy()).isEqualTo("FIRST");
        assertThat(table.inputs()).extracting(DecisionTableMeta.DecisionTableInput::name)
                .containsExactly("score", "income");
        assertThat(table.inputs().get(0).expr()).isEqualTo("${applicant.creditScore}");
        assertThat(table.rules()).hasSize(3);
        assertThat(table.rules()).filteredOn(rule -> rule.otherwise()).hasSize(1);
        assertThat(table.rules().get(0).then()).containsEntry("riskLevel", "LOW").containsEntry("autoApprove", true);
        assertThat(table.rules().get(2).then()).containsEntry("riskLevel", "HIGH");
    }

    @Test
    @DisplayName("rejects a businessRuleTask without the abada:decisionTable extension")
    void rejectsBusinessRuleTaskWithoutExtension() {
        String xml = process("""
                <bpmn:businessRuleTask id="rules" name="Rules" />""");

        assertThatThrownBy(() -> parse(xml))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("requires a native abada:decisionTable extension");
    }

    @Test
    @DisplayName("rejects an unsupported hitPolicy")
    void rejectsUnsupportedHitPolicy() {
        String xml = process("""
                <bpmn:businessRuleTask id="rules" name="Rules">
                  <bpmn:extensionElements>
                    <abada:decisionTable decisionKey="DT_1" hitPolicy="PRIORITY">
                      <abada:rule otherwise="true"><abada:output name="ok" value="true" /></abada:rule>
                    </abada:decisionTable>
                  </bpmn:extensionElements>
                </bpmn:businessRuleTask>""");

        assertThatThrownBy(() -> parse(xml))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("unsupported hitPolicy 'PRIORITY'");
    }

    @Test
    @DisplayName("rejects a rule with neither when nor otherwise")
    void rejectsRuleWithoutCondition() {
        String xml = process("""
                <bpmn:businessRuleTask id="rules" name="Rules">
                  <bpmn:extensionElements>
                    <abada:decisionTable decisionKey="DT_1" hitPolicy="FIRST">
                      <abada:rule><abada:output name="ok" value="true" /></abada:rule>
                    </abada:decisionTable>
                  </bpmn:extensionElements>
                </bpmn:businessRuleTask>""");

        assertThatThrownBy(() -> parse(xml))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("neither a 'when' condition");
    }

    @Test
    @DisplayName("rejects more than one otherwise rule")
    void rejectsMultipleOtherwiseRules() {
        String xml = process("""
                <bpmn:businessRuleTask id="rules" name="Rules">
                  <bpmn:extensionElements>
                    <abada:decisionTable decisionKey="DT_1" hitPolicy="FIRST">
                      <abada:rule otherwise="true"><abada:output name="a" value="1" /></abada:rule>
                      <abada:rule otherwise="true"><abada:output name="b" value="2" /></abada:rule>
                    </abada:decisionTable>
                  </bpmn:extensionElements>
                </bpmn:businessRuleTask>""");

        assertThatThrownBy(() -> parse(xml))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("more than one otherwise rule");
    }

    @Test
    @DisplayName("coerces output values to boolean and numbers")
    void coercesOutputValues() {
        String xml = process("""
                <bpmn:businessRuleTask id="rules" name="Rules">
                  <bpmn:extensionElements>
                    <abada:decisionTable decisionKey="DT_1" hitPolicy="FIRST">
                      <abada:rule otherwise="true">
                        <abada:output name="approved" value="true" />
                        <abada:output name="limit" value="250000" />
                        <abada:output name="label" value="21%" />
                      </abada:rule>
                    </abada:decisionTable>
                  </bpmn:extensionElements>
                </bpmn:businessRuleTask>""");

        var definition = parse(xml);
        var then = definition.getDecisionTable("rules").rules().get(0).then();
        assertThat(then.get("approved")).isEqualTo(Boolean.TRUE);
        assertThat(then.get("limit")).isEqualTo(250000L);
        assertThat(then.get("label")).isEqualTo("21%");
    }

    private static com.abada.engine.core.model.ParsedProcessDefinition parse(String xml) {
        return new BpmnParser().parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
    }

    /** Wraps a businessRuleTask fragment in a minimal deployable process. */
    private static String process(String ruleTaskXml) {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:abada="https://abada.io/schema/bpmn" id="Definitions_DT" targetNamespace="http://bpmn.io/schema/bpmn">
                  <bpmn:process id="DecisionProcess" isExecutable="true">
                    <bpmn:startEvent id="StartEvent_1"><bpmn:outgoing>Flow_Start_Rules</bpmn:outgoing></bpmn:startEvent>
                    %s
                    <bpmn:endEvent id="EndEvent_1"><bpmn:incoming>Flow_Rules_End</bpmn:incoming></bpmn:endEvent>
                    <bpmn:sequenceFlow id="Flow_Start_Rules" sourceRef="StartEvent_1" targetRef="rules" />
                    <bpmn:sequenceFlow id="Flow_Rules_End" sourceRef="rules" targetRef="EndEvent_1" />
                  </bpmn:process>
                </bpmn:definitions>
                """.formatted(ruleTaskXml);
    }
}
