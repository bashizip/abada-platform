package com.abada.engine.forms;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Currency;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A task form as the engine enforces it: the FORM project resource
 * ({@code forms/<key>.json}) parsed and checked when a definition that uses it
 * is deployed. The Studio's {@code features/inbox/formSchema.ts} is the same
 * contract; {@code docs/reference/apl-node-reference.md} documents it.
 *
 * <p>{@code fields} is the flat, canonical list (a field's {@code id} is the
 * process variable it writes); the optional {@code layout} only places field
 * ids into sections, rows and steps. Unknown properties are ignored so the
 * Studio can carry presentation hints (placeholder, default value).
 */
public record FormSchema(String title, List<Field> fields, Map<String, Field> byId) {

    /** Every field type; {@code file} is reserved until file upload (S9) and refused at deploy. */
    public static final Set<String> TYPES = Set.of("string", "textarea", "number", "boolean", "select", "date",
            "email", "url", "currency", "multiselect", "radio", "checkbox-group", "datetime", "display", "markdown");
    public static final Set<String> NON_INPUT = Set.of("display", "markdown");
    public static final int MAX_FIELDS = 200;
    public static final int MAX_ROW_CELLS = 4;
    public static final int GRID_COLUMNS = 4;
    public static final int MAX_TEXT_LENGTH = 10_000;
    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final Pattern ISO_DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Set<String> TEXT = Set.of("string", "textarea", "email", "url");
    private static final Set<String> CHOICE = Set.of("select", "radio", "multiselect", "checkbox-group");
    private static final Set<String> MULTI = Set.of("multiselect", "checkbox-group");

    /**
     * One field. {@code min}/{@code max} are numbers for number/currency,
     * selection counts for multiselect/checkbox-group, and ISO strings for
     * date/datetime (kept as text, compared after parsing).
     */
    public record Field(String id, String type, String label, boolean required, List<String> options,
            BigDecimal minNumber, BigDecimal maxNumber, String minText, String maxText,
            Integer minLength, Integer maxLength, com.google.re2j.Pattern pattern, String currency,
            VisibilityExpression visibleWhen, String variable) {

        public boolean input() {
            return !NON_INPUT.contains(type);
        }

        public boolean multi() {
            return MULTI.contains(type);
        }
    }

    /** A form that cannot be enforced; {@code problems} name the field and the rule, never a value. */
    public static final class InvalidFormException extends RuntimeException {
        private final List<String> problems;

        public InvalidFormException(List<String> problems) {
            super(String.join("; ", problems));
            this.problems = List.copyOf(problems);
        }

        public List<String> problems() {
            return problems;
        }
    }

    public Field field(String id) {
        return byId.get(id);
    }

    /** Parses and validates a form document, or throws {@link InvalidFormException} listing every problem. */
    public static FormSchema parse(JsonNode root) {
        List<String> problems = new ArrayList<>();
        if (root == null || !root.isObject()) throw new InvalidFormException(List.of("the form must be a JSON object"));
        JsonNode fieldsNode = root.path("fields");
        if (!fieldsNode.isArray()) throw new InvalidFormException(List.of("'fields' must be a list"));
        if (fieldsNode.size() > MAX_FIELDS) problems.add("a form holds at most " + MAX_FIELDS + " fields");
        List<Field> fields = new ArrayList<>();
        Map<String, Field> byId = new LinkedHashMap<>();
        for (int i = 0; i < fieldsNode.size(); i++) {
            Field field = parseField(fieldsNode.get(i), "fields/" + i, problems);
            if (field == null) continue;
            if (byId.containsKey(field.id())) {
                problems.add("fields/" + i + ": id '" + field.id() + "' is used twice");
                continue;
            }
            byId.put(field.id(), field);
            fields.add(field);
        }
        JsonNode layout = root.path("layout");
        if (!layout.isMissingNode() && !layout.isNull()) validateLayout(layout, byId.keySet(), problems);
        if (!problems.isEmpty()) throw new InvalidFormException(problems);
        String title = root.path("title").isTextual() ? root.path("title").asText() : null;
        return new FormSchema(title, List.copyOf(fields), Map.copyOf(byId));
    }

