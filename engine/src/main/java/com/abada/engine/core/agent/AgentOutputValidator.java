package com.abada.engine.core.agent;

import com.abada.engine.core.model.AgentWorkDescriptor;
import com.abada.engine.parser.AplParser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The engine-side agent output contract ("the table is the law, agents are
 * the advice"). A model result may enter process state only after the engine
 * checks it, inside the completion transaction and without remote calls:
 *
 * <ol>
 *   <li>The completion may write exactly one variable: the node's
 *       {@code result_variable}.</li>
 *   <li>If {@code output_schema} is declared, the result must validate against
 *       it (JSON Schema 2020-12).</li>
 *   <li>If {@code confidence_threshold} is declared (above 0), the result must
 *       be an object with a numeric {@code _confidence} in [0, 100] that meets
 *       the threshold. A missing score fails the threshold.</li>
 * </ol>
 *
 * The {@code _confidence} field is removed from the stored value. Reasons
 * name JSON paths and schema keywords, never values.
 */
public final class AgentOutputValidator {
    public static final String CONFIDENCE_FIELD = "_confidence";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonSchemaFactory SCHEMAS = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012);
    private static final JsonSchema META_SCHEMA = SCHEMAS.getSchema(
            com.networknt.schema.SchemaLocation.of(com.networknt.schema.SchemaId.V202012));
    private static final Map<String, JsonSchema> CACHE = new ConcurrentHashMap<>();

    private AgentOutputValidator() {}

    public record Verdict(String outcome, Object value, Double confidence, String reason) {
        public boolean ok() { return AplParser.OUTCOME_OK.equals(outcome); }
    }

    public static Verdict validate(AgentWorkDescriptor work, String resultVariable, Map<String, Object> variables) {
        Map<String, Object> reported = variables == null ? Map.of() : variables;
        if (!reported.containsKey(resultVariable)) {
            return invalid(null, null, "completion did not report the result variable '" + resultVariable + "'");
        }
        if (reported.size() > 1) {
            List<String> extra = reported.keySet().stream().filter(key -> !key.equals(resultVariable)).sorted().toList();
            return invalid(null, null, "an agent completion may only write '" + resultVariable + "', not " + extra);
        }
        Object raw = reported.get(resultVariable);
        Double confidence = null;
        Object value = raw;
        if (raw instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>();
            map.forEach((key, entry) -> copy.put(String.valueOf(key), entry));
            Object score = copy.remove(CONFIDENCE_FIELD);
            if (score instanceof Number number) confidence = number.doubleValue();
            else if (score != null) return invalid(copy, null, "'" + CONFIDENCE_FIELD + "' must be a number");
            value = copy;
        }
        if (confidence != null && (confidence < 0 || confidence > 100 || confidence.isNaN())) {
            return invalid(value, confidence, "'" + CONFIDENCE_FIELD + "' must be between 0 and 100");
        }
        if (work.outputSchema() != null && !work.outputSchema().isEmpty()) {
            // A schema may or may not describe _confidence: accept the object with or without it.
            JsonSchema contract = schema(work.outputSchema());
            java.util.Set<ValidationMessage> errors = contract.validate(JSON.valueToTree(value));
            if (!errors.isEmpty() && raw instanceof Map<?, ?> && confidence != null) {
                java.util.Set<ValidationMessage> withScore = contract.validate(JSON.valueToTree(raw));
                if (withScore.isEmpty()) errors = withScore;
            }
            if (!errors.isEmpty()) {
                String reason = errors.stream().limit(5)
                        .map(error -> (error.getInstanceLocation() == null ? "$" : error.getInstanceLocation().toString())
                                + " fails '" + error.getType() + "'")
                        .reduce((a, b) -> a + "; " + b).orElse("output does not match output_schema");
                return invalid(value, confidence, "output does not match output_schema: " + reason);
            }
        }
        double threshold = work.confidenceThreshold() == null ? 0.0 : work.confidenceThreshold();
        if (threshold > 0) {
            if (confidence == null) {
                return new Verdict(AplParser.OUTCOME_LOW_CONFIDENCE, value, null,
                        "no '" + CONFIDENCE_FIELD + "' reported; threshold is " + threshold);
            }
            if (confidence < threshold) {
                return new Verdict(AplParser.OUTCOME_LOW_CONFIDENCE, value, confidence,
                        "confidence " + confidence + " is below threshold " + threshold);
            }
        }
        return new Verdict(AplParser.OUTCOME_OK, value, confidence, null);
    }

    /** Validates an output_schema at deployment; returns an error message or null. */
    public static String schemaProblem(Map<String, Object> outputSchema) {
        try {
            java.util.Set<ValidationMessage> problems = META_SCHEMA.validate(JSON.valueToTree(outputSchema));
            if (!problems.isEmpty()) {
                return problems.stream().limit(3)
                        .map(problem -> problem.getInstanceLocation() + " fails '" + problem.getType() + "'")
                        .reduce((a, b) -> a + "; " + b).orElse("invalid JSON Schema");
            }
            schema(outputSchema);
            return null;
        } catch (RuntimeException exception) {
            return exception.getMessage() == null ? "invalid JSON Schema" : exception.getMessage();
        }
    }

    private static Verdict invalid(Object value, Double confidence, String reason) {
        return new Verdict(AplParser.OUTCOME_INVALID_OUTPUT, value, confidence, reason);
    }

    private static JsonSchema schema(Map<String, Object> outputSchema) {
        String key;
        try {
            key = JSON.writeValueAsString(outputSchema);
        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            throw new IllegalArgumentException("output_schema is not serializable", exception);
        }
        return CACHE.computeIfAbsent(key, ignored -> {
            JsonNode node = JSON.valueToTree(outputSchema);
            return SCHEMAS.getSchema(node);
        });
    }
}
