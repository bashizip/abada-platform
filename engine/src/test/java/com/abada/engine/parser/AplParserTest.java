package com.abada.engine.parser;

import com.abada.engine.bpmn.compatibility.BpmnParseResult;
import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.CompatibilityProfiles;
import com.abada.engine.core.model.GatewayMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.core.model.SequenceFlow;
import com.abada.engine.core.model.ServiceTaskMeta;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit-level compilation of native {@code abada.io/v1} APL documents: schema
 * detection, graph compilation, strict rejection of ambiguous constructs, and
 * the condition default-flow rule.
 */
class AplParserTest {

    private final AplParser parser = new AplParser();

    @Test
    void compilesCandidateReviewIntoExecutableGraph() throws IOException {
        ParsedProcessDefinition definition = parse("/apl/candidate-review.apl.yaml");

        assertThat(definition.getId()).isEqualTo("candidate_review");
        assertThat(definition.getName()).isEqualTo("Candidate Review");
        assertThat(definition.getStartEventId()).isEqualTo("apply");

        assertThat(definition.getUserTasks()).containsOnlyKeys("gate");
        assertThat(definition.getServiceTasks()).containsOnlyKeys("notify");
        assertThat(definition.getServiceTasks().get("notify").topicName())
                .isEqualTo(AplParser.AGENT_EXTERNAL_TOPIC);
        assertThat(definition.getServiceTasks().get("notify").agentWork()).satisfies(work -> {
            assertThat(work.profileVersion()).isEqualTo("abada.agent/v1");
            assertThat(work.resultVariable()).isEqualTo("notify_result");
            assertThat(work.maxAttempts()).isEqualTo(4);
            assertThat(work.timeoutMs()).isEqualTo(60_000L);
        });
        assertThat(definition.getDecisionTables()).containsOnlyKeys("score");
        assertThat(definition.getDecisionTables().get("score").hitPolicy()).isEqualTo("FIRST");
        assertThat(definition.getDecisionTables().get("score").rules()).hasSize(2);
        assertThat(definition.getDecisionTables().get("score").rules().get(1).otherwise()).isTrue();
        assertThat(definition.isEndEvent("end")).isTrue();

        assertThat(definition.getSequenceFlows()).extracting(SequenceFlow::getSourceRef)
                .containsExactly("apply", "score", "gate", "notify");
    }

@Test
    void lastRuleBecomesTheDefaultFlowWhenNoElseIsDeclared() {
        ParsedProcessDefinition definition = parser.parseDetailed(standardFlow(
                "    - id: route\n"
                        + "      type: condition\n"
                        + "      rules:\n"
                        + "        - if: rating == \"gold\"\n"
                        + "          then: goldDesk\n"
                        + "        - if: rating == \"silver\"\n"
                        + "          then: silverDesk\n"
                        + "    - id: goldDesk\n      type: engine-task\n      service: abada:g\n      next: end\n"
                        + "    - id: silverDesk\n      type: engine-task\n      service: abada:s\n      next: end\n")
                .getBytes(StandardCharsets.UTF_8)).definition();

        GatewayMeta gateway = definition.getGateways().get("route");
        assertThat(gateway).isNotNull();
        assertThat(gateway.defaultFlowId()).isNotBlank();

        SequenceFlow defaultFlow = definition.getSequenceFlows().stream()
                .filter(flow -> flow.getId().equals(gateway.defaultFlowId()))
                .findFirst().orElseThrow();
        assertThat(defaultFlow.getTargetRef()).isEqualTo("silverDesk");
        assertThat(defaultFlow.isDefault()).isTrue();
    }

