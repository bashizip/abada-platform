package com.abada.engine.forms;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * A task-form {@code visible_when} expression: the portable CEL subset that the
 * Studio evaluates in the browser and the engine re-checks on completion, with
 * the same result on both sides (the shared cases live in
 * {@code engine/src/test/resources/forms/visibility-conformance.json}).
 *
 * <p>Grammar: identifiers, {@code true false null}, numbers, single- or
 * double-quoted strings, list literals, {@code == != < <= > >=}, {@code in},
 * {@code && || !}, unary {@code -}, parentheses and {@code size(x)}. Semantics
 * that differ from full CEL are deliberate and documented: a missing variable
 * is {@code null}; an ordering comparison of anything but two numbers or two
 * strings is {@code false}; {@code size(null)} is 0; {@code &&}, {@code ||} and
 * {@code !} treat anything but {@code true} as false. A field is visible only
 * when the expression evaluates to {@code true}. Evaluation never throws and
 * cannot reach the JVM.
 */
public final class VisibilityExpression {
    public static final int MAX_LENGTH = 1_024;
    private static final int MAX_DEPTH = 32;

    private final String source;
    private final Node root;

    private VisibilityExpression(String source, Node root) {
        this.source = source;
        this.root = root;
    }

    /** Parses an expression; throws {@link IllegalArgumentException} with a reason when it is outside the subset. */
    public static VisibilityExpression parse(String source) {
        if (source == null || source.isBlank()) throw new IllegalArgumentException("expression is empty");
        if (source.length() > MAX_LENGTH) {
            throw new IllegalArgumentException("expression exceeds " + MAX_LENGTH + " characters");
        }
        Parser parser = new Parser(tokenize(source));
        Node root = parser.expression(0);
        if (!parser.atEnd()) throw new IllegalArgumentException("unexpected '" + parser.peek().text + "'");
        return new VisibilityExpression(source, root);
    }

    public String source() {
        return source;
    }

    /** Identifiers the expression reads. */
    public List<String> identifiers() {
        List<String> names = new ArrayList<>();
        root.collect(names);
        return names.stream().distinct().toList();
    }

    /** True only when the expression evaluates to {@code true} over these values. */
    public boolean test(Map<String, Object> values) {
        return Boolean.TRUE.equals(root.eval(values == null ? Map.of() : values));
    }

    // ---- values -------------------------------------------------------------------------------------------

    private static Object normalize(Object value) {
        if (value instanceof BigDecimal decimal) return decimal;
        if (value instanceof Number number) return new BigDecimal(number.toString());
        if (value instanceof Collection<?> collection) return collection.stream().map(VisibilityExpression::normalize).toList();
        if (value instanceof Object[] array) return java.util.Arrays.stream(array).map(VisibilityExpression::normalize).toList();
        return value;
    }

    private static boolean equal(Object left, Object right) {
        Object a = normalize(left);
        Object b = normalize(right);
        if (a instanceof BigDecimal x && b instanceof BigDecimal y) return x.compareTo(y) == 0;
        if (a instanceof List<?> x && b instanceof List<?> y) {
            if (x.size() != y.size()) return false;
            for (int i = 0; i < x.size(); i++) if (!equal(x.get(i), y.get(i))) return false;
            return true;
        }
        return Objects.equals(a, b);
    }

    private static Object compare(String op, Object left, Object right) {
        Object a = normalize(left);
        Object b = normalize(right);
        int cmp;
        if (a instanceof BigDecimal x && b instanceof BigDecimal y) cmp = x.compareTo(y);
        else if (a instanceof String x && b instanceof String y) cmp = Integer.signum(x.compareTo(y));
        else return false;
        return switch (op) {
            case "<" -> cmp < 0;
            case "<=" -> cmp <= 0;
            case ">" -> cmp > 0;
            default -> cmp >= 0;
        };
    }

    // ---- AST ----------------------------------------------------------------------------------------------

    private interface Node {
        Object eval(Map<String, Object> values);

        default void collect(List<String> names) {
        }
    }

    private record Literal(Object value) implements Node {
        public Object eval(Map<String, Object> values) {
            return value;
        }
    }

