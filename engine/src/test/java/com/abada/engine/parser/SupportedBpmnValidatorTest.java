package com.abada.engine.parser;

import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.exception.ProcessEngineException;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

class SupportedBpmnValidatorTest {
    @Test
    void rejectsUnsupportedReceiveTask() {
        String xml = process("<bpmn:receiveTask id=\"unsupported\" />",
                "<bpmn:sequenceFlow id=\"f1\" sourceRef=\"start\" targetRef=\"unsupported\"/>" +
                "<bpmn:sequenceFlow id=\"f2\" sourceRef=\"unsupported\" targetRef=\"end\"/>");

        ProcessEngineException error = assertThrows(ProcessEngineException.class, () -> parse(xml));
        assertTrue(error.getMessage().contains("receiveTask(unsupported)"));
    }

    @Test
    void executesJavascriptAndPublishesBindingsAsVariables() {
        String xml = process("<bpmn:scriptTask id=\"script\" scriptFormat=\"javascript\"><bpmn:script>variables.put('result', input * 2);</bpmn:script></bpmn:scriptTask>",
                "<bpmn:sequenceFlow id=\"f1\" sourceRef=\"start\" targetRef=\"script\"/>" +
                "<bpmn:sequenceFlow id=\"f2\" sourceRef=\"script\" targetRef=\"end\"/>");

        ProcessInstance instance = new ProcessInstance(parse(xml));
        instance.setVariable("input", 21);
        instance.advance();

        assertEquals(42.0, ((Number) instance.getVariable("result")).doubleValue());
        assertTrue(instance.isCompleted());
    }

    @Test
    void rejectsEventBasedGatewayWithASingleCatchChild() {
        String xml = eventGatewayModel("""
                <bpmn:eventBasedGateway id="gw">
                  <bpmn:incoming>f1</bpmn:incoming>
                  <bpmn:outgoing>f2</bpmn:outgoing>
                </bpmn:eventBasedGateway>
                <bpmn:intermediateCatchEvent id="c1">
                  <bpmn:incoming>f2</bpmn:incoming>
                  <bpmn:outgoing>f4</bpmn:outgoing>
                  <bpmn:messageEventDefinition messageRef="m1" />
                </bpmn:intermediateCatchEvent>
                """.stripIndent(),
                """
                <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="gw"/>
                <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="c1"/>
                <bpmn:sequenceFlow id="f4" sourceRef="c1" targetRef="end"/>
                """.stripIndent());

        ProcessEngineException error = assertThrows(ProcessEngineException.class, () -> parse(xml));
        assertTrue(error.getMessage().contains("at least two outgoing catch events"), error.getMessage());
    }

    @Test
    void rejectsEventBasedGatewayOutgoingToANonCatchNode() {
        String xml = eventGatewayModel("""
                <bpmn:eventBasedGateway id="gw">
                  <bpmn:incoming>f1</bpmn:incoming>
                  <bpmn:outgoing>f2</bpmn:outgoing>
                  <bpmn:outgoing>f3</bpmn:outgoing>
                </bpmn:eventBasedGateway>
                <bpmn:intermediateCatchEvent id="c1">
                  <bpmn:incoming>f2</bpmn:incoming>
                  <bpmn:outgoing>f4</bpmn:outgoing>
                  <bpmn:messageEventDefinition messageRef="m1" />
                </bpmn:intermediateCatchEvent>
                """.stripIndent(),
                """
                <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="gw"/>
                <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="c1"/>
                <bpmn:sequenceFlow id="f3" sourceRef="gw" targetRef="end"/>
                <bpmn:sequenceFlow id="f4" sourceRef="c1" targetRef="end"/>
                """.stripIndent());

        ProcessEngineException error = assertThrows(ProcessEngineException.class, () -> parse(xml));
        assertTrue(error.getMessage().contains("must end at a supported catch event"), error.getMessage());
    }