    @Test
    void explicitElseRuleWinsOverTheLastRule() {
        ParsedProcessDefinition definition = parser.parseDetailed(standardFlow(
                "    - id: route\n"
                        + "      type: condition\n"
                        + "      rules:\n"
                        + "        - if: rating == \"gold\"\n"
                        + "          then: goldDesk\n"
                        + "        - else: true\n"
                        + "          then: basicDesk\n"
                        + "        - if: rating == \"silver\"\n"
                        + "          then: silverDesk\n"
                        + "    - id: goldDesk\n      type: engine-task\n      service: abada:g\n      next: end\n"
                        + "    - id: silverDesk\n      type: engine-task\n      service: abada:s\n      next: end\n"
                        + "    - id: basicDesk\n      type: engine-task\n      service: abada:b\n      next: end\n")
                .getBytes(StandardCharsets.UTF_8)).definition();

        GatewayMeta gateway = definition.getGateways().get("route");
        SequenceFlow defaultFlow = definition.getSequenceFlows().stream()
                .filter(flow -> flow.getId().equals(gateway.defaultFlowId()))
                .findFirst().orElseThrow();
        assertThat(defaultFlow.getTargetRef()).isEqualTo("basicDesk");
        assertThat(defaultFlow.isDefault()).isTrue();
    }

    @Test
    void engineTaskUsesDeclaredServiceTopic() throws IOException {
        ParsedProcessDefinition definition = parse("/apl/condition-router.apl.yaml");

        ServiceTaskMeta goldTier = definition.getServiceTasks().get("goldDesk");
        assertThat(goldTier.topicName()).isEqualTo("abada:gold-tier");
        assertThat(definition.getGateways()).containsOnlyKeys("route");
        assertThat(definition.getSequenceFlows()).extracting(SequenceFlow::getSourceRef)
                .contains("route");
    }

    @Test
    void rejectsUnsupportedLanguageVersion() {
        String source = "version: abada.io/v2\nmetadata:\n  name: X\nflow:\n  entry: a\n  nodes:\n    - id: a\n      type: webhook\n";
        assertThatThrownBy(() -> parser.parseDetailed(source.getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("abada.io/v1");
    }

    @Test
    void rejectsMissingMetadataName() {
        String source = "version: abada.io/v1\n"
                + "flow:\n"
                + "  entry: start\n"
                + "  nodes:\n"
                + "    - id: start\n      type: webhook\n      next: end\n"
                + "    - id: end\n      type: end\n";
        assertThatThrownBy(() -> parser.parseDetailed(source.getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("metadata.name");
    }

    @Test
    void compilesScriptNodeIntoRuntimeScriptTask() {
        ParsedProcessDefinition definition = parser.parseDetailed(standardFlow(
                "    - id: compute\n"
                        + "      type: script\n"
                        + "      description: Derive a field\n"
                        + "      format: javascript\n"
                        + "      script: |\n"
                        + "        variables.put('derived', variables.input * 2);\n"
                        + "      next: end\n").getBytes(StandardCharsets.UTF_8)).definition();

        assertThat(definition.getScriptTask("compute")).isNotNull()
                .satisfies(script -> {
                    assertThat(script.name()).isEqualTo("Derive a field");
                    assertThat(script.format()).isEqualTo("javascript");
                    assertThat(script.script()).contains("variables.put");
                });
        assertThat(definition.getSequenceFlows()).extracting(SequenceFlow::getSourceRef)
                .containsExactly("compute");
    }

    @Test
    void rejectsScriptNodeWithoutABody() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: compute\n      type: script\n      next: end\n").getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("requires a non-empty 'script' body");
    }

    @Test
    void compilesInclusiveForkAndJoinGateways() {
        ParsedProcessDefinition definition = parser.parseDetailed(standardFlow(
                "    - id: route\n"
                        + "      type: inclusive\n"
                        + "      rules:\n"
                        + "        - if: \"${path == 'C'}\"\n"
                        + "          then: taskC\n"
                        + "        - if: \"${path == 'D'}\"\n"
                        + "          then: taskD\n"
                        + "    - id: taskC\n"
                        + "      type: engine-task\n"
                        + "      service: branch.c\n"
                        + "      next: rejoin\n"
                        + "    - id: taskD\n"
                        + "      type: engine-task\n"
                        + "      service: branch.d\n"
                        + "      next: rejoin\n"
                        + "    - id: rejoin\n"
                        + "      type: inclusive\n"
                        + "      description: Merge branches\n"
                        + "      next: end\n").getBytes(StandardCharsets.UTF_8)).definition();

        assertThat(definition.isInclusiveGateway("route")).isTrue();
        assertThat(definition.getGateways().get("route").defaultFlowId()).isNull();
        assertThat(definition.getIncoming("rejoin")).hasSize(2);
        assertThat(definition.getSequenceFlows()).extracting(SequenceFlow::getSourceRef)
                .containsExactly("route", "route", "taskC", "taskD", "rejoin");
    }

    @Test
    void compilesInclusiveDefaultRuleAndRejectsRulePlusNext() {
        ParsedProcessDefinition definition = parser.parseDetailed(standardFlow(
                "    - id: route\n"
                        + "      type: inclusive\n"
                        + "      rules:\n"
                        + "        - if: \"${path == 'C'}\"\n"
                        + "          then: taskC\n"
                        + "        - else: taskD\n"
                        + "          then: taskD\n"
                        + "    - id: taskC\n"
                        + "      type: engine-task\n"
                        + "      service: branch.c\n"
                        + "      next: end\n"
                        + "    - id: taskD\n"
                        + "      type: engine-task\n"
                        + "      service: branch.d\n"
                        + "      next: end\n").getBytes(StandardCharsets.UTF_8)).definition();
        assertThat(definition.getGateways().get("route").defaultFlowId()).isNotNull();

        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: route\n"
                        + "      type: inclusive\n"
                        + "      rules:\n"
                        + "        - if: \"${path == 'C'}\"\n"
                        + "          then: taskC\n"
                        + "      next: taskC\n").getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("must not combine 'rules' and 'next'");
    }

    @Test
    void rejectsInclusiveNodeWithoutRulesOrNext() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: route\n      type: inclusive\n").getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("must declare either 'rules' (fork) or 'next' (join)");
    }

    @Test
    void rejectsUnknownNodeType() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: secret\n      type: ai-dreamer\n      next: end\n").getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("unsupported node type");
    }

