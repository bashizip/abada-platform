package com.abada.engine.core.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Masks what the step journal must not keep in a {@code redacted} payload:
 * credentials (bearer tokens, Authorization headers, key-, token-, secret- and
 * password-like fields — the agent worker's {@code SecretRedactor} patterns),
 * fields named after a variable declared {@code sensitive: true}, and the
 * values of those variables wherever they appear in text.
 */
public final class EvidenceRedactor {
    public static final String MASK = "****";
    /** Shorter sensitive values are not searched for in text: they would mask unrelated words. */
    static final int MIN_VALUE_LENGTH = 4;

    private static final List<Pattern> PATTERNS = List.of(
            Pattern.compile("(?i)(bearer\\s+)[A-Za-z0-9._~+/=-]{8,}"),
            Pattern.compile("(?i)(authorization[\"']?\\s*[:=]\\s*[\"']?)[^\\s\"',}]+(\\s+[^\\s\"',}]+)?"),
            Pattern.compile("(?i)((?:api[_-]?key|x-api-key|access[_-]?token|client[_-]?secret|password|secret)"
                    + "[\"']?\\s*[:=]\\s*[\"']?)[^\\s\"'&,}]+"),
            Pattern.compile("(?i)([?&](?:key|api_key|token)=)[^&\\s\"']+"));
    private static final Pattern SECRET_FIELD = Pattern.compile(
            "(?i)^(?:authorization|api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|client[_-]?secret"
                    + "|password|passwd|secret|token|private[_-]?key)$");

    private final Set<String> sensitiveFields;
    private final List<String> sensitiveValues;

    /**
     * @param sensitiveVariables the {@code sensitive: true} variable names of the
     *        definition, with their current values in the instance
     */
    public EvidenceRedactor(Map<String, Object> sensitiveVariables) {
        this.sensitiveFields = sensitiveVariables.keySet().stream().map(name -> name.toLowerCase(Locale.ROOT))
                .collect(Collectors.toUnmodifiableSet());
        List<String> values = new ArrayList<>();
        sensitiveVariables.values().forEach(value -> collect(value, values));
        values.sort(Comparator.comparingInt(String::length).reversed());
        this.sensitiveValues = List.copyOf(values);
    }

    public static EvidenceRedactor patternsOnly() {
        return new EvidenceRedactor(Map.of());
    }

    /** A redacted copy of the payload; the input is not changed. */
    public JsonNode redact(JsonNode payload) {
        if (payload == null) return null;
        if (payload.isTextual()) return TextNode.valueOf(redactText(payload.asText()));
        if (payload.isArray()) {
            ArrayNode copy = JsonNodeFactory.instance.arrayNode();
            payload.forEach(item -> copy.add(redact(item)));
            return copy;
        }
        if (payload.isObject()) {
            ObjectNode copy = JsonNodeFactory.instance.objectNode();
            Iterator<Map.Entry<String, JsonNode>> fields = payload.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                boolean masked = SECRET_FIELD.matcher(field.getKey()).matches()
                        || sensitiveFields.contains(field.getKey().toLowerCase(Locale.ROOT));
                copy.set(field.getKey(), masked ? TextNode.valueOf(MASK) : redact(field.getValue()));
            }
            return copy;
        }
        if (!payload.isValueNode() || payload.isNull()) return payload;
        String text = payload.asText();
        return sensitiveValues.contains(text) ? TextNode.valueOf(MASK) : payload;
    }

    String redactText(String text) {
        if (text == null || text.isEmpty()) return text;
        String result = text;
        for (String value : sensitiveValues) result = result.replace(value, MASK);
        for (Pattern pattern : PATTERNS) {
            result = pattern.matcher(result).replaceAll(match -> java.util.regex.Matcher.quoteReplacement(
                    match.group(1) + MASK));
        }
        return result;
    }

    private static void collect(Object value, Collection<String> into) {
        if (value == null) return;
        if (value instanceof Map<?, ?> map) {
            map.values().forEach(nested -> collect(nested, into));
        } else if (value instanceof Collection<?> list) {
            list.forEach(nested -> collect(nested, into));
        } else {
            String text = String.valueOf(value);
            if (text.length() >= MIN_VALUE_LENGTH) into.add(text);
        }
    }
}