    @Test
    void acceptsEventBasedGatewayWithTwoCompetingCatchChildren() {
        String xml = eventGatewayModel("""
                <bpmn:eventBasedGateway id="gw">
                  <bpmn:incoming>f1</bpmn:incoming>
                  <bpmn:outgoing>f2</bpmn:outgoing>
                  <bpmn:outgoing>f3</bpmn:outgoing>
                </bpmn:eventBasedGateway>
                <bpmn:intermediateCatchEvent id="c1">
                  <bpmn:incoming>f2</bpmn:incoming>
                  <bpmn:outgoing>f4</bpmn:outgoing>
                  <bpmn:messageEventDefinition messageRef="m1" />
                </bpmn:intermediateCatchEvent>
                <bpmn:intermediateCatchEvent id="c2">
                  <bpmn:incoming>f3</bpmn:incoming>
                  <bpmn:outgoing>f5</bpmn:outgoing>
                  <bpmn:timerEventDefinition>
                    <bpmn:timeDuration>PT1H</bpmn:timeDuration>
                  </bpmn:timerEventDefinition>
                </bpmn:intermediateCatchEvent>
                """.stripIndent(),
                """
                <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="gw"/>
                <bpmn:sequenceFlow id="f2" sourceRef="gw" targetRef="c1"/>
                <bpmn:sequenceFlow id="f3" sourceRef="gw" targetRef="c2"/>
                <bpmn:sequenceFlow id="f4" sourceRef="c1" targetRef="end"/>
                <bpmn:sequenceFlow id="f5" sourceRef="c2" targetRef="end"/>
                """.stripIndent());

        com.abada.engine.core.model.ParsedProcessDefinition definition = parse(xml);
        assertTrue(definition.isEventGateway("gw"));
        assertEquals(2, definition.getEventGatewayChildren("gw").size());
        assertEquals("gw", definition.getEventGatewayOf("c1"));
        assertEquals("gw", definition.getEventGatewayOf("c2"));
    }

    @Test
    void mapsInterruptingTimerAndErrorBoundariesToTheRuntimeBoundaries() {
        String xml = boundaryModel("""
                <bpmn:userTask id="review" abada:slaHours="4" abada:escalateTo="managers, directors"/>
                <bpmn:boundaryEvent id="reviewTimeout" attachedToRef="review">
                  <bpmn:timerEventDefinition><bpmn:timeDuration>P3D</bpmn:timeDuration></bpmn:timerEventDefinition>
                </bpmn:boundaryEvent>
                <bpmn:serviceTask id="notify" camunda:topic="notify"/>
                <bpmn:boundaryEvent id="notifyRejected" attachedToRef="notify">
                  <bpmn:errorEventDefinition errorRef="rejected"/>
                </bpmn:boundaryEvent>
                <bpmn:boundaryEvent id="notifyFailed" attachedToRef="notify">
                  <bpmn:errorEventDefinition/>
                </bpmn:boundaryEvent>
                <bpmn:endEvent id="expired"/>
                <bpmn:endEvent id="manual"/>
                """, """
                <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
                <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="notify"/>
                <bpmn:sequenceFlow id="f3" sourceRef="notify" targetRef="end"/>
                <bpmn:sequenceFlow id="f4" sourceRef="reviewTimeout" targetRef="expired"/>
                <bpmn:sequenceFlow id="f5" sourceRef="notifyRejected" targetRef="manual"/>
                <bpmn:sequenceFlow id="f6" sourceRef="notifyFailed" targetRef="end"/>
                """);

        var definition = parse(xml);
        var timeout = definition.boundaryFor("review", com.abada.engine.core.model.BoundaryMeta.Kind.TIMEOUT, null);
        assertEquals(java.time.Duration.ofDays(3), timeout.after());
        assertEquals("expired", timeout.target());
        assertEquals("manual", definition.boundaryFor("notify",
                com.abada.engine.core.model.BoundaryMeta.Kind.ERROR, "REJECTED").target(), "code-specific first");
        assertEquals("end", definition.boundaryFor("notify",
                com.abada.engine.core.model.BoundaryMeta.Kind.ERROR, "WORK_FAILED").target(), "catch-all last");
        assertEquals(4.0, definition.getUserTask("review").getSlaHours());
        assertEquals(java.util.List.of("managers", "directors"), definition.getUserTask("review").getEscalateTo());

        // The boundary flow leaves from the task itself and is never its normal exit.
        ProcessInstance instance = new ProcessInstance(definition);
        instance.advance();
        assertEquals(java.util.List.of("review"), instance.getActiveTokens());
        instance.leaveViaBoundary("review", timeout);
        assertTrue(instance.isCompleted());
    }

