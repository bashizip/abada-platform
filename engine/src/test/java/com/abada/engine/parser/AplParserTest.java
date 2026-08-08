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
            assertThat(work.maxAttempts()).isEqualTo(3);
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
                        + "      model: model-a\n"
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
        assertThat(work.model()).isEqualTo("model-a");
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
