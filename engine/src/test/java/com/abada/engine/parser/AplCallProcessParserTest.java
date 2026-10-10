package com.abada.engine.parser;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.abada.engine.core.model.BoundaryMeta;
import com.abada.engine.core.model.CallProcessMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** E20a: the {@code call-process} node. */
class AplCallProcessParserTest {
    private final AplParser parser = new AplParser();

    @Test
    void compilesACallWithInputsOutputsDepthAndBoundaries() {
        var result = parser.parseDetailed(document("""
                    - id: check
                      type: call-process
                      process: fraud_check
                      inputs: { case_id: "${case_id}", amount: "${amount * 2}" }
                      outputs: { fraud_verdict: verdict }
                      max_depth: 2
                      on_error: manual
                      on_timeout: { after: PT1H, then: manual }
                      next: pay
                """));
        ParsedProcessDefinition definition = result.definition();
        CallProcessMeta call = definition.getCallProcess("check");
        assertThat(call.processKey()).isEqualTo("fraud_check");
        assertThat(call.inputs()).containsExactly(Map.entry("case_id", "${case_id}"),
                Map.entry("amount", "${amount * 2}"));
        assertThat(call.outputs()).containsExactly(Map.entry("fraud_verdict", "verdict"));
        assertThat(call.maxDepth()).isEqualTo(2);
        assertThat(definition.boundariesOf("check")).extracting(BoundaryMeta::kind)
                .containsExactly(BoundaryMeta.Kind.ERROR, BoundaryMeta.Kind.TIMEOUT);
        // The output is a written variable: reading it downstream raises no unknown-identifier warning.
        assertThat(result.report().issues()).noneMatch(issue -> issue.message().contains("fraud_verdict"));
    }

    @Test
    void rejectsIncompleteOrUnsafeCallsAtTheirPath() {
        assertThat(errors("""
                    - { id: check, type: call-process, outputs: { v: verdict }, next: pay }
                """)).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/process");
        assertThat(errors("""
                    - { id: check, type: call-process, process: parent_flow, outputs: { v: verdict }, next: pay }
                """)).singleElement().satisfies(issue -> {
                    assertThat(issue.path()).isEqualTo("/flow/nodes/1/process");
                    assertThat(issue.message()).contains("its own process");
                });
        assertThat(errors("""
                    - { id: check, type: call-process, process: fraud_check, next: pay }
                """)).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/outputs");
        assertThat(errors("""
                    - { id: check, type: call-process, process: fraud_check, outputs: { v: "a.b" }, next: pay }
                """)).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/outputs/v");
        assertThat(errors("""
                    - id: check
                      type: call-process
                      process: fraud_check
                      inputs: { case_id: "${case_id +}" }
                      outputs: { v: verdict }
                      next: pay
                """)).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/inputs/case_id");
        assertThat(errors("""
                    - { id: check, type: call-process, process: fraud_check, outputs: { v: verdict }, max_depth: 11, next: pay }
                """)).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/max_depth");
        assertThat(errors("""
                    - { id: check, type: call-process, process: fraud_check, outputs: { v: verdict } }
                """)).extracting(BpmnValidationIssue::path).containsExactly("/flow/nodes/1/next");
    }

    private List<BpmnValidationIssue> errors(String nodes) {
        try {
            parser.parseDetailed(document(nodes));
        } catch (BpmnValidationException exception) {
            return exception.getIssues().stream()
                    .filter(issue -> issue.severity() == ValidationSeverity.ERROR).toList();
        }
        return org.junit.jupiter.api.Assertions.fail("expected a validation error");
    }

    private static byte[] document(String nodes) {
        return ("""
                version: abada.io/v1
                metadata:
                  key: parent_flow
                  name: Parent flow
                  variables:
                    - { name: case_id, type: string }
                    - { name: amount, type: number }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: check }
                """ + nodes + """
                    - id: pay
                      type: condition
                      rules:
                        - { if: "${fraud_verdict == 'clean'}", then: done }
                      else: manual
                    - { id: manual, type: human-input, assignees: [finance], next: done }
                    - { id: done, type: end }
                """).getBytes(StandardCharsets.UTF_8);
    }
}
