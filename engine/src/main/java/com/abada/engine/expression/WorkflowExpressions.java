package com.abada.engine.expression;

import dev.cel.common.CelAbstractSyntaxTree;
import dev.cel.common.CelOptions;
import dev.cel.common.CelValidationException;
import dev.cel.common.ast.CelExpr;
import dev.cel.common.navigation.CelNavigableAst;
import dev.cel.common.types.SimpleType;
import dev.cel.compiler.CelCompiler;
import dev.cel.compiler.CelCompilerBuilder;
import dev.cel.compiler.CelCompilerFactory;
import dev.cel.parser.CelStandardMacro;
import dev.cel.runtime.CelEvaluationException;
import dev.cel.runtime.CelRuntime;
import dev.cel.runtime.CelRuntimeFactory;
import dev.cel.runtime.CelUnknownSet;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Compiles and evaluates workflow expressions (gateway conditions,
 * decision-table rules and inputs) with CEL, the Common Expression Language.
 *
 * <p>CEL is non-Turing-complete, side-effect free and cannot reach the JVM:
 * there is no reflection, I/O, class loading or script execution. Every
 * top-level identifier is declared as {@code dyn} and resolved from the
 * process variables. A variable that is referenced but absent, a type
 * mismatch or a non-boolean condition raises
 * {@link ExpressionEvaluationException}; nothing silently becomes
 * {@code false}.
 *
 * <p>Compiled programs are immutable and cached by source text.
 */
public final class WorkflowExpressions {
    public static final int MAX_EXPRESSION_LENGTH = 4_096;
    private static final int MAX_CACHE_ENTRIES = 10_000;

    private static final CelOptions OPTIONS = CelOptions.current()
            .enableHeterogeneousNumericComparisons(true)
            .build();
    private static final CelCompiler PARSER = baseCompiler().build();
    private static final CelRuntime RUNTIME = CelRuntimeFactory.standardCelRuntimeBuilder()
            .setOptions(OPTIONS)
            .build();
    private static final Map<String, CompiledExpression> CACHE = new ConcurrentHashMap<>();

    private WorkflowExpressions() {}

    private static CelCompilerBuilder baseCompiler() {
        return CelCompilerFactory.standardCelCompilerBuilder()
                .setOptions(OPTIONS)
                .setStandardMacros(CelStandardMacro.STANDARD_MACROS);
    }

    /** Compiles (or returns the cached) expression; throws {@link ExpressionCompileException} when invalid. */
    public static CompiledExpression compile(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new ExpressionCompileException(raw, "expression is empty");
        }
        CompiledExpression cached = CACHE.get(raw);
        if (cached != null) return cached;