    @Test
    void rejectsBoundariesTheRuntimeCannotHonour() {
        String messageBoundary = boundaryModel("""
                <bpmn:userTask id="review"/>
                <bpmn:boundaryEvent id="b" attachedToRef="review"><bpmn:messageEventDefinition/></bpmn:boundaryEvent>
                """, """
                <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
                <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="end"/>
                <bpmn:sequenceFlow id="f3" sourceRef="b" targetRef="end"/>
                """);
        assertTrue(assertThrows(ProcessEngineException.class, () -> parse(messageBoundary)).getMessage()
                .contains("only timer and error boundary events"));

        String nonInterrupting = messageBoundary.replace("<bpmn:boundaryEvent id=\"b\" attachedToRef=\"review\">"
                        + "<bpmn:messageEventDefinition/>",
                "<bpmn:boundaryEvent id=\"b\" attachedToRef=\"review\" cancelActivity=\"false\">"
                        + "<bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition>");
        assertTrue(assertThrows(ProcessEngineException.class, () -> parse(nonInterrupting)).getMessage()
                .contains("non-interrupting"));

        String onScript = boundaryModel("""
                <bpmn:scriptTask id="calc" scriptFormat="javascript"><bpmn:script>1</bpmn:script></bpmn:scriptTask>
                <bpmn:boundaryEvent id="b" attachedToRef="calc"><bpmn:errorEventDefinition/></bpmn:boundaryEvent>
                """, """
                <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="calc"/>
                <bpmn:sequenceFlow id="f2" sourceRef="calc" targetRef="end"/>
                <bpmn:sequenceFlow id="f3" sourceRef="b" targetRef="end"/>
                """);
        assertTrue(assertThrows(ProcessEngineException.class, () -> parse(onScript)).getMessage()
                .contains("user tasks and external"));
    }

    @Test
    void readsUserTaskOutcomesFromAbadaAttributes() {
        String xml = boundaryModel("""
                <bpmn:userTask id="review" abada:outcomes="approve, reject" abada:commentRequired="reject"/>
                """, """
                <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
                <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="end"/>
                """);
        assertEquals(java.util.List.of(
                new com.abada.engine.core.model.OutcomeMeta("approve", false, null),
                new com.abada.engine.core.model.OutcomeMeta("reject", true, null)),
                parse(xml).getUserTask("review").getOutcomes());

        String unknown = xml.replace("abada:commentRequired=\"reject\"", "abada:commentRequired=\"refuse\"");
        assertTrue(assertThrows(RuntimeException.class, () -> parse(unknown)).getMessage()
                .contains("not one of abada:outcomes"));
        String single = xml.replace("approve, reject", "approve").replace(" abada:commentRequired=\"reject\"", "");
        assertTrue(assertThrows(RuntimeException.class, () -> parse(single)).getMessage()
                .contains("distinct outcomes"));
    }

    private static String boundaryModel(String nodes, String flows) {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                    xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:abada="https://abada.io/schema/bpmn"
                    targetNamespace="test">
                  <bpmn:error id="rejected" errorCode="REJECTED"/>
                  <bpmn:process id="boundary-test" isExecutable="true">
                    <bpmn:startEvent id="start"/>
                    %s
                    <bpmn:endEvent id="end"/>
                    %s
                  </bpmn:process>
                </bpmn:definitions>
                """.formatted(nodes.stripIndent(), flows.stripIndent());
    }

    private static String eventGatewayModel(String nodes, String flows) {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="test">
                  <bpmn:message id="m1" name="FastTrackMessage" />
                  <bpmn:process id="event-gateway-test" isExecutable="true">
                    <bpmn:startEvent id="start"/>
                    %s
                    <bpmn:endEvent id="end"/>
                    %s
                  </bpmn:process>
                </bpmn:definitions>
                """.formatted(nodes, flows);
    }

    private static com.abada.engine.core.model.ParsedProcessDefinition parse(String xml) {
        return new BpmnParser().parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
    }

    private static String process(String node, String flows) {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="test">
                  <bpmn:process id="support-test" isExecutable="true">
                    <bpmn:startEvent id="start"/>
                    %s
                    <bpmn:endEvent id="end"/>
                    %s
                  </bpmn:process>
                </bpmn:definitions>
                """.formatted(node, flows);
    }
}
