package com.abada.engine.audit;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Builds the {@code details_json} of an event: what changed, as non-sensitive
 * before/after values. Callers pass only fields that are safe to keep; this class
 * is the second line of defence and removes any entry whose name says it holds a
 * secret ({@code apiKey}, {@code secret}, {@code password}, {@code token}, ...),
 * at any depth. A flag such as {@code apiKeyChanged} is kept: it names a fact, not
 * the value.
 */
public final class AdminAuditDetails {
    static final Pattern SECRET_NAME = Pattern.compile(
            "(?i).*(secret|password|passwd|token|authorization|api[_-]?key|private[_-]?key|key[_-]?enc"
                    + "|credential|plaintext)$");
    static final int MAX_STRING = 500;
    static final int MAX_ITEMS = 100;

    private final Map<String, Object> values = new LinkedHashMap<>();

    private AdminAuditDetails() {}

    public static AdminAuditDetails create() { return new AdminAuditDetails(); }

    /** A field that changed; equal values are left out, so the event lists real changes only. */
    public AdminAuditDetails change(String field, Object before, Object after) {
        if (java.util.Objects.equals(before, after)) return this;
        Map<String, Object> change = new LinkedHashMap<>();
        change.put("before", before);
        change.put("after", after);
        values.put(field, change);
        return this;
    }

    /** A value that describes the action (the new state of a created object, a count, a flag). */
    public AdminAuditDetails put(String field, Object value) {
        if (value != null) values.put(field, value);
        return this;
    }

    public boolean isEmpty() { return values.isEmpty(); }

    Map<String, Object> sanitized() {
        @SuppressWarnings("unchecked")
        Map<String, Object> clean = (Map<String, Object>) sanitize(values, 0);
        return clean;
    }

    static Object sanitize(Object value, int depth) {
        if (value == null) return null;
        if (depth > 6) return "…";
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> clean = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                if (isSecretName(key)) continue;
                if (clean.size() >= MAX_ITEMS) break;
                clean.put(key, sanitize(entry.getValue(), depth + 1));
            }
            return clean;
        }
        if (value instanceof Collection<?> collection) {
            List<Object> clean = new ArrayList<>();
            for (Object item : collection) {
                if (clean.size() >= MAX_ITEMS) break;
                clean.add(sanitize(item, depth + 1));
            }
            return clean;
        }
        if (value instanceof Number || value instanceof Boolean) return value;
        if (value instanceof Enum<?> e) return e.name();
        String text = value.toString();
        return text.length() > MAX_STRING ? text.substring(0, MAX_STRING) + "…" : text;
    }

    static boolean isSecretName(String name) {
        if (name.endsWith("Changed") || name.endsWith("Set")) return false;
        return SECRET_NAME.matcher(name).matches();
    }
}
