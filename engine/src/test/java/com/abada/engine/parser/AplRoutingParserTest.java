package com.abada.engine.parser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.core.model.AgentRouteMeta;
import com.abada.engine.core.model.BoundaryMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** E13: an agent's {@code routes}, compiled to ROUTE boundaries and a required {@code route} in its contract. */
class AplRoutingParserTest {
    private final AplParser parser = new AplParser();

    @Test
    @SuppressWarnings("unchecked")
    void routesBecomeBoundariesAndARequiredRouteInTheOutputContract() throws IOException {
        ParsedProcessDefinition definition = parser.parse(
                Files.readAllBytes(Path.of("src/test/resources/apl/routing-agent.apl.yaml")));
        assertThat(definition.getAgentRoutes("triage")).extracting(AgentRouteMeta::name, AgentRouteMeta::target)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("refund", "refund"),
                        org.assertj.core.groups.Tuple.tuple("escalate", "manual"),
                        org.assertj.core.groups.Tuple.tuple("clarify", "ask_customer"));
        assertThat(definition.getAgentRoutes("triage").getFirst().when()).isEqualTo("amount <= 500.0");
        BoundaryMeta refund = definition.boundaryFor("triage", BoundaryMeta.Kind.ROUTE, "refund");
        assertThat(refund.target()).isEqualTo("refund");
        assertThat(refund.catches("refund")).isFalse();
        assertThat(definition.boundaryFor("triage", BoundaryMeta.Kind.ROUTE, "unknown")).isNull();
        // The route back to the agent is a back-edge bounded by the agent's loop.
        assertThat(definition.isBackEdge("ask_customer", "triage")).isTrue();

        Map<String, Object> contract = definition.getServiceTask("triage").agentWork().outputSchema();
        assertThat((List<Object>) contract.get("required")).containsExactly("route");
        Map<String, Object> properties = (Map<String, Object>) contract.get("properties");
        assertThat(properties).containsKeys("summary", "route");
        Map<String, Object> route = (Map<String, Object>) properties.get("route");
        assertThat((List<Object>) route.get("enum")).containsExactly("refund", "escalate", "clarify");
        assertThat((String) route.get("description")).contains("escalate: Anything unclear, angry or legal");
    }

    @Test
    @SuppressWarnings("unchecked")
    void withoutAnOutputSchemaTheRouteIsTheWholeContract() {
        ParsedProcessDefinition definition = parser.parse(stream(agent("""
                      routes:
                        yes: { next: done, description: Approve }
                        no:  { next: done, description: Decline }
                """, "")));
        Map<String, Object> contract = definition.getServiceTask("pick").agentWork().outputSchema();
        assertThat(contract).containsEntry("type", "object").containsEntry("required", List.of("route"));
        assertThat((Map<String, Object>) contract.get("properties")).containsOnlyKeys("route");
    }

    @Test
    void malformedRoutesAreRejectedAtTheirPath() {
        assertInvalid(agent("""
                      routes:
                        only: { next: done, description: One }
                """, ""), "between 2 and 8 routes");
        assertInvalid(agent("""
                      routes:
                        Yes: { next: done, description: A }
                        no:  { next: done, description: B }
                """, ""), "lowercase");
        assertInvalid(agent("""
                      routes:
                        yes: { next: done }
                        no:  { next: done, description: B }
                """, ""), "needs a description");
        assertInvalid(agent("""
                      routes:
                        yes: { next: nowhere, description: A }
                        no:  { next: done, description: B }
                """, ""), "not a declared node");
        assertInvalid(agent("""
                      routes:
                        yes: { next: done, description: A }
                        no:  { next: done, description: B }
                """, "next: done"), "both 'next' and 'routes'");
        assertInvalid(agent("""
                      output_schema: { type: string }
                      routes:
                        yes: { next: done, description: A }
                        no:  { next: done, description: B }
                """, ""), "must describe an object");
        assertInvalid(agent("""
                      output_schema: { type: object, properties: { route: { type: string } } }
                      routes:
                        yes: { next: done, description: A }
                        no:  { next: done, description: B }
                """, ""), "owns the 'route' property");
        assertInvalid(agent("""
                      routes:
                        yes: { next: done, description: A, when: "amount >" }
                        no:  { next: done, description: B }
                """, ""), "pick");
        assertInvalid("""
                version: abada.io/v1
                metadata: { key: routed_review, name: Routed review }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: pick }
                    - id: pick
                      type: human-input
                      assignees: [x]
                      routes:
                        yes: { next: done, description: A }
                        no:  { next: done, description: B }
                    - { id: done, type: end }
                """, "only agent nodes support");
    }

    private void assertInvalid(String source, String message) {
        assertThatThrownBy(() -> parser.parse(stream(source))).isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining(message);
    }

    private static String agent(String fields, String next) {
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
                %s
                      %s
                    - { id: done, type: end }
                """.formatted(fields.stripTrailing(), next);
    }

    private static byte[] stream(String source) {
        return source.getBytes(StandardCharsets.UTF_8);
    }
}
