package com.abada.engine.expression;

import com.abada.engine.core.exception.ProcessEngineException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Opt-in script tasks run without any reachable Java object (T1). */
class ScriptSandboxTest {
    private boolean previousScripts;
    private String previousDelegates;

    @BeforeEach
    void enableScripts() {
        previousScripts = ExecutionPolicy.scriptsEnabled();
        previousDelegates = String.join(",", ExecutionPolicy.allowedDelegates());
        ExecutionPolicy.configure(true, previousDelegates);
    }

    @AfterEach
    void restorePolicy() {
        ExecutionPolicy.configure(previousScripts, previousDelegates);
    }

    @Test
    void returnsOnlyCreatedOrChangedVariablesAsJavaScriptNumbers() {
        Map<String, Object> changed = ScriptSandbox.execute("s1",
                "scriptResult = input * 2; variables.put('tier', input > 10 ? 'premium' : 'standard');",
                Map.of("input", 21, "untouched", "keep"));
        assertThat(changed).containsEntry("scriptResult", 42.0).containsEntry("tier", "premium")
                .doesNotContainKeys("input", "untouched", "variables");
    }

    @Test
    void readsNestedVariables() {
        Map<String, Object> changed = ScriptSandbox.execute("s2",
                "variables.put('count', order.items.length); total = variables.get('order').total;",
                Map.of("order", Map.of("items", List.of("a", "b"), "total", 12.5)));
        assertThat(changed).containsEntry("count", 2.0).containsEntry("total", 12.5);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "Java.type('java.lang.Runtime').getRuntime().exec('id')",
            "java.lang.System.exit(0)",
            "Packages.java.lang.System.getProperty('user.home')",
            "load('nashorn:mozilla_compat.js')",
            "loadWithNewGlobal({script: '1'})",
            "variables.getClass().forName('java.lang.Runtime')",
            "quit()"
    })
    void cannotReachTheJvm(String script) {
        assertThatThrownBy(() -> ScriptSandbox.execute("evil", script, Map.of("input", 1)))
                .isInstanceOf(ProcessEngineException.class);
    }

    @Test
    void refusesToRunWhenScriptsAreDisabled() {
        ExecutionPolicy.configure(false, previousDelegates);
        assertThatThrownBy(() -> ScriptSandbox.execute("s3", "x = 1", Map.of()))
                .isInstanceOf(ProcessEngineException.class)
                .hasMessageContaining(ExecutionPolicy.SCRIPTS_ENABLED);
    }
}
