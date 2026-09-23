package com.abada.engine.core.agent;

import com.abada.engine.core.model.AgentWorkDescriptor;
import com.abada.engine.parser.AplParser;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** Engine-side agent output contract (T4). */
class AgentOutputValidatorTest {

    private static final Map<String, Object> SCHEMA = Map.of(
            "type", "object",
            "required", List.of("priority"),
            "properties", Map.of("priority", Map.of("enum", List.of("HIGH", "MEDIUM", "LOW"))));

    private static AgentWorkDescriptor work(Map<String, Object> schema, double threshold) {
        return new AgentWorkDescriptor("abada.agent/v1", "gemini-3.6-flash", "Classify", Map.of(),
                "lead_priority", schema, List.of(), threshold, 0.2, 256, 60_000L, 3, 1_000L);
    }

    @Test
    void acceptsASchemaValidConfidentResultAndStripsTheScore() {
        var verdict = AgentOutputValidator.validate(work(SCHEMA, 85), "lead_priority",
                Map.of("lead_priority", Map.of("priority", "HIGH", "_confidence", 92)));
        assertThat(verdict.outcome()).isEqualTo(AplParser.OUTCOME_OK);
        assertThat(verdict.value()).isEqualTo(Map.of("priority", "HIGH"));
        assertThat(verdict.confidence()).isEqualTo(92.0);
    }

    @Test
    void schemaViolationIsInvalidOutputAndNamesTheKeywordNotTheValue() {
        var verdict = AgentOutputValidator.validate(work(SCHEMA, 0), "lead_priority",
                Map.of("lead_priority", Map.of("priority", "URGENT-SECRET")));
        assertThat(verdict.outcome()).isEqualTo(AplParser.OUTCOME_INVALID_OUTPUT);
        assertThat(verdict.reason()).contains("enum").doesNotContain("URGENT-SECRET");
    }

    @Test
    void nonJsonTextIsInvalidOutputWhenASchemaIsDeclared() {
        var verdict = AgentOutputValidator.validate(work(SCHEMA, 0), "lead_priority",
                Map.of("lead_priority", "Sorry, I cannot classify this."));
        assertThat(verdict.outcome()).isEqualTo(AplParser.OUTCOME_INVALID_OUTPUT);
    }

    @Test
    void aMissingConfidenceFailsTheThreshold() {
        var verdict = AgentOutputValidator.validate(work(SCHEMA, 85), "lead_priority",
                Map.of("lead_priority", Map.of("priority", "LOW")));
        assertThat(verdict.outcome()).isEqualTo(AplParser.OUTCOME_LOW_CONFIDENCE);
        assertThat(verdict.reason()).contains("no '_confidence'");
    }

    @Test
    void aLowConfidenceKeepsTheValueForReview() {
        var verdict = AgentOutputValidator.validate(work(SCHEMA, 85), "lead_priority",
                Map.of("lead_priority", Map.of("priority", "LOW", "_confidence", 40)));
        assertThat(verdict.outcome()).isEqualTo(AplParser.OUTCOME_LOW_CONFIDENCE);
        assertThat(verdict.value()).isEqualTo(Map.of("priority", "LOW"));
        assertThat(verdict.confidence()).isEqualTo(40.0);
    }

    @Test
    void outOfRangeOrNonNumericConfidenceIsInvalid() {
        assertThat(AgentOutputValidator.validate(work(SCHEMA, 85), "lead_priority",
                Map.of("lead_priority", Map.of("priority", "LOW", "_confidence", 140))).outcome())
                .isEqualTo(AplParser.OUTCOME_INVALID_OUTPUT);
        assertThat(AgentOutputValidator.validate(work(SCHEMA, 85), "lead_priority",
                Map.of("lead_priority", Map.of("priority", "LOW", "_confidence", "very"))).outcome())
                .isEqualTo(AplParser.OUTCOME_INVALID_OUTPUT);
    }

    @Test
    void aCompletionMayWriteOnlyTheResultVariable() {
        var extra = AgentOutputValidator.validate(work(Map.of(), 0), "lead_priority",
                Map.of("lead_priority", "HIGH", "approved", true));
        assertThat(extra.outcome()).isEqualTo(AplParser.OUTCOME_INVALID_OUTPUT);
        assertThat(extra.reason()).contains("[approved]");

        var missing = AgentOutputValidator.validate(work(Map.of(), 0), "lead_priority", Map.of("other", 1));
        assertThat(missing.outcome()).isEqualTo(AplParser.OUTCOME_INVALID_OUTPUT);
    }

    @Test
    void plainTextWithoutSchemaOrThresholdIsAccepted() {
        var verdict = AgentOutputValidator.validate(work(Map.of(), 0), "lead_priority",
                Map.of("lead_priority", "HIGH"));
        assertThat(verdict.ok()).isTrue();
        assertThat(verdict.value()).isEqualTo("HIGH");
    }

    @Test
    void aSchemaThatRequiresTheScoreIsSatisfiedAndTheScoreIsStillStripped() {
        Map<String, Object> schema = Map.of("type", "object", "required", List.of("priority", "_confidence"),
                "properties", Map.of("priority", Map.of("type", "string"), "_confidence", Map.of("type", "number")));
        var verdict = AgentOutputValidator.validate(work(schema, 70), "triage",
                Map.of("triage", Map.of("priority", "HIGH", "_confidence", 95)));
        assertThat(verdict.ok()).isTrue();
        assertThat(verdict.value()).isEqualTo(Map.of("priority", "HIGH"));
    }

    @Test
    void reportsInvalidSchemas() {
        assertThat(AgentOutputValidator.schemaProblem(Map.of("type", "object"))).isNull();
        assertThat(AgentOutputValidator.schemaProblem(Map.of("type", 12))).isNotNull();
    }
}