    private static Field parseField(JsonNode node, String at, List<String> problems) {
        if (!node.isObject()) {
            problems.add(at + ": a field must be an object");
            return null;
        }
        String id = node.path("id").asText("");
        String type = node.path("type").asText("");
        String where = at + " ('" + id + "')";
        if (!IDENTIFIER.matcher(id).matches()) {
            problems.add(at + ": id '" + id + "' must be letters, digits and _, not starting with a digit");
            return null;
        }
        if (type.equals("file")) {
            problems.add(where + ": file fields arrive with file upload; remove the field or change its type");
            return null;
        }
        if (!TYPES.contains(type)) {
            problems.add(where + ": unknown type '" + type + "'; expected one of " + new java.util.TreeSet<>(TYPES));
            return null;
        }
        boolean required = node.path("required").asBoolean(false);
        if (required && NON_INPUT.contains(type)) problems.add(where + ": a " + type + " field cannot be required");

        List<String> options = List.of();
        if (CHOICE.contains(type)) {
            options = parseOptions(node.path("options"), where, problems);
        } else if (node.has("options")) {
            problems.add(where + ": 'options' only applies to select, radio, multiselect and checkbox-group");
        }

        Integer minLength = intRule(node, "minLength", where, problems);
        Integer maxLength = intRule(node, "maxLength", where, problems);
        if ((minLength != null || maxLength != null) && !TEXT.contains(type)) {
            problems.add(where + ": minLength/maxLength only apply to text fields");
        }
        if (minLength != null && maxLength != null && minLength > maxLength) {
            problems.add(where + ": minLength is larger than maxLength");
        }
        if (maxLength != null && maxLength > MAX_TEXT_LENGTH) {
            problems.add(where + ": maxLength is at most " + MAX_TEXT_LENGTH);
        }

        com.google.re2j.Pattern pattern = null;
        if (node.hasNonNull("pattern")) {
            if (!type.equals("string") && !type.equals("textarea")) {
                problems.add(where + ": 'pattern' only applies to string and textarea fields");
            } else {
                pattern = compilePattern(node.path("pattern").asText(), where, problems);
            }
        }

        BigDecimal minNumber = null;
        BigDecimal maxNumber = null;
        String minText = null;
        String maxText = null;
        boolean hasMin = node.hasNonNull("min");
        boolean hasMax = node.hasNonNull("max");
        if (hasMin || hasMax) {
            if (type.equals("number") || type.equals("currency") || MULTI.contains(type)) {
                minNumber = numberRule(node, "min", where, problems);
                maxNumber = numberRule(node, "max", where, problems);
                if (MULTI.contains(type) && ((minNumber != null && minNumber.signum() < 0)
                        || (maxNumber != null && maxNumber.signum() < 0))) {
                    problems.add(where + ": selection counts cannot be negative");
                }
                if (minNumber != null && maxNumber != null && minNumber.compareTo(maxNumber) > 0) {
                    problems.add(where + ": min is larger than max");
                }
            } else if (type.equals("date") || type.equals("datetime")) {
                minText = temporalRule(node, "min", type, where, problems);
                maxText = temporalRule(node, "max", type, where, problems);
                if (minText != null && maxText != null && compareTemporal(type, minText, maxText) > 0) {
                    problems.add(where + ": min is later than max");
                }
            } else {
                problems.add(where + ": min/max do not apply to a " + type + " field");
            }
        }

        String currency = null;
        if (type.equals("currency")) {
            currency = node.path("currency").asText("");
            try {
                Currency.getInstance(currency);
            } catch (IllegalArgumentException exception) {
                problems.add(where + ": currency '" + currency + "' is not an ISO 4217 code");
                currency = null;
            }
        }

        VisibilityExpression visibleWhen = null;
        if (node.hasNonNull("visible_when")) {
            String expression = node.path("visible_when").asText("");
            try {
                visibleWhen = VisibilityExpression.parse(expression);
                if (visibleWhen.identifiers().contains(id)) {
                    problems.add(where + ": visible_when cannot depend on the field itself");
                }
            } catch (IllegalArgumentException exception) {
                problems.add(where + ": visible_when " + exception.getMessage());
            }
        }

        String variable = null;
        if (type.equals("display")) {
            variable = node.path("variable").asText("");
            if (!IDENTIFIER.matcher(variable).matches()) {
                problems.add(where + ": a display field names the process variable it shows in 'variable'");
            }
        }
        String label = node.path("label").asText(id);
        return new Field(id, type, label, required, options, minNumber, maxNumber, minText, maxText,
                minLength, maxLength, pattern, currency, visibleWhen, variable);
    }

