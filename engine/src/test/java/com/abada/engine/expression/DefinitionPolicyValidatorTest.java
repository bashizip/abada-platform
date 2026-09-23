package com.abada.engine.expression;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.parser.AplParser;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Deploy-time gate: CEL compilation, script opt-in, delegate allow-list (T1). */
class DefinitionPolicyValidatorTest {
    private boolean previousScripts;
    private String previousDelegates;

    @BeforeEach
    void rememberPolicy() {
        previousScripts = ExecutionPolicy.scriptsEnabled();
        previousDelegates = String.join(",", ExecutionPolicy.allowedDelegates());
    }

    @AfterEach
    void restorePolicy() {
        ExecutionPolicy.configure(previousScripts, previousDelegates);
    }

    private static byte[] conditionFlow(String condition) {
        return ("version: abada.io/v1\n"
                + "metadata:\n  name: Policy Check\n"
                + "flow:\n  entry: start\n  nodes:\n"
                + "    - id: start\n      type: webhook\n      next: route\n"
                + "    - id: route\n      type: condition\n      rules:\n"
                + "        - if: \"" + condition + "\"\n          then: done\n"
                + "        - else: done\n          then: done\n"
                + "    - id: done\n      type: end\n").getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] scriptFlow() {
        return ("version: abada.io/v1\n"
                + "metadata:\n  name: Script Check\n"
                + "flow:\n  entry: start\n  nodes:\n"
                + "    - id: start\n      type: webhook\n      next: calc\n"
                + "    - id: calc\n      type: script\n      script: \"x = 1\"\n      next: done\n"
                + "    - id: done\n      type: end\n").getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void aMaliciousConditionIsRejectedAtDeployment() {
        assertThatThrownBy(() -> new AplParser().parseDetailed(
                conditionFlow("${Java.type('java.lang.Runtime').getRuntime().exec('id') != null}")))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("ABADA-APL-VALIDATION-001")
                .hasMessageContaining("route");
    }

    @Test
    void aValidCelConditionDeploys() {
        assertThatCode(() -> new AplParser().parseDetailed(conditionFlow("${riskLevel == 'LOW'}")))
                .doesNotThrowAnyException();
    }

    @Test
    void scriptTasksAreRejectedUnlessTheOperatorEnablesThem() {
        ExecutionPolicy.configure(false, previousDelegates);
        assertThatThrownBy(() -> new AplParser().parseDetailed(scriptFlow()))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("script tasks are disabled");

        ExecutionPolicy.configure(true, previousDelegates);
        assertThatCode(() -> new AplParser().parseDetailed(scriptFlow())).doesNotThrowAnyException();
    }

    @Test
    void reloadingAnAdmittedDefinitionDoesNotReapplyThePolicy() {
        ExecutionPolicy.configure(false, previousDelegates);
        assertThat(new AplParser("", false).parseDetailed(scriptFlow()).definition().getScriptTasks())
                .containsKey("calc");
    }

    @Test
    void delegateAllowListParsing() {
        ExecutionPolicy.configure(false, " com.example.A , ,com.example.B ");
        assertThat(ExecutionPolicy.delegateAllowed("com.example.A")).isTrue();
        assertThat(ExecutionPolicy.delegateAllowed("java.lang.Thread")).isFalse();
        assertThat(ExecutionPolicy.delegateAllowed(null)).isFalse();
    }
}