    @Test
    void compilesVersionedAgentExecutionContract() {
        ParsedProcessDefinition definition = parser.parseDetailed(standardFlow(
                "    - id: summarize\n"
                        + "      type: agent\n"
                        + "      profile: abada.agent/v1\n"
                        + "      model: gemini-3.6-flash\n"
                        + "      prompt: Summarize ${case}\n"
                        + "      inputs:\n        case: ${case}\n"
                        + "      result_variable: summary\n"
                        + "      output_schema:\n        type: object\n"
                        + "      tools: [crm.read]\n"
                        + "      confidence_threshold: 80\n"
                        + "      temperature: 0.1\n"
                        + "      max_tokens: 512\n"
                        + "      timeout_ms: 30000\n"
                        + "      max_attempts: 2\n"
                        + "      retry_backoff_ms: 1000\n"
                        + "      next: end\n").getBytes(StandardCharsets.UTF_8)).definition();

        var work = definition.getServiceTask("summarize").agentWork();
        assertThat(work.model()).isEqualTo("gemini-3.6-flash");
        assertThat(work.inputs()).containsEntry("case", "${case}");
        assertThat(work.resultVariable()).isEqualTo("summary");
        assertThat(work.tools()).containsExactly("crm.read");
        assertThat(work.maxTokens()).isEqualTo(512);
    }