    private static List<String> parseOptions(JsonNode node, String where, List<String> problems) {
        if (!node.isArray() || node.isEmpty()) {
            problems.add(where + ": needs at least one option");
            return List.of();
        }
        List<String> values = new ArrayList<>();
        for (JsonNode option : node) {
            String value = option.isTextual() ? option.asText() : option.path("value").isTextual()
                    ? option.path("value").asText() : null;
            if (value == null || value.isEmpty()) {
                problems.add(where + ": an option is a non-empty string or { value, label }");
                continue;
            }
            if (values.contains(value)) problems.add(where + ": option '" + value + "' is listed twice");
            values.add(value);
        }
        return List.copyOf(values);
    }

    private static Integer intRule(JsonNode node, String name, String where, List<String> problems) {
        if (!node.hasNonNull(name)) return null;
        JsonNode value = node.path(name);
        if (!value.canConvertToInt() || !value.isIntegralNumber() || value.asInt() < 0) {
            problems.add(where + ": " + name + " must be a whole number of 0 or more");
            return null;
        }
        return value.asInt();
    }

    private static BigDecimal numberRule(JsonNode node, String name, String where, List<String> problems) {
        if (!node.hasNonNull(name)) return null;
        JsonNode value = node.path(name);
        if (!value.isNumber()) {
            problems.add(where + ": " + name + " must be a number");
            return null;
        }
        return value.decimalValue();
    }

    private static String temporalRule(JsonNode node, String name, String type, String where, List<String> problems) {
        if (!node.hasNonNull(name)) return null;
        String value = node.path(name).asText("");
        if (parseTemporal(type, value) == null) {
            problems.add(where + ": " + name + " must be " + (type.equals("date")
                    ? "a date like 2026-11-27" : "an ISO-8601 instant like 2026-11-27T09:00:00Z"));
            return null;
        }
        return value;
    }