        String normalized = ExpressionSyntax.normalize(raw);
        if (normalized.isBlank()) throw new ExpressionCompileException(raw, "expression is empty");
        if (normalized.length() > MAX_EXPRESSION_LENGTH) {
            throw new ExpressionCompileException(raw, "expression exceeds " + MAX_EXPRESSION_LENGTH + " characters");
        }
        CompiledExpression compiled;
        try {
            CelAbstractSyntaxTree parsed = PARSER.parse(normalized).getAst();
            Set<String> identifiers = identifiers(parsed);
            CelCompilerBuilder checker = baseCompiler();
            for (String identifier : identifiers) checker.addVar(identifier, SimpleType.DYN);
            CelAbstractSyntaxTree checked = checker.build().check(parsed).getAst();
            compiled = new CompiledExpression(raw, normalized, Set.copyOf(identifiers),
                    RUNTIME.createProgram(checked));
        } catch (CelValidationException exception) {
            throw new ExpressionCompileException(raw, firstLine(exception.getMessage()));
        } catch (CelEvaluationException exception) {
            throw new ExpressionCompileException(raw, firstLine(exception.getMessage()));
        }
        if (CACHE.size() >= MAX_CACHE_ENTRIES) CACHE.clear();
        CACHE.put(raw, compiled);
        return compiled;
    }

    /** Top-level variables the expression reads (comprehension variables excluded). */
    private static Set<String> identifiers(CelAbstractSyntaxTree ast) {
        Set<String> names = new LinkedHashSet<>();
        Set<String> bound = new LinkedHashSet<>();
        CelNavigableAst.fromAst(ast).getRoot().allNodes().forEach(node -> {
            if (node.getKind() == CelExpr.ExprKind.Kind.IDENT) {
                names.add(node.expr().ident().name());
            } else if (node.getKind() == CelExpr.ExprKind.Kind.COMPREHENSION) {
                bound.add(node.expr().comprehension().iterVar());
                bound.add(node.expr().comprehension().accuVar());
            }
        });
        names.removeAll(bound);
        names.removeIf(name -> name.startsWith("@") || name.startsWith("__"));
        return names;
    }

    private static String firstLine(String message) {
        if (message == null) return "invalid expression";
        String line = message.strip();
        int newline = line.indexOf('\n');
        return newline < 0 ? line : line.substring(0, newline);
    }

    /** An immutable, compiled workflow expression. */
    public record CompiledExpression(String source, String normalized, Set<String> identifiers,
                                     CelRuntime.Program program) {

        /** Evaluates against process variables and returns a plain Java value. */
        public Object evaluate(Map<String, Object> variables) {
            Map<String, Object> activation = new HashMap<>();
            for (String identifier : identifiers) {
                if (variables != null && variables.containsKey(identifier)) {
                    activation.put(identifier, toCel(variables.get(identifier)));
                }
            }
            Object result;
            try {
                result = program.eval(activation);
            } catch (CelEvaluationException exception) {
                throw new ExpressionEvaluationException(source, firstLine(exception.getMessage()));
            }
            if (result instanceof CelUnknownSet) {
                List<String> missing = identifiers.stream().filter(name -> !activation.containsKey(name)).sorted().toList();
                throw new ExpressionEvaluationException(source, "undefined variable(s) " + missing);
            }
            return fromCel(result);
        }

        /** Evaluates a condition; anything other than a boolean result is an error. */
        public boolean test(Map<String, Object> variables) {
            Object result = evaluate(variables);
            if (result instanceof Boolean value) return value;
            throw new ExpressionEvaluationException(source, "condition must evaluate to a boolean, got "
                    + (result == null ? "null" : result.getClass().getSimpleName()));
        }
    }

    static Object toCel(Object value) {
        if (value == null) return dev.cel.common.values.NullValue.NULL_VALUE;
        if (value instanceof Integer || value instanceof Short || value instanceof Byte) {
            return ((Number) value).longValue();
        }
        if (value instanceof Float f) return f.doubleValue();
        if (value instanceof BigDecimal decimal) return decimal.doubleValue();
        if (value instanceof BigInteger integer) return integer.longValue();
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> converted = new LinkedHashMap<>();
            map.forEach((key, entry) -> converted.put(String.valueOf(key), toCel(entry)));
            return converted;
        }
        if (value instanceof Collection<?> collection) {
            List<Object> converted = new ArrayList<>(collection.size());
            collection.forEach(entry -> converted.add(toCel(entry)));
            return converted;
        }
        if (value instanceof Object[] array) {
            List<Object> converted = new ArrayList<>(array.length);
            for (Object entry : array) converted.add(toCel(entry));
            return converted;
        }
        if (value instanceof Enum<?> enumValue) return enumValue.name();
        if (value instanceof java.time.temporal.TemporalAccessor || value instanceof java.util.Date
                || value instanceof java.util.UUID || value instanceof Character) {
            return value.toString();
        }
        return value;
    }

    static Object fromCel(Object value) {
        if (value == null || value instanceof dev.cel.common.values.NullValue) return null;
        if (value instanceof com.google.protobuf.NullValue) return null;
        if (value instanceof com.google.common.primitives.UnsignedLong unsigned) return unsigned.longValue();
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> converted = new LinkedHashMap<>();
            map.forEach((key, entry) -> converted.put(String.valueOf(key), fromCel(entry)));
            return converted;
        }
        if (value instanceof List<?> list) {
            List<Object> converted = new ArrayList<>(list.size());
            list.forEach(entry -> converted.add(fromCel(entry)));
            return converted;
        }
        return value;
    }
}
