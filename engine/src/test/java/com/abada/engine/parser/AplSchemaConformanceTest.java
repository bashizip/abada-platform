package com.abada.engine.parser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.bpmn.compatibility.BpmnValidationIssue;
import com.abada.engine.bpmn.compatibility.ValidationSeverity;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/** The APL JSON Schema and the semantic parser describe the same language. */
class AplSchemaConformanceTest {
    private static final YAMLMapper YAML = new YAMLMapper();
    private final AplParser parser = new AplParser();

    @Test
    void schemaDefinesExactlyTheParserNodeTypes() {
        assertThat(AplSchema.instance().nodeTypes()).containsExactlyInAnyOrderElementsOf(AplParser.SUPPORTED_TYPES);
        assertThat(AplSchema.instance().document().at("/$defs/nodeType/enum"))
                .extracting(JsonNode::asText).containsExactlyInAnyOrderElementsOf(AplParser.SUPPORTED_TYPES);
    }

    static Stream<Path> committedDocuments() throws IOException {
        Path repository = Path.of("..").toAbsolutePath().normalize();
        try (Stream<Path> files = Files.walk(repository.resolve("engine/src/test/resources/apl"))) {
            List<Path> fixtures = files.filter(path -> path.toString().endsWith(".apl.yaml")).toList();
            List<Path> others = Stream.of("examples/apl", "scripts/test/m1-exit-demo/processes")
                    .map(repository::resolve).filter(Files::isDirectory)
                    .flatMap(directory -> {
                        try (Stream<Path> walk = Files.walk(directory)) {
                            return walk.filter(path -> path.toString().endsWith(".apl.yaml")).toList().stream();
                        } catch (IOException exception) {
                            throw new java.io.UncheckedIOException(exception);
                        }
                    }).toList();
            return Stream.concat(fixtures.stream(), others.stream());
        }
    }

    @ParameterizedTest
    @MethodSource("committedDocuments")
    void everyCommittedDocumentMatchesTheSchema(Path document) throws IOException {
        JsonNode root = YAML.readTree(Files.readString(document));
        assertThat(AplSchema.instance().validate(root)).as(document.toString()).isEmpty();
    }

    @Test
    void unknownFieldIsAWarningAtItsPathAndStillDeploys() {
        var result = parser.parseDetailed(document("""
                    - id: analyze
                      type: agent
                      prompt: Score the lead
                      confidence_treshold: 80
                      next: done
                """));
        assertThat(result.report().issues()).singleElement().satisfies(issue -> {
            assertThat(issue.code()).isEqualTo(AplSchema.SCHEMA_CODE);
            assertThat(issue.severity()).isEqualTo(ValidationSeverity.WARNING);
            assertThat(issue.path()).isEqualTo("/flow/nodes/1/confidence_treshold");
            assertThat(issue.elementId()).isEqualTo("analyze");
            assertThat(issue.message()).contains("unknown field 'confidence_treshold'");
        });
    }

    @Test
    void wrongValueTypeIsAWarningInsteadOfASilentDefault() {
        var result = parser.parseDetailed(document("""
                    - id: analyze
                      type: agent
                      temperature: hot
                      next: done
                """));
        assertThat(result.report().issues()).extracting(BpmnValidationIssue::path)
                .containsExactly("/flow/nodes/1/temperature");
    }

    static Stream<Arguments> agentBounds() {
        return Stream.of(
                Arguments.of("confidence_threshold", "100", "100.5"),
                Arguments.of("temperature", "2", "2.1"),
                Arguments.of("max_tokens", "1000000", "1000001"),
                Arguments.of("timeout_ms", "3600000", "3600001"),
                Arguments.of("max_attempts", "20", "21"),
                Arguments.of("retry_backoff_ms", "3600000", "3600001"));
    }

    @ParameterizedTest
    @MethodSource("agentBounds")
    void schemaBoundsMatchTheParserBounds(String field, String max, String beyond) {
        String atMax = agentWith(field, max);
        assertThat(parser.parseDetailed(atMax.getBytes(StandardCharsets.UTF_8)).report().issues()).isEmpty();

        assertThatThrownBy(() -> parser.parseDetailed(agentWith(field, beyond).getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(BpmnValidationException.class)
                .satisfies(error -> assertThat(((BpmnValidationException) error).getIssues())
                        .anySatisfy(issue -> {
                            assertThat(issue.severity()).isEqualTo(ValidationSeverity.WARNING);
                            assertThat(issue.path()).isEqualTo("/flow/nodes/1/" + field);
                        })
                        .anySatisfy(issue -> assertThat(issue.severity()).isEqualTo(ValidationSeverity.ERROR)));
    }

    @Test
    void errorsInSeveralNodesAreAllReportedWithLocations() {
        assertThatThrownBy(() -> parser.parseDetailed(document("""
                    - id: route
                      type: engine-task
                      next: done
                    - id: wait
                      type: timer
                      duration: tomorrow
                """)))
                .isInstanceOf(BpmnValidationException.class)
                .satisfies(error -> assertThat(((BpmnValidationException) error).getIssues())
                        .filteredOn(issue -> issue.severity() == ValidationSeverity.ERROR)
                        .extracting(BpmnValidationIssue::elementId, BpmnValidationIssue::path)
                        .containsExactly(
                                org.assertj.core.groups.Tuple.tuple("route", "/flow/nodes/1/service"),
                                org.assertj.core.groups.Tuple.tuple("wait", "/flow/nodes/2/duration")));
    }

    @Test
    void policyErrorsAreAnchoredToTheirNode() {
        assertThatThrownBy(() -> parser.parseDetailed(document("""
                    - id: gate
                      type: condition
                      rules:
                        - if: "${Java.type('java.lang.Runtime')}"
                          then: done
                        - else: done
                """)))
                .isInstanceOf(BpmnValidationException.class)
                .satisfies(error -> assertThat(((BpmnValidationException) error).getIssues())
                        .anySatisfy(issue -> {
                            assertThat(issue.elementId()).isEqualTo("gate");
                            assertThat(issue.path()).isEqualTo("/flow/nodes/1");
                        }));
    }

    private static String agentWith(String field, String value) {
        return new String(document("""
                    - id: analyze
                      type: agent
                      %s: %s
                      next: done
                """.formatted(field, value)), StandardCharsets.UTF_8);
    }

    /** A webhook, the given middle nodes and an end node named done. */
    static byte[] document(String middleNodes) {
        return ("""
                version: abada.io/v1
                metadata:
                  key: conformance
                  name: Conformance
                flow:
                  entry: start
                  nodes:
                    - id: start
                      type: webhook
                      next: %s
                %s    - id: done
                      type: end
                """.formatted(firstId(middleNodes), middleNodes)).getBytes(StandardCharsets.UTF_8);
    }

    private static String firstId(String nodes) {
        return nodes.strip().lines().findFirst().orElseThrow().replace("- id:", "").strip();
    }
}