    /** An ISO date ({@code YYYY-MM-DD}) or instant with offset; null when it is neither. */
    static Comparable<?> parseTemporal(String type, String value) {
        try {
            if (type.equals("date")) {
                return ISO_DATE.matcher(value).matches() ? LocalDate.parse(value) : null;
            }
            return OffsetDateTime.parse(value).toInstant();
        } catch (DateTimeParseException exception) {
            try {
                return type.equals("datetime") ? Instant.parse(value) : null;
            } catch (DateTimeParseException ignored) {
                return null;
            }
        }
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static int compareTemporal(String type, String left, String right) {
        Comparable a = parseTemporal(type, left);
        Comparable b = parseTemporal(type, right);
        return a.compareTo(b);
    }

    /**
     * Compiles a pattern with RE2 (linear time, no look-around or
     * back-references) and refuses RE2 syntax a browser's RegExp reads
     * differently, so the Studio and the engine accept the same values.
     * Patterns match the whole value, like the HTML {@code pattern} attribute.
     */
    private static com.google.re2j.Pattern compilePattern(String source, String where, List<String> problems) {
        if (source.isEmpty() || source.length() > 512) {
            problems.add(where + ": pattern must be 1 to 512 characters");
            return null;
        }
        for (String construct : List.of("(?P", "(?i", "(?m", "(?s", "(?U", "\\z", "\\A", "\\C", "\\Q", "[[:")) {
            if (source.contains(construct)) {
                problems.add(where + ": pattern uses '" + construct + "', which browsers read differently");
                return null;
            }
        }
        try {
            return com.google.re2j.Pattern.compile(source);
        } catch (com.google.re2j.PatternSyntaxException exception) {
            problems.add(where + ": pattern is not a portable regular expression (" + exception.getDescription() + ")");
            return null;
        }
    }

    private static void validateLayout(JsonNode layout, Set<String> fieldIds, List<String> problems) {
        if (!layout.isObject()) {
            problems.add("layout must be an object");
            return;
        }
        JsonNode sections = layout.path("sections");
        if (!sections.isArray() || sections.isEmpty()) {
            problems.add("layout.sections must list at least one section");
            return;
        }
        Set<String> sectionIds = new HashSet<>();
        Map<String, Integer> placed = new LinkedHashMap<>();
        List<String> order = new ArrayList<>();
        for (int s = 0; s < sections.size(); s++) {
            JsonNode section = sections.get(s);
            String at = "layout.sections/" + s;
            String sid = section.path("id").asText("");
            if (!IDENTIFIER.matcher(sid).matches()) problems.add(at + ": id must be letters, digits and _");
            else if (!sectionIds.add(sid)) problems.add(at + ": section id '" + sid + "' is used twice");
            order.add(sid);
            JsonNode rows = section.path("rows");
            if (!rows.isArray()) {
                problems.add(at + ": rows must be a list");
                continue;
            }
            for (int r = 0; r < rows.size(); r++) {
                JsonNode row = rows.get(r);
                String rat = at + "/rows/" + r;
                if (!row.isArray() || row.isEmpty() || row.size() > MAX_ROW_CELLS) {
                    problems.add(rat + ": a row holds 1 to " + MAX_ROW_CELLS + " fields");
                    continue;
                }
                int width = 0;
                for (JsonNode cell : row) {
                    String field = cell.isTextual() ? cell.asText() : cell.path("field").asText("");
                    int span = cell.isTextual() ? 1 : cell.path("span").asInt(1);
                    if (cell.isObject() && cell.has("span") && (!cell.path("span").isInt() || span < 1 || span > GRID_COLUMNS)) {
                        problems.add(rat + ": span of '" + field + "' must be 1 to " + GRID_COLUMNS);
                    }
                    width += Math.max(1, Math.min(span, GRID_COLUMNS));
                    if (!fieldIds.contains(field)) problems.add(rat + ": '" + field + "' is not a field of this form");
                    else placed.merge(field, 1, Integer::sum);
                }
                if (width > GRID_COLUMNS) problems.add(rat + ": the spans add up to " + width + ", more than " + GRID_COLUMNS);
            }
        }
        for (String id : fieldIds) {
            int count = placed.getOrDefault(id, 0);
            if (count == 0) problems.add("layout: field '" + id + "' is not placed in any section");
            if (count > 1) problems.add("layout: field '" + id + "' is placed " + count + " times");
        }
        JsonNode steps = layout.path("steps");
        if (steps.isMissingNode() || steps.isNull()) return;
        if (!steps.isArray() || steps.isEmpty()) {
            problems.add("layout.steps must list at least one step when present");
            return;
        }
        List<String> covered = new ArrayList<>();
        for (int i = 0; i < steps.size(); i++) {
            JsonNode list = steps.get(i).path("sections");
            if (!list.isArray() || list.isEmpty()) {
                problems.add("layout.steps/" + i + ": a step lists at least one section");
                continue;
            }
            for (JsonNode sid : list) {
                if (!sectionIds.contains(sid.asText())) problems.add("layout.steps/" + i + ": unknown section '" + sid.asText() + "'");
                covered.add(sid.asText());
            }
        }
        if (!covered.equals(order.stream().filter(sectionIds::contains).toList())) {
            problems.add("layout.steps must cover every section exactly once, in section order");
        }
    }
}