    @Test
    void rejectsUnsupportedAgentProfileAndUnsafeLimits() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: agent\n      type: agent\n      profile: abada.agent/v2\n      next: end\n")
                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class).hasMessageContaining("unsupported profile");
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: agent\n      type: agent\n      timeout_ms: 0\n      next: end\n")
                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class).hasMessageContaining("invalid execution limits");
    }

    @Test
    void parallelForkAndJoinCompileIntoParallelGateways() {
        ParsedProcessDefinition definition = parser.parseDetailed(standardFlow(
                "    - id: fanout\n"
                        + "      type: parallel\n"
                        + "      branches: [branchA, branchB]\n"
                        + "    - id: branchA\n      type: engine-task\n      service: abada:a\n      next: rejoin\n"
                        + "    - id: branchB\n      type: engine-task\n      service: abada:b\n      next: rejoin\n"
                        + "    - id: rejoin\n      type: parallel\n      next: end\n")
                .getBytes(StandardCharsets.UTF_8)).definition();

        GatewayMeta fanout = definition.getGateways().get("fanout");
        GatewayMeta rejoin = definition.getGateways().get("rejoin");
        assertThat(fanout).isNotNull();
        assertThat(fanout.type()).isEqualTo(GatewayMeta.Type.PARALLEL);
        assertThat(fanout.defaultFlowId()).isNull();
        assertThat(rejoin).isNotNull();
        assertThat(rejoin.type()).isEqualTo(GatewayMeta.Type.PARALLEL);

        assertThat(definition.isParallelGateway("fanout")).isTrue();
        assertThat(definition.isParallelGateway("rejoin")).isTrue();
        assertThat(definition.getSequenceFlows()).extracting(SequenceFlow::getSourceRef)
                .containsExactly("fanout", "fanout", "branchA", "branchB", "rejoin");
        assertThat(definition.getSequenceFlows()).extracting(SequenceFlow::getTargetRef)
                .contains("branchA", "branchB", "rejoin", "end");
        assertThat(definition.getSequenceFlows()).noneMatch(SequenceFlow::isDefault);
    }

    @Test
    void rejectsParallelCombiningBranchesAndNext() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: fanout\n"
                        + "      type: parallel\n"
                        + "      next: end\n"
                        + "      branches: [branchA, branchB]\n"
                        + "    - id: branchA\n      type: engine-task\n      service: abada:a\n      next: end\n"
                        + "    - id: branchB\n      type: engine-task\n      service: abada:b\n      next: end\n")
                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("must not combine 'branches' and 'next'");
    }

    @Test
    void rejectsParallelWithFewerThanTwoBranches() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: fanout\n      type: parallel\n      branches: [end]\n")
                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("at least two distinct target nodes");
    }

    @Test
    void rejectsParallelBranchTargetingUndeclaredNode() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: fanout\n      type: parallel\n      branches: [branchA, phantom]\n"
                        + "    - id: branchA\n      type: engine-task\n      service: abada:a\n      next: end\n")
                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("not a declared node");
    }

    @Test
    void rejectsParallelDuplicateBranchTargets() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: fanout\n      type: parallel\n      branches: [end, end]\n")
                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("duplicate branch target");
    }

    @Test
    void rejectsConditionRoutingViaNext() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: route\n"
                        + "      type: condition\n"
                        + "      next: end\n"
                        + "      rules:\n"
                        + "        - else: true\n"
                        + "          then: end\n").getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("routes via 'rules'");
    }

