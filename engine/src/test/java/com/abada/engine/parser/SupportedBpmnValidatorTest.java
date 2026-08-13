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
