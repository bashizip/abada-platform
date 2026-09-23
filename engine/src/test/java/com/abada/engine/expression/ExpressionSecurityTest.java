package com.abada.engine.expression;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Workflow expressions cannot reach the JVM (T1). */
class ExpressionSecurityTest {

    @ParameterizedTest
    @ValueSource(strings = {
            "Java.type('java.lang.Runtime').getRuntime().exec('id')",
            "java.lang.System.exit(0)",
            "this.constructor.constructor('return process')()",
            "load('nashorn:mozilla_compat.js')",
            "x = 1",
            "(function () { return true; })()",
            "a === b",
            "new java.io.File('/etc/passwd').exists()"
    })
    void javaScriptAndJavaAccessIsRejectedOrInert(String expression) {
        assertThatThrownBy(() -> WorkflowExpressions.compile(expression).test(Map.of("x", 1, "a", 1, "b", 1)))
                .isInstanceOfAny(ExpressionCompileException.class, ExpressionEvaluationException.class);
    }

    @Test
    void referencingJavaAsAVariableIsJustAMissingVariable() {
        assertThatThrownBy(() -> WorkflowExpressions.compile("java.lang.Runtime == null").test(Map.of()))
                .isInstanceOf(ExpressionEvaluationException.class)
                .hasMessageContaining("undefined variable");
    }
}