@Test
    void rejectsNonWebhookEntryNode() {
        String source = "version: abada.io/v1\n"
                + "metadata:\n  name: Standard Flow\n"
                + "flow:\n"
                + "  entry: engine\n"
                + "  nodes:\n"
                + "    - id: engine\n      type: engine-task\n      service: abada:work\n      next: end\n"
                + "    - id: end\n      type: end\n";
        assertThatThrownBy(() -> parser.parseDetailed(source.getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("must reference a webhook node");
    }

    @Test
    void rejectsSecondWebhookNode() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: second\n      type: webhook\n      next: end\n").getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("second start");
    }

@Test
    void rejectsUndirectedNextTarget() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: other\n      type: engine-task\n      service: abada:work\n      next: phantom\n")
                .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("not a declared node");
    }

    @Test
    void rejectsCycleThroughConditionRuleTarget() {
        String source = "version: abada.io/v1\n"
                + "metadata:\n  name: Cyclic Flow\n"
                + "flow:\n"
                + "  entry: start\n"
                + "  nodes:\n"
                + "    - id: start\n      type: webhook\n      next: route\n"
                + "    - id: route\n      type: condition\n"
                + "      rules:\n"
                + "        - else: true\n"
                + "          then: start\n"
                + "    - id: end\n      type: end\n";
        assertThatThrownBy(() -> parser.parseDetailed(source.getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("cyclic flow");
    }

    @Test
    void rejectsDuplicateElseRules() {
        assertThatThrownBy(() -> parser.parseDetailed(standardFlow(
                "    - id: route\n"
                        + "      type: condition\n"
                        + "      rules:\n"
                        + "        - else: true\n"
                        + "          then: end\n"
                        + "        - else: true\n"
                        + "          then: end\n").getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("more than one else");
    }

    @Test
    void rejectsMalformedYaml() {
        String source = "version: abada.io/v1\nmetadata: [unterminated";
        assertThatThrownBy(() -> parser.parseDetailed(source.getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("not valid YAML");
    }

    @Test
    void reportsAbadaNativeProfileAndMappings() throws IOException {
        BpmnParseResult result = parser.parseDetailed(read("/apl/candidate-review.apl.yaml"));
        assertThat(result.activeProfiles()).containsExactly(CompatibilityProfiles.ABADA_NATIVE);
        assertThat(result.detectedNamespaces()).containsExactly("abada.io/v1");
        assertThat(result.report().issues()).isEmpty();
        assertThat(result.report().mappings()).isNotEmpty();
    }

    @Test
    void sniffingSeparatesAplFromXml() {
        assertThat(AplParser.isAplSource("version: abada.io/v1\nmetadata:\n  name: X\n"
                .getBytes(StandardCharsets.UTF_8))).isTrue();
        assertThat(AplParser.isAplSource("<bpmn:definitions xmlns:bpmn=\"http://www.omg.org/spec/BPMN/20100524/MODEL\">"
                .getBytes(StandardCharsets.UTF_8))).isFalse();
        assertThat(AplParser.isAplSource("".getBytes(StandardCharsets.UTF_8))).isFalse();
    }

    @Test
    void declaresApiContractConstants() {
        assertThat(AplParser.LANGUAGE_VERSION).isEqualTo("abada.io/v1");
        assertThat(AplParser.AGENT_EXTERNAL_TOPIC).isEqualTo("abada:agent");
    }

    @Test
    void rejectsAgentModelsOutsideTheAllowedList() {
        String source = "version: abada.io/v1\n"
                + "metadata:\n"
                + "  name: Guarded Flow\n"
                + "flow:\n"
                + "  entry: start\n"
                + "  nodes:\n"
                + "    - id: start\n"
                + "      type: webhook\n"
                + "      next: agent-a\n"
                + "    - id: agent-a\n"
                + "      type: agent\n"
                + "      model: gemini-2.5-flash\n"
                + "      next: end\n"
                + "    - id: end\n"
                + "      type: end\n";
        assertThatThrownBy(() -> parser.parseDetailed(source.getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("agent node 'agent-a' declares model 'gemini-2.5-flash'")
                .hasMessageContaining("allowed model list")
                .hasMessageContaining("gemini-3.6-flash");
    }

    @Test
    void acceptsModelsOnTheAllowedListAndBlankModels() {
        for (String model : new String[] { "gemini-3.6-flash", "deepseek/deepseek-v4-flash-free", "gpt-5-mini", " " }) {
            String source = "version: abada.io/v1\n"
                    + "metadata:\n"
                    + "  name: Guarded Flow\n"
                    + "flow:\n"
                    + "  entry: start\n"
                    + "  nodes:\n"
                    + "    - id: start\n"
                    + "      type: webhook\n"
                    + "      next: agent-a\n"
                    + "    - id: agent-a\n"
                    + "      type: agent\n"
                    + "      model: \"" + model.strip() + "\"\n"
                    + "      next: end\n"
                    + "    - id: end\n"
                    + "      type: end\n";
            assertThat(parser.parseDetailed(source.getBytes(StandardCharsets.UTF_8)).definition())
                    .isNotNull();
        }
    }

    private ParsedProcessDefinition parse(String resource) throws IOException {
        return parser.parseDetailed(read(resource)).definition();
    }

    private byte[] read(String resource) throws IOException {
        try (InputStream stream = getClass().getResourceAsStream(resource)) {
            assertThat(stream).as(resource).isNotNull();
            return stream.readAllBytes();
        }
    }

    private static String standardFlow(String extraNodes) {
        return "version: abada.io/v1\n"
                + "metadata:\n"
                + "  name: Standard Flow\n"
                + "flow:\n"
                + "  entry: start\n"
                + "  nodes:\n"
                + "    - id: start\n"
                + "      type: webhook\n"
                + extraNodes
                + "    - id: end\n"
                + "      type: end\n";
    }
}
