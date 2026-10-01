package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/** BPMN imports follow the APL loop rule: a cycle needs abada:maxIterations on the node it returns to. */
@SpringBootTest(classes = AbadaEngineApplication.class)
@ActiveProfiles("test")
class BpmnLoopDeploymentTest {

    @Autowired AbadaEngine engine;
    @Autowired TaskManager tasks;
    @Autowired DatabaseTestHelper database;

    @BeforeEach
    void clean() {
        database.cleanup();
    }

    private static String reviewLoop(String key, String boundAttributes) {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                    xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                    xmlns:abada="https://abada.io/schema/bpmn" id="d" targetNamespace="t">
                  <bpmn:process id="%s" name="Review loop" isExecutable="true">
                    <bpmn:startEvent id="start"/>
                    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
                    <bpmn:userTask id="review" name="Review" camunda:candidateGroups="reviewers" %s/>
                    <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="decide"/>
                    <bpmn:exclusiveGateway id="decide" default="again"/>
                    <bpmn:sequenceFlow id="ok" sourceRef="decide" targetRef="end">
                      <bpmn:conditionExpression>${approved == true}</bpmn:conditionExpression>
                    </bpmn:sequenceFlow>
                    <bpmn:sequenceFlow id="again" sourceRef="decide" targetRef="review"/>
                    <bpmn:endEvent id="end"/>
                  </bpmn:process>
                </bpmn:definitions>
                """.formatted(key, boundAttributes);
    }

    private void deploy(String xml) {
        engine.deploy(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void anUnboundedBpmnCycleIsRejectedAtDeployment() {
        assertThatThrownBy(() -> deploy(reviewLoop("unbounded", "")))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("ABADA-BPMN-LOOP-001")
                .hasMessageContaining("cycle back to node 'review'");
    }

    @Test
    void aBoundedBpmnCycleRunsAndStopsAtItsLimit() {
        deploy(reviewLoop("bounded", "abada:maxIterations=\"2\""));
        String id = engine.startProcess("bounded", "alice", Map.of()).getId();

        for (int pass = 1; pass <= 2; pass++) {
            assertThat(engine.getProcessInstanceById(id).getVariables()).containsEntry("review_iteration", pass);
            var review = tasks.getTasksForProcessInstance(id).stream()
                    .filter(task -> task.getEndDate() == null).findFirst().orElseThrow();
            engine.completeTask(review.getId(), "alice", List.of("reviewers"), Map.of("approved", false));
        }

        ProcessInstance instance = engine.getProcessInstanceById(id);
        assertThat(instance.isCompleted()).isFalse();
        assertThat(instance.getTokens()).anySatisfy(token ->
                assertThat(token.state()).isEqualTo(ProcessToken.State.INCIDENT));
    }

    @Test
    void anInvalidBoundIsRejected() {
        assertThatThrownBy(() -> deploy(reviewLoop("bad_bound", "abada:maxIterations=\"zero\"")))
                .isInstanceOf(BpmnValidationException.class)
                .hasMessageContaining("abada:maxIterations must be an integer between 1 and 1000");
    }

    @Test
    void multiInstanceMarkersAreRejectedInsteadOfRunningOnce() {
        String xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                    xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="t">
                  <bpmn:process id="multi" name="Multi" isExecutable="true">
                    <bpmn:startEvent id="start"/>
                    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
                    <bpmn:userTask id="review" camunda:candidateGroups="reviewers">
                      <bpmn:multiInstanceLoopCharacteristics isSequential="true"/>
                    </bpmn:userTask>
                    <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="end"/>
                    <bpmn:endEvent id="end"/>
                  </bpmn:process>
                </bpmn:definitions>
                """;
        assertThatThrownBy(() -> deploy(xml))
                .isInstanceOf(ProcessEngineException.class)
                .hasMessageContaining("multiInstanceLoopCharacteristics(review)");
    }

    @Test
    void theRecipeSampleWithItsBoundedLoopDeploys() throws Exception {
        try (var stream = getClass().getResourceAsStream("/bpmn/recipe-cook.bpmn")) {
            engine.deploy(stream);
        }
        assertThat(engine.getDeployedProcesses()).anySatisfy(definition ->
                assertThat(definition.getProcessKey()).isEqualTo("recipe-cook"));
    }
}
