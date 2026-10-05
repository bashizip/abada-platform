package com.abada.engine.parser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.core.model.DelegationMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/** E20b: an agent's {@code delegates}, the processes it may start through {@code delegate:<process>}. */
class AplDelegationParserTest {
    private final AplParser parser = new AplParser();

    @Test
    void delegatesAreParsedWithTheirOutputsAndApproval() throws Exception {
        ParsedProcessDefinition definition = parser.parse(
                Files.readAllBytes(Path.of("src/test/resources/apl/agent-delegation.apl.yaml")));
        assertThat(definition.getDelegations("triage")).singleElement().satisfies(delegate -> {
            assertThat(delegate.process()).isEqualTo("refund_payout");
            assertThat(delegate.toolRef()).isEqualTo("delegate:refund_payout");
            assertThat(delegate.outputs()).containsExactly("payout_id");
            assertThat(delegate.approvalRequired()).isFalse();
            assertThat(delegate.targetKey()).isEqualTo("triage#delegate:refund_payout");
        });

        ParsedProcessDefinition approved = parser.parse(bytes(agent("""
                        - { process: large_payout, outputs: [payout_id], approval: required, approvers: [finance], max_depth: 2 }
                """)));
        DelegationMeta delegate = approved.getDelegations("pick").getFirst();
        assertThat(delegate.approvalRequired()).isTrue();
        assertThat(delegate.approvers()).containsExactly("finance");
        assertThat(delegate.maxDepth()).isEqualTo(2);
    }

    @Test
    void malformedDelegatesAreRejectedAtTheirPath() {
        assertInvalid(agent("""
                        - { process: payout }
                """), "declares no outputs");
        assertInvalid(agent("""
                        - { process: Payout!, outputs: [x] }
                """), "the key of a process");
        assertInvalid(agent("""
                        - { process: routed, outputs: [x] }
                """), "its own process");
        assertInvalid(agent("""
                        - { process: payout, outputs: [x] }
                        - { process: payout, outputs: [y] }
                """), "more than once");
        assertInvalid(agent("""
                        - { process: payout, outputs: [x], approval: maybe }
                """), "'required' or 'none'");
        assertInvalid(agent("""
                        - { process: payout, outputs: [x], approvers: [finance] }
                """), "approval is 'none'");
        assertThatThrownBy(() -> parser.parse(bytes(agent("""
                        - { process: payout, outputs: [x], approval: required }
                """)))).isInstanceOfSatisfying(BpmnValidationException.class, error ->
                assertThat(error.getIssues()).extracting(BpmnValidationIssue::code, BpmnValidationIssue::path)
                        .contains(org.assertj.core.groups.Tuple.tuple("ABADA-APL-TOOL-003",
                                "/flow/nodes/1/delegates/0/approvers")));
    }

    private void assertInvalid(String source, String message) {
        assertThatThrownBy(() -> parser.parse(bytes(source))).isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining(message);
    }

    private static String agent(String delegates) {
        return """
                version: abada.io/v1
                metadata: { key: routed, name: Routed }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: pick }
                    - id: pick
                      type: agent
                      model: gemini-3.6-flash
                      prompt: Choose
                      delegates:
                %s
                      next: done
                    - { id: done, type: end }
                """.formatted(delegates.stripTrailing());
    }

    private static byte[] bytes(String source) {
        return source.getBytes(StandardCharsets.UTF_8);
    }
}