    private record Ident(String name) implements Node {
        public Object eval(Map<String, Object> values) {
            return values.get(name);
        }

        public void collect(List<String> names) {
            names.add(name);
        }
    }

    private record ListNode(List<Node> items) implements Node {
        public Object eval(Map<String, Object> values) {
            return items.stream().map(item -> item.eval(values)).toList();
        }

        public void collect(List<String> names) {
            items.forEach(item -> item.collect(names));
        }
    }

    private record Unary(String op, Node operand) implements Node {
        public Object eval(Map<String, Object> values) {
            Object value = operand.eval(values);
            if (op.equals("!")) return !Boolean.TRUE.equals(value);
            Object number = normalize(value);
            return number instanceof BigDecimal decimal ? decimal.negate() : null;
        }

        public void collect(List<String> names) {
            operand.collect(names);
        }
    }

    private record Size(Node operand) implements Node {
        public Object eval(Map<String, Object> values) {
            Object value = normalize(operand.eval(values));
            if (value instanceof String text) return BigDecimal.valueOf(text.codePointCount(0, text.length()));
            if (value instanceof List<?> list) return BigDecimal.valueOf(list.size());
            if (value instanceof Map<?, ?> map) return BigDecimal.valueOf(map.size());
            return BigDecimal.ZERO;
        }

        public void collect(List<String> names) {
            operand.collect(names);
        }
    }

    private record Binary(String op, Node left, Node right) implements Node {
        public Object eval(Map<String, Object> values) {
            switch (op) {
                case "&&":
                    return Boolean.TRUE.equals(left.eval(values)) && Boolean.TRUE.equals(right.eval(values));
                case "||":
                    return Boolean.TRUE.equals(left.eval(values)) || Boolean.TRUE.equals(right.eval(values));
                default:
                    break;
            }
            Object a = left.eval(values);
            Object b = right.eval(values);
            return switch (op) {
                case "==" -> equal(a, b);
                case "!=" -> !equal(a, b);
                case "in" -> {
                    Object container = normalize(b);
                    if (container instanceof List<?> list) yield list.stream().anyMatch(item -> equal(a, item));
                    if (container instanceof Map<?, ?> map) yield map.containsKey(a);
                    yield false;
                }
                default -> compare(op, a, b);
            };
        }

        public void collect(List<String> names) {
            left.collect(names);
            right.collect(names);
        }
    }

    // ---- lexer / parser -----------------------------------------------------------------------------------

    private record Token(String kind, String text) {
    }

    private static List<Token> tokenize(String source) {
        List<Token> tokens = new ArrayList<>();
        int i = 0;
        while (i < source.length()) {
            char c = source.charAt(i);
            if (Character.isWhitespace(c)) {
                i++;
                continue;
            }
            if (c == '\'' || c == '"') {
                int end = i + 1;
                StringBuilder text = new StringBuilder();
                while (end < source.length() && source.charAt(end) != c) {
                    if (source.charAt(end) == '\\') {
                        throw new IllegalArgumentException("escape sequences are not supported in strings");
                    }
                    text.append(source.charAt(end++));
                }
                if (end >= source.length()) throw new IllegalArgumentException("unterminated string");
                tokens.add(new Token("str", text.toString()));
                i = end + 1;
                continue;
            }
            if (Character.isDigit(c)) {
                int end = i;
                while (end < source.length() && (Character.isDigit(source.charAt(end)) || source.charAt(end) == '.')) end++;
                String number = source.substring(i, end);
                if (!number.matches("\\d+(\\.\\d+)?")) throw new IllegalArgumentException("invalid number '" + number + "'");
                tokens.add(new Token("num", number));
                i = end;
                continue;
            }
            if (Character.isLetter(c) || c == '_') {
                int end = i;
                while (end < source.length() && (Character.isLetterOrDigit(source.charAt(end)) || source.charAt(end) == '_')) end++;
                String word = source.substring(i, end);
                if (!word.matches("[A-Za-z_][A-Za-z0-9_]*")) throw new IllegalArgumentException("invalid name '" + word + "'");
                tokens.add(new Token("id", word));
                i = end;
                continue;
            }
            String two = i + 1 < source.length() ? source.substring(i, i + 2) : "";
            if (List.of("==", "!=", "<=", ">=", "&&", "||").contains(two)) {
                tokens.add(new Token("op", two));
                i += 2;
                continue;
            }
            if ("<>!-()[],".indexOf(c) >= 0) {
                tokens.add(new Token("op", String.valueOf(c)));
                i++;
                continue;
            }
            throw new IllegalArgumentException("'" + c + "' is not allowed in a visibility expression"
                    + (c == '.' ? " (member access and method calls are outside the portable subset)" : ""));
        }
        return tokens;
    }

