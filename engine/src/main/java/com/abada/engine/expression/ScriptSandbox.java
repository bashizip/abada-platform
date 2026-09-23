package com.abada.engine.expression;

import com.abada.engine.core.exception.ProcessEngineException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import javax.script.ScriptEngine;
import javax.script.ScriptException;
import org.openjdk.nashorn.api.scripting.NashornScriptEngineFactory;

/**
 * Runs an opt-in script task body in an isolated JavaScript sandbox.
 *
 * <p>The engine is created with {@code --no-java} and a class filter that
 * denies every class, so scripts cannot reach Java types. No Java object is
 * bound into the script scope: variables enter as JSON and leave as JSON.
 * {@code load}, {@code loadWithNewGlobal}, {@code quit} and {@code exit} are
 * removed. Scripts see every variable by name and through a
 * {@code variables} object with {@code get}/{@code put}; a variable changed
 * or created by the script is written back. Numbers produced by a script
 * are doubles, as in JavaScript.
 *
 * <p>Scripts still run inside the workflow transaction and have no CPU time
 * limit; keep them small and deterministic.
 */
public final class ScriptSandbox {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final NashornScriptEngineFactory FACTORY = new NashornScriptEngineFactory();
    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z_$][A-Za-z0-9_$]*");
    private static final String PRELUDE = """
            var load = undefined, loadWithNewGlobal = undefined, quit = undefined, exit = undefined;
            var variables = JSON.parse(__abada_input);
            var __abada_original = {};
            Object.defineProperty(variables, 'put', {value: function (k, v) { this[k] = v; }, enumerable: false});
            Object.defineProperty(variables, 'get', {value: function (k) { return this[k]; }, enumerable: false});
            """;
    private static final String COLLECT = """
            (function (g) {
              var out = {};
              var reserved = {variables: 1, __abada_input: 1, __abada_original: 1, load: 1,
                              loadWithNewGlobal: 1, quit: 1, exit: 1};
              Object.keys(variables).forEach(function (k) {
                var v = variables[k];
                if (typeof v !== 'function' && JSON.stringify(v) !== __abada_original[k]) out[k] = v;
              });
              Object.keys(g).forEach(function (k) {
                var v = g[k];
                if (reserved[k] || typeof v === 'function' || v === undefined) return;
                if (JSON.stringify(v) !== __abada_original[k]) out[k] = v;
              });
              return JSON.stringify(out);
            })(this)
            """;

    private ScriptSandbox() {}

    /** Executes the script and returns only the variables it created or changed. */
    public static Map<String, Object> execute(String taskId, String script, Map<String, Object> variables) {
        if (!ExecutionPolicy.scriptsEnabled()) {
            throw new ProcessEngineException("Script task '" + taskId + "' cannot run: script tasks are disabled ("
                    + ExecutionPolicy.SCRIPTS_ENABLED + "=false)");
        }
        ScriptEngine engine = FACTORY.getScriptEngine(new String[] {"--no-java", "--no-syntax-extensions"},
                ScriptSandbox.class.getClassLoader(), className -> false);
        try {
            engine.put("__abada_input", JSON.writeValueAsString(variables == null ? Map.of() : variables));
            StringBuilder declarations = new StringBuilder(PRELUDE);
            for (String name : variables == null ? List.<String>of() : variables.keySet()) {
                if (!IDENTIFIER.matcher(name).matches() || name.startsWith("__abada")) continue;
                String quoted = JSON.writeValueAsString(name);
                declarations.append("var ").append(name).append(" = variables[").append(quoted).append("];\n")
                        .append("__abada_original[").append(quoted).append("] = JSON.stringify(variables[")
                        .append(quoted).append("]);\n");
            }
            engine.eval(declarations.toString());
            engine.eval(script);
            Object collected = engine.eval(COLLECT);
            Map<String, Object> changed = JSON.readValue(String.valueOf(collected), new TypeReference<>() {});
            return toJavaScriptNumbers(changed);
        } catch (ScriptException exception) {
            throw new ProcessEngineException("Script task '" + taskId + "' failed: " + exception.getMessage(), exception);
        } catch (java.io.IOException exception) {
            throw new ProcessEngineException("Script task '" + taskId + "' produced non-JSON variables", exception);
        }
    }

    @SuppressWarnings("unchecked")
    private static <T> T toJavaScriptNumbers(T value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> converted = new LinkedHashMap<>();
            map.forEach((key, entry) -> converted.put(String.valueOf(key), toJavaScriptNumbers(entry)));
            return (T) converted;
        }
        if (value instanceof List<?> list) {
            return (T) list.stream().map(ScriptSandbox::toJavaScriptNumbers).toList();
        }
        if (value instanceof Number number && !(value instanceof Double)) {
            return (T) Double.valueOf(number.doubleValue());
        }
        return value;
    }
}
