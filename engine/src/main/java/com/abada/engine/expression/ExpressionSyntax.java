package com.abada.engine.expression;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Normalises authored workflow expressions before CEL compilation.
 *
 * <p>Accepts the historical authoring forms: an optional {@code ${...}}
 * wrapper, an optional CDATA wrapper, and the word operators {@code and},
 * {@code or}, {@code eq}, {@code ne}. Word operators are rewritten only
 * outside string literals, so {@code status == 'and'} keeps its literal.
 */
public final class ExpressionSyntax {
    private static final Pattern CDATA = Pattern.compile("^<!\\[CDATA\\[(.*)]]>$", Pattern.DOTALL);
    private static final Pattern WRAPPED = Pattern.compile("^\\$\\{(.*)}$", Pattern.DOTALL);
    private static final Pattern WORD_OPERATOR = Pattern.compile("\\b(and|or|eq|ne)\\b");

    private ExpressionSyntax() {}

    public static String normalize(String raw) {
        if (raw == null) return "";
        String expression = raw.strip();
        Matcher cdata = CDATA.matcher(expression);
        if (cdata.matches()) expression = cdata.group(1).strip();
        Matcher wrapped = WRAPPED.matcher(expression);
        if (wrapped.matches()) expression = wrapped.group(1).strip();
        return rewriteWordOperators(expression);
    }

    private static String rewriteWordOperators(String expression) {
        StringBuilder out = new StringBuilder(expression.length());
        StringBuilder code = new StringBuilder();
        char quote = 0;
        for (int i = 0; i < expression.length(); i++) {
            char c = expression.charAt(i);
            if (quote == 0) {
                if (c == '\'' || c == '"') {
                    out.append(replaceOperators(code));
                    code.setLength(0);
                    quote = c;
                    out.append(c);
                } else {
                    code.append(c);
                }
            } else {
                out.append(c);
                if (c == '\\' && i + 1 < expression.length()) {
                    out.append(expression.charAt(++i));
                } else if (c == quote) {
                    quote = 0;
                }
            }
        }
        out.append(replaceOperators(code));
        return out.toString();
    }

    private static String replaceOperators(CharSequence code) {
        Matcher matcher = WORD_OPERATOR.matcher(code);
        StringBuilder result = new StringBuilder();
        while (matcher.find()) {
            String replacement = switch (matcher.group(1)) {
                case "and" -> "&&";
                case "or" -> "||";
                case "eq" -> "==";
                default -> "!=";
            };
            matcher.appendReplacement(result, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(result);
        return result.toString();
    }
}
