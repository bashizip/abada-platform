package com.abada.engine.forms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * The engine side of the shared form conformance fixtures; the Studio's
 * {@code formSchema.test.ts} runs the same files, so the browser and the engine
 * accept and refuse the same values.
 */
class FormConformanceTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @TestFactory
    Stream<DynamicTest> visibilityCasesEvaluateAsListed() throws IOException {
        JsonNode fixture = read("forms/visibility-conformance.json");
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode test : fixture.path("cases")) {
            String expression = test.path("expr").asText();
            Map<String, Object> values = JSON.convertValue(test.path("values"), new TypeReference<>() {});
            tests.add(DynamicTest.dynamicTest(expression + " over " + values, () ->
                    assertThat(VisibilityExpression.parse(expression).test(values))
                            .isEqualTo(test.path("expected").asBoolean())));
        }
        for (JsonNode invalid : fixture.path("invalid")) {
            tests.add(DynamicTest.dynamicTest("refuses " + invalid.asText(), () ->
                    assertThatThrownBy(() -> VisibilityExpression.parse(invalid.asText()))
                            .isInstanceOf(IllegalArgumentException.class)));
        }
        return tests.stream();
    }

    @TestFactory
    Stream<DynamicTest> submissionCasesProduceTheListedViolations() throws IOException {
        JsonNode fixture = read("forms/submission-conformance.json");
        FormSchema form = FormSchema.parse(read(fixture.path("form").asText()));
        Map<String, Object> current = JSON.convertValue(fixture.path("current"), new TypeReference<>() {});
        Map<String, Object> valid = JSON.convertValue(fixture.path("valid"), new TypeReference<>() {});
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode test : fixture.path("cases")) {
            tests.add(DynamicTest.dynamicTest(test.path("name").asText(), () -> {
                Map<String, Object> submitted = new LinkedHashMap<>(valid);
                test.path("unset").forEach(name -> submitted.remove(name.asText()));
                if (test.has("set")) {
                    submitted.putAll(JSON.convertValue(test.path("set"), new TypeReference<Map<String, Object>>() {}));
                }
                List<List<String>> expected = JSON.convertValue(test.path("violations"), new TypeReference<>() {});
                List<String> discarded = JSON.convertValue(test.path("discarded"), new TypeReference<>() {});
                if (expected.isEmpty()) {
                    FormSubmission.Result result = FormSubmission.check("supplier-onboarding", form, current, submitted);
                    assertThat(result.discarded()).containsExactlyElementsOf(discarded);
                    discarded.forEach(name -> assertThat(result.accepted()).doesNotContainKey(name));
                } else {
                    assertThatThrownBy(() -> FormSubmission.check("supplier-onboarding", form, current, submitted))
                            .isInstanceOfSatisfying(FormSubmission.RejectedException.class, rejected -> {
                                assertThat(rejected.violations().stream().map(v -> List.of(v.field(), v.rule())))
                                        .containsExactlyElementsOf(expected);
                                // Field ids and rule names only: no submitted value reaches the message.
                                submitted.values().stream().filter(String.class::isInstance).map(String.class::cast)
                                        .filter(value -> value.length() > 3)
                                        .forEach(value -> assertThat(rejected.getMessage()).doesNotContain(value));
                            });
                }
            }));
        }
        return tests.stream();
    }

    static JsonNode read(String resource) throws IOException {
        try (InputStream in = FormConformanceTest.class.getClassLoader().getResourceAsStream(resource)) {
            assertThat(in).as(resource).isNotNull();
            return JSON.readTree(in);
        }
    }
}
