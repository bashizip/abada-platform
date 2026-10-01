package com.abada.engine.parser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

class AplVariablesTest {
    private final AplParser parser = new AplParser();

    @Test
    void withoutDeclarationsTheIdentifierCheckIsSkipped() {
        assertThat(variableWarnings(document("", """
                    - id: gate
                      type: condition
                      rules:
                        - if: "${riskScore > 80}"
                          then: done
                        - else: done
                """))).isEmpty();
    }

    @Test
    void declaredStartPayloadVariablesResolve() {
        assertThat(variableWarnings(document("""
                  variables:
                    - name: riskScore
                      type: number
                      required: true
                """, """
                    - id: gate
                      type: condition
                      rules:
                        - if: "${riskScore > 80}"
                          then: done
                        - else: done
                """))).isEmpty();
    }

    @Test
    void upstreamAgentResultAndDecisionOutputsResolve() {
        assertThat(variableWarnings(document("""
                  variables:
                    - name: lead
                      type: object
                """, """
                    - id: score
                      type: agent
                      prompt: Score ${lead.company}
                      result_variable: scoring
                      next: tier
                    - id: tier
                      type: decision-table
                      inputs:
                        - name: score
                          expr: scoring.value
                      rules:
                        - when: score > 80
                          then: { tierName: GOLD }
                        - otherwise: { then: { tierName: STANDARD } }
                      next: gate
                    - id: gate
                      type: condition
                      rules:
                        - if: "${tierName == 'GOLD' && score_outcome == 'OK'}"
                          then: done
                        - else: done
                """))).isEmpty();
    }

    @Test
    void variableWrittenOnlyDownstreamIsReportedWithItsLocation() {
        List<BpmnValidationIssue> warnings = variableWarnings(document("""
                  variables:
                    - name: lead
                """, """
                    - id: gate
                      type: condition
                      rules:
                        - if: "${scoring.value > 80}"
                          then: score
                        - else: score
                    - id: score
                      type: agent
                      prompt: Score ${lead}
                      result_variable: scoring
                      next: done
                """));
        assertThat(warnings).singleElement().satisfies(issue -> {
            assertThat(issue.elementId()).isEqualTo("gate");
            assertThat(issue.path()).isEqualTo("/flow/nodes/1");
            assertThat(issue.message()).contains("'scoring'").contains("metadata.variables");
        });
    }

    @Test
    void decisionRuleReadingANonInputIsReportedEvenWithoutDeclarations() {
        assertThat(variableWarnings(document("", """
                    - id: tier
                      type: decision-table
                      inputs:
                        - name: score
                      rules:
                        - when: amount > 80
                          then: { tierName: GOLD }
                        - otherwise: true
                          then: { tierName: STANDARD }
                      next: done
                """))).singleElement().satisfies(issue -> {
            assertThat(issue.path()).isEqualTo("/flow/nodes/1/rules/0/when");
            assertThat(issue.message()).contains("'amount'").contains("not one of the table inputs");
        });
    }

    @Test
    void invalidDeclarationsAreErrors() {
        assertThatThrownBy(() -> parser.parseDetailed(document("""
                  variables:
                    - name: lead
                    - name: lead
                    - name: total
                      type: money
                """, """
                    - id: work
                      type: engine-task
                      service: crm
                      next: done
                """)))
                .isInstanceOf(BpmnValidationException.class)
                .satisfies(error -> assertThat(((BpmnValidationException) error).getIssues())
                        .filteredOn(issue -> issue.severity() == ValidationSeverity.ERROR)
                        .extracting(BpmnValidationIssue::path)
                        .containsExactly("/metadata/variables/1/name", "/metadata/variables/2/type"));
    }

    private List<BpmnValidationIssue> variableWarnings(byte[] source) {
        return parser.parseDetailed(source).report().issues().stream()
                .filter(issue -> AplVariables.VARIABLE_CODE.equals(issue.code())).toList();
    }

    private static byte[] document(String metadataExtra, String middleNodes) {
        String first = middleNodes.strip().lines().findFirst().orElseThrow().replace("- id:", "").strip();
        return ("""
                version: abada.io/v1
                metadata:
                  key: variables
                  name: Variables
                %sflow:
                  entry: start
                  nodes:
                    - id: start
                      type: webhook
                      next: %s
                %s    - id: done
                      type: end
                """.formatted(metadataExtra, first, middleNodes)).getBytes(StandardCharsets.UTF_8);
    }
}
