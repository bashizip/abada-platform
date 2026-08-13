package com.abada.engine.parser;

import com.abada.engine.core.exception.ProcessEngineException;
import org.camunda.bpm.model.bpmn.BpmnModelInstance;
import org.camunda.bpm.model.bpmn.instance.*;

import java.util.ArrayList;
import java.util.List;

/** Rejects BPMN elements whose semantics the runtime does not guarantee. */
public final class SupportedBpmnValidator {
    private SupportedBpmnValidator() {}

    public static void validate(BpmnModelInstance model) {
        List<String> unsupported = new ArrayList<>();
        for (FlowNode node : model.getModelElementsByType(FlowNode.class)) {
            if (!isSupported(node)) unsupported.add(node.getElementType().getTypeName() + "(" + node.getId() + ")");
        }
        for (ServiceTask task : model.getModelElementsByType(ServiceTask.class)) {
            boolean embedded = task.getCamundaClass() != null && !task.getCamundaClass().isBlank();
            boolean external = task.getCamundaTopic() != null && !task.getCamundaTopic().isBlank();
            if (embedded == external) {
                unsupported.add("serviceTask(" + task.getId() + "): exactly one of camunda:class or camunda:topic is required");
            }
        }
        for (ScriptTask task : model.getModelElementsByType(ScriptTask.class)) {
            String format = task.getScriptFormat();
            if (format == null || !(format.equalsIgnoreCase("javascript") || format.equalsIgnoreCase("ecmascript"))) {
                unsupported.add("scriptTask(" + task.getId() + "): only JavaScript is supported");
            }
        }
        for (EventBasedGateway gateway : model.getModelElementsByType(EventBasedGateway.class)) {
            if (gateway.getOutgoing().size() < 2) {
                unsupported.add("eventBasedGateway(" + gateway.getId()
                        + "): at least two outgoing catch events are required");
            }
            for (SequenceFlow flow : gateway.getOutgoing()) {
                FlowNode target = flow.getTarget();
                if (!(target instanceof IntermediateCatchEvent) || !isSupported(target)) {
                    unsupported.add("eventBasedGateway(" + gateway.getId()
                            + "): every outgoing flow must end at a supported catch event");
                }
            }
        }
        if (!unsupported.isEmpty()) {
            throw new ProcessEngineException("Unsupported BPMN elements: " + String.join(", ", unsupported));
        }
    }

    private static boolean isSupported(FlowNode node) {
        if (node instanceof StartEvent start) return start.getEventDefinitions().isEmpty();
        if (node instanceof EndEvent end) return end.getEventDefinitions().isEmpty();
        if (node instanceof UserTask || node instanceof ServiceTask || node instanceof ScriptTask
                || node instanceof BusinessRuleTask) return true;
        if (node instanceof ExclusiveGateway || node instanceof InclusiveGateway || node instanceof ParallelGateway) return true;
        if (node instanceof EventBasedGateway) return true;
        if (node instanceof IntermediateCatchEvent event) {
            if (event.getEventDefinitions().size() != 1) return false;
            EventDefinition definition = event.getEventDefinitions().iterator().next();
            if (definition instanceof TimerEventDefinition timer) return timer.getTimeDuration() != null;
            return definition instanceof MessageEventDefinition || definition instanceof SignalEventDefinition;
        }
        return false;
    }
}
