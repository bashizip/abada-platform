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
        // Loop and multi-instance markers would otherwise be ignored and the
        // activity run once; bounded loops are modeled as a cycle whose target
        // declares abada:maxIterations instead.
        for (LoopCharacteristics marker : model.getModelElementsByType(LoopCharacteristics.class)) {
            String owner = marker.getParentElement() instanceof BaseElement element ? element.getId() : "?";
            unsupported.add(marker.getElementType().getTypeName() + "(" + owner
                    + "): loop and multi-instance markers are not supported; model the loop as a cycle back to a "
                    + "step that declares abada:maxIterations");
        }
        for (BoundaryEvent boundary : model.getModelElementsByType(BoundaryEvent.class)) {
            String problem = boundaryProblem(boundary);
            if (problem != null) unsupported.add("boundaryEvent(" + boundary.getId() + "): " + problem);
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

    /**
     * Supported boundaries: an interrupting timer (timeDuration) or an error
     * boundary on a user task or an external (camunda:topic) service task, with
     * exactly one outgoing flow. Null when supported, else why not.
     */
    static String boundaryProblem(BoundaryEvent boundary) {
        Activity attached = boundary.getAttachedTo();
        boolean external = attached instanceof ServiceTask task && task.getCamundaTopic() != null
                && !task.getCamundaTopic().isBlank();
        if (!(attached instanceof UserTask) && !external) {
            return "boundary events are supported on user tasks and external (camunda:topic) service tasks only";
        }
        if (boundary.getEventDefinitions().size() != 1) {
            return "exactly one timer or error event definition is required";
        }
        EventDefinition definition = boundary.getEventDefinitions().iterator().next();
        if (definition instanceof TimerEventDefinition timer) {
            if (timer.getTimeDuration() == null) return "a boundary timer needs timeDuration";
            if (!boundary.cancelActivity()) return "non-interrupting boundary timers are not supported";
        } else if (definition instanceof ErrorEventDefinition) {
            if (!boundary.cancelActivity()) return "an error boundary is always interrupting";
        } else {
            return "only timer and error boundary events are supported";
        }
        if (flowsFrom(boundary).size() != 1) return "exactly one outgoing sequence flow is required";
        boolean incoming = boundary.getModelInstance().getModelElementsByType(SequenceFlow.class).stream()
                .anyMatch(flow -> flow.getTarget() == boundary);
        if (incoming) return "a boundary event cannot have incoming flows";
        return null;
    }

    /**
     * Sequence flows leaving a boundary event, read from their {@code sourceRef}:
     * modelers do not always write the redundant {@code <bpmn:outgoing>} children.
     */
    static List<SequenceFlow> flowsFrom(BoundaryEvent boundary) {
        return boundary.getModelInstance().getModelElementsByType(SequenceFlow.class).stream()
                .filter(flow -> flow.getSource() == boundary).toList();
    }

    private static boolean isSupported(FlowNode node) {
        if (node instanceof StartEvent start) return start.getEventDefinitions().isEmpty();
        if (node instanceof EndEvent end) return end.getEventDefinitions().isEmpty();
        if (node instanceof UserTask || node instanceof ServiceTask || node instanceof ScriptTask
                || node instanceof BusinessRuleTask) return true;
        if (node instanceof ExclusiveGateway || node instanceof InclusiveGateway || node instanceof ParallelGateway) return true;
        if (node instanceof EventBasedGateway) return true;
        if (node instanceof BoundaryEvent boundary) return boundaryProblem(boundary) == null;
        if (node instanceof IntermediateCatchEvent event) {
            if (event.getEventDefinitions().size() != 1) return false;
            EventDefinition definition = event.getEventDefinitions().iterator().next();
            if (definition instanceof TimerEventDefinition timer) return timer.getTimeDuration() != null;
            return definition instanceof MessageEventDefinition || definition instanceof SignalEventDefinition;
        }
        return false;
    }
}
