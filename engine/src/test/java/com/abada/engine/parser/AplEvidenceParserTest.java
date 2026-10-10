package com.abada.engine.parser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.core.model.ParsedProcessDefinition;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** E11: {@code sensitive} variables and an agent's {@code evidence} override. */
class AplEvidenceParserTest {
    private final AplParser parser = new AplParser();

    @Test
    void readsSensitiveVariablesAndTheEvidenceOverride() {
        ParsedProcessDefinition definition = parser.parse(document("{ payloads: none, retention_days: 7 }"));
        assertThat(definition.getSensitiveVariables()).containsExactly("iban");
        assertThat(definition.getEvidenceOverride("triage"))
                .isEqualTo(new ParsedProcessDefinition.EvidenceOverride("none", 7));
        assertThat(parser.parse(document("{ retention_days: 3 }")).getEvidenceOverride("triage"))
                .isEqualTo(new ParsedProcessDefinition.EvidenceOverride(null, 3));
    }

    @Test
    void rejectsAnInvalidOverrideAtItsPath() {
        assertThatThrownBy(() -> parser.parseDetailed(document("{ payloads: everything }")))
                .isInstanceOfSatisfying(BpmnValidationException.class, error -> assertThat(error.getIssues())
                        .anyMatch(issue -> "/flow/nodes/1/evidence/payloads".equals(issue.path())));
        assertThatThrownBy(() -> parser.parseDetailed(document("{ retention_days: 0 }")))
                .isInstanceOfSatisfying(BpmnValidationException.class, error -> assertThat(error.getIssues())
                        .anyMatch(issue -> "/flow/nodes/1/evidence/retention_days".equals(issue.path())));
    }

    private static byte[] document(String evidence) {
        return ("""
                version: abada.io/v1
                metadata:
                  key: evidence_flow
                  name: Evidence flow
                  variables:
                    - { name: iban, type: string, sensitive: true }
                    - { name: amount, type: number }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: triage }
                    - id: triage
                      type: agent
                      model: gemini-3.6-flash
                      prompt: Triage
                      evidence: %s
                      next: done
                    - { id: done, type: end }
                """.formatted(evidence)).getBytes(StandardCharsets.UTF_8);
    }
}
