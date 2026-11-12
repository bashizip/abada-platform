package com.abada.engine.forms;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Currency;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Checks the variables submitted with a human task against the form pinned to
 * the task's definition version. Runs inside the completion transaction, before
 * any variable is written; it reads only the values given and calls nothing.
 *
 * <ul>
 *   <li>{@code visible_when} is evaluated over the process variables overlaid
 *       with the submitted values. A hidden field is never required, and a
 *       value submitted for it is discarded (not written).</li>
 *   <li>A visible input must have a value after completion when it is
 *       required: a submitted value, or the variable's current value. A
 *       required yes/no field must be {@code true}.</li>
 *   <li>Every submitted value is checked against its type and rules.</li>
 *   <li>Display and help-text fields hold no value; submitting one is refused.</li>
 *   <li>Variables the form does not declare pass through unchanged.</li>
 * </ul>
 */
public final class FormSubmission {
    private static final Pattern EMAIL = Pattern.compile("[^@\\s]+@[^@\\s]+\\.[^@\\s]+");
    private static final Pattern URL = Pattern.compile("https?://[^\\s/?#.]+\\.[^\\s]+");

    /** One broken rule: the field id and the rule name, never the value. */
    public record Violation(String field, String rule) {
    }

    /** The variables to write, and the hidden fields whose submitted values were dropped. */
    public record Result(Map<String, Object> accepted, List<String> discarded) {
    }

    /** Thrown when a submission breaks the form; rolls the completion back. */
    public static final class RejectedException extends com.abada.engine.core.exception.ProcessEngineException {
        private final List<Violation> violations;
        private final String formKey;

        public RejectedException(String formKey, List<Violation> violations) {
            super("Form '" + formKey + "' refused the submitted values: " + violations.stream()
                    .map(violation -> violation.field() + " (" + violation.rule() + ")").toList());
            this.formKey = formKey;
            this.violations = List.copyOf(violations);
        }

        public List<Violation> violations() {
            return violations;
        }

        public String formKey() {
            return formKey;
        }
    }

    private FormSubmission() {
    }

    public static Result check(String formKey, FormSchema form, Map<String, Object> current,
            Map<String, Object> submitted) {
        Map<String, Object> given = submitted == null ? Map.of() : submitted;
        Map<String, Object> merged = new HashMap<>(current == null ? Map.of() : current);
        merged.putAll(given);
        Map<String, Object> accepted = new LinkedHashMap<>(given);
        List<String> discarded = new ArrayList<>();
        List<Violation> violations = new ArrayList<>();
        for (FormSchema.Field field : form.fields()) {
            String id = field.id();
            if (!field.input()) {
                if (given.containsKey(id)) violations.add(new Violation(id, "not_submittable"));
                continue;
            }
            if (field.visibleWhen() != null && !field.visibleWhen().test(merged)) {
                if (accepted.remove(id) != null || given.containsKey(id)) discarded.add(id);
                continue;
            }
            Object value = given.containsKey(id) ? given.get(id) : merged.get(id);
            if (empty(value) || (field.type().equals("boolean") && field.required() && !Boolean.TRUE.equals(value))) {
                if (field.required()) violations.add(new Violation(id, "required"));
                if (empty(value)) continue;
            }
            if (!given.containsKey(id)) continue;
            String rule = rule(field, value);
            if (rule != null) violations.add(new Violation(id, rule));
        }
        if (!violations.isEmpty()) throw new RejectedException(formKey, violations);
        return new Result(accepted, List.copyOf(discarded));
    }

    private static final Pattern FILE_ID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private static boolean fileId(Object value) {
        return value instanceof String text && FILE_ID.matcher(text).matches();
    }

    private static boolean empty(Object value) {
        return value == null || (value instanceof String text && text.isEmpty())
                || (value instanceof Collection<?> collection && collection.isEmpty());
    }

    /** The first rule the value breaks, or null. */
    static String rule(FormSchema.Field field, Object value) {
        switch (field.type()) {
            case "string", "textarea", "email", "url" -> {
                if (!(value instanceof String text)) return "type";
                int length = text.codePointCount(0, text.length());
                if (length > FormSchema.MAX_TEXT_LENGTH) return "maxLength";
                if (field.type().equals("email") && !EMAIL.matcher(text).matches()) return "format";
                if (field.type().equals("url") && !URL.matcher(text).matches()) return "format";
                if (field.minLength() != null && length < field.minLength()) return "minLength";
                if (field.maxLength() != null && length > field.maxLength()) return "maxLength";
                if (field.pattern() != null && !field.pattern().matches(text)) return "pattern";
                return null;
            }
            case "number", "currency" -> {
                if (!(value instanceof Number number) || value instanceof Double d && (d.isNaN() || d.isInfinite())) {
                    return "type";
                }
                BigDecimal decimal = new BigDecimal(number.toString());
                if (field.minNumber() != null && decimal.compareTo(field.minNumber()) < 0) return "min";
                if (field.maxNumber() != null && decimal.compareTo(field.maxNumber()) > 0) return "max";
                if (field.type().equals("currency") && field.currency() != null) {
                    int scale = Math.max(0, Currency.getInstance(field.currency()).getDefaultFractionDigits());
                    if (decimal.stripTrailingZeros().scale() > scale) return "decimals";
                }
                return null;
            }
            case "boolean" -> {
                return value instanceof Boolean ? null : "type";
            }
            case "select", "radio" -> {
                if (!(value instanceof String text)) return "type";
                return field.options().contains(text) ? null : "option";
            }
            case "multiselect", "checkbox-group" -> {
                if (!(value instanceof Collection<?> items)) return "type";
                List<String> seen = new ArrayList<>();
                for (Object item : items) {
                    if (!(item instanceof String text) || !field.options().contains(text)) return "option";
                    if (seen.contains(text)) return "option";
                    seen.add(text);
                }
                if (field.minNumber() != null && items.size() < field.minNumber().intValue()) return "min";
                if (field.maxNumber() != null && items.size() > field.maxNumber().intValue()) return "max";
                return null;
            }
            case "file" -> {
                // File ids from POST .../tasks/{task}/files; the engine checks each one when it attaches them.
                if (!field.multipleFiles()) return fileId(value) ? null : "type";
                if (!(value instanceof Collection<?> items)) return "type";
                List<Object> seen = new ArrayList<>();
                for (Object item : items) {
                    if (!fileId(item) || seen.contains(item)) return "type";
                    seen.add(item);
                }
                if (field.minNumber() != null && items.size() < field.minNumber().intValue()) return "min";
                if (field.maxNumber() != null && items.size() > field.maxNumber().intValue()) return "max";
                return null;
            }
            case "date", "datetime" -> {
                if (!(value instanceof String text) || FormSchema.parseTemporal(field.type(), text) == null) return "type";
                if (field.minText() != null && FormSchema.compareTemporal(field.type(), text, field.minText()) < 0) return "min";
                if (field.maxText() != null && FormSchema.compareTemporal(field.type(), text, field.maxText()) > 0) return "max";
                return null;
            }
            default -> {
                return null;
            }
        }
    }
}