    private static final class Parser {
        private final List<Token> tokens;
        private int at;
        private int depth;

        Parser(List<Token> tokens) {
            this.tokens = tokens;
        }

        boolean atEnd() {
            return at >= tokens.size();
        }

        Token peek() {
            return atEnd() ? new Token("eof", "end of expression") : tokens.get(at);
        }

        private boolean isOp(String text) {
            Token token = peek();
            return (token.kind.equals("op") || token.kind.equals("id")) && token.text.equals(text);
        }

        private void expect(String text) {
            if (!isOp(text)) throw new IllegalArgumentException("expected '" + text + "' but found '" + peek().text + "'");
            at++;
        }

        private static int precedence(String op) {
            return switch (op) {
                case "||" -> 1;
                case "&&" -> 2;
                case "==", "!=", "<", "<=", ">", ">=", "in" -> 3;
                default -> -1;
            };
        }

        Node expression(int minPrecedence) {
            if (++depth > MAX_DEPTH) throw new IllegalArgumentException("expression is nested too deeply");
            Node left = unary();
            while (!atEnd()) {
                Token token = peek();
                boolean binary = token.kind.equals("op") || (token.kind.equals("id") && token.text.equals("in"));
                int precedence = binary ? precedence(token.text) : -1;
                if (precedence < 0 || precedence < minPrecedence) break;
                if (precedence == 3 && left instanceof Binary previous && precedence(previous.op()) == 3) {
                    throw new IllegalArgumentException("comparisons do not chain; combine them with && or ||");
                }
                at++;
                Node right = expression(precedence + 1);
                left = new Binary(token.text, left, right);
            }
            depth--;
            return left;
        }

        private Node unary() {
            if (isOp("!")) {
                at++;
                return new Unary("!", unary());
            }
            if (isOp("-")) {
                at++;
                return new Unary("-", unary());
            }
            return primary();
        }

        private Node primary() {
            Token token = peek();
            if (atEnd()) throw new IllegalArgumentException("expression ends too early");
            at++;
            switch (token.kind) {
                case "num":
                    return new Literal(new BigDecimal(token.text));
                case "str":
                    return new Literal(token.text);
                case "id":
                    switch (token.text) {
                        case "true":
                            return new Literal(Boolean.TRUE);
                        case "false":
                            return new Literal(Boolean.FALSE);
                        case "null":
                            return new Literal(null);
                        case "in":
                            throw new IllegalArgumentException("'in' needs a value on its left");
                        case "size": {
                            if (!isOp("(")) throw new IllegalArgumentException("size needs parentheses: size(x)");
                            at++;
                            Node operand = expression(0);
                            expect(")");
                            return new Size(operand);
                        }
                        default:
                            if (isOp("(")) {
                                throw new IllegalArgumentException("function '" + token.text
                                        + "' is outside the portable subset (only size() is allowed)");
                            }
                            return new Ident(token.text);
                    }
                default:
                    break;
            }
            if (token.text.equals("(")) {
                Node inner = expression(0);
                expect(")");
                return inner;
            }
            if (token.text.equals("[")) {
                List<Node> items = new ArrayList<>();
                if (!isOp("]")) {
                    do {
                        items.add(expression(0));
                        if (!isOp(",")) break;
                        at++;
                    } while (true);
                }
                expect("]");
                return new ListNode(items);
            }
            throw new IllegalArgumentException("unexpected '" + token.text + "'");
        }
    }
}
