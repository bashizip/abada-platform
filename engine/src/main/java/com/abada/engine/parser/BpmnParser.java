package com.abada.engine.parser;

import com.abada.engine.bpmn.compatibility.*;
import com.abada.engine.core.model.*;
import com.abada.engine.core.model.SequenceFlow;
import com.abada.engine.parser.assignment.AssignmentParserRegistry;
import com.abada.engine.parser.assignment.AssignmentXml;
import org.camunda.bpm.model.bpmn.Bpmn;
import org.camunda.bpm.model.bpmn.BpmnModelInstance;
import org.camunda.bpm.model.bpmn.instance.*;
import org.camunda.bpm.model.bpmn.instance.BusinessRuleTask;
import org.camunda.bpm.model.bpmn.instance.Process;

import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

public class BpmnParser {
    public static final int MAX_DEPLOYMENT_BYTES = 10 * 1024 * 1024;
    private final AssignmentParserRegistry assignmentParsers = new AssignmentParserRegistry();

    public ParsedProcessDefinition parse(InputStream bpmnXml) {
        return parseDetailed(bpmnXml, BpmnParseOptions.defaults()).definition();
    }

    public BpmnParseResult parseDetailed(InputStream bpmnXml, BpmnParseOptions options) {
        try {
            byte[] source = bpmnXml.readNBytes(MAX_DEPLOYMENT_BYTES + 1);
            if (source.length > MAX_DEPLOYMENT_BYTES) {
                throw BpmnValidationException.single(new BpmnValidationIssue(
                        BpmnErrorCodes.XML_SECURITY, ValidationSeverity.ERROR,
                        "BPMN deployment exceeds the 10 MiB input limit", null, null, null, null,
                        "Reduce the model size or split it into separate process definitions."));
            }
            String sourceXml = new String(source, StandardCharsets.UTF_8);
            BpmnCompatibilityDetector.Detection detection = new BpmnCompatibilityDetector().detect(sourceXml);
            List<BpmnValidationIssue> issues = new ArrayList<>();
            issues.addAll(new BpmnDirectiveValidator().validate(sourceXml, options));
            for (String detectedProfile : detection.profiles()) {
                if (!options.compatibilityProfiles().contains(detectedProfile)
                        && !CompatibilityProfiles.STANDARD.equals(detectedProfile)) {
                    issues.add(new BpmnValidationIssue(BpmnErrorCodes.UNSUPPORTED_EXTENSION,
                            ValidationSeverity.ERROR,
                            "BPMN uses disabled compatibility profile '" + detectedProfile + "'",
                            null, null, null, null,
                            "Enable the profile explicitly or migrate the vendor directives."));
                }
            }
            if (issues.stream().anyMatch(issue -> issue.severity() == ValidationSeverity.ERROR))
                throw new BpmnValidationException(issues);

            ParsedProcessDefinition definition = parseDefinition(new ByteArrayInputStream(source), sourceXml,
                    options.compatibilityProfiles());
            List<CompatibilityMapping> mappings = new ArrayList<>();
            if (detection.profiles().contains(CompatibilityProfiles.CAMUNDA_7)) {
                mappings.add(new CompatibilityMapping("camunda-7 XML directives",
                        "Abada canonical process model", definition.getId(),
                        "Vendor directives are translated during deployment and are not executed as XML."));
            }
            CompatibilityReport report = new CompatibilityReport(detection.profiles(), mappings, issues);
            return new BpmnParseResult(definition, report, options.compatibilityProfiles(), detection.namespaces());
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse BPMN", e);
        }
    }

    private ParsedProcessDefinition parseDefinition(InputStream bpmnXml, String sourceXml, List<String> activeProfiles) {
        try {
            AssignmentXml assignmentXml = AssignmentXml.parse(sourceXml);
            BpmnModelInstance model = Bpmn.readModelFromStream(bpmnXml);
            SupportedBpmnValidator.validate(model);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            Bpmn.writeModelToStream(out, model);
            String rawXml = out.toString(StandardCharsets.UTF_8);

            Process process = model.getModelElementsByType(Process.class).stream()
                    .findFirst()
                    .orElseThrow(() -> new RuntimeException("No <process> found"));

            String id = process.getId();
            String name = process.getName();
            String documentation = process.getDocumentations().stream()
                    .findFirst()
                    .map(Documentation::getTextContent)
                    .orElse(null);

            String startEventId = model.getModelElementsByType(StartEvent.class).stream()
                    .findFirst()
                    .map(BaseElement::getId)
                    .orElse(null);

            if (startEventId == null) {
                throw new RuntimeException("No <startEvent> found");
            }

            Map<String, TaskMeta> userTasks = new HashMap<>();
            for (UserTask userTask : model.getModelElementsByType(UserTask.class)) {
                TaskMeta meta = new TaskMeta();
                meta.setId(userTask.getId());
                meta.setName(userTask.getName());
                meta.setAssignment(assignmentParsers.parse(userTask, assignmentXml, activeProfiles));
                meta.setFormKey(blankToNull(userTask.getCamundaFormKey()));
                userTasks.put(userTask.getId(), meta);
            }

            Map<String, ServiceTaskMeta> serviceTasks = new HashMap<>();
            for (ServiceTask serviceTask : model.getModelElementsByType(ServiceTask.class)) {
                String className = serviceTask.getCamundaClass();
                String topicName = serviceTask.getCamundaTopic();

                if (className != null && !className.isBlank()) {
                    serviceTasks.put(serviceTask.getId(),
                            new ServiceTaskMeta(serviceTask.getId(), serviceTask.getName(), className, null));
                } else if (topicName != null && !topicName.isBlank()) {
                    serviceTasks.put(serviceTask.getId(),
                            new ServiceTaskMeta(serviceTask.getId(), serviceTask.getName(), null, topicName));
                }
            }

            Map<String, ScriptTaskMeta> scriptTasks = new HashMap<>();
            for (ScriptTask scriptTask : model.getModelElementsByType(ScriptTask.class)) {
                String script = scriptTask.getScript() == null
                        ? null
                        : scriptTask.getScript().getTextContent();
                scriptTasks.put(scriptTask.getId(), new ScriptTaskMeta(scriptTask.getId(), scriptTask.getName(),
                        scriptTask.getScriptFormat(), script));
            }

            // Native deterministic decision tables (abada:decisionTable on
            // businessRuleTask). A business rule task without the extension is
            // rejected: the engine never guesses a decision.
            Map<String, DecisionTableMeta> decisionTables = new HashMap<>();
            if (!model.getModelElementsByType(BusinessRuleTask.class).isEmpty()) {
                DecisionTableXml decisionTableXml = DecisionTableXml.parse(sourceXml);
                for (BusinessRuleTask ruleTask : model.getModelElementsByType(BusinessRuleTask.class)) {
                    Optional<DecisionTableMeta> table = decisionTableXml.tableFor(ruleTask.getId(),
                            ruleTask.getName());
                    if (table.isEmpty()) {
                        throw BpmnValidationException.single(new BpmnValidationIssue(
                                BpmnErrorCodes.UNSUPPORTED_EXTENSION, ValidationSeverity.ERROR,
                                "businessRuleTask '" + ruleTask.getId()
                                        + "' requires a native abada:decisionTable extension",
                                null, ruleTask.getId(), BpmnCompatibilityDetector.ABADA_NAMESPACE, null,
                                "Add <abada:decisionTable> under bpmn:extensionElements, or use a supported "
                                        + "activity type."));
                    }
                    decisionTables.put(ruleTask.getId(), table.get());
                }
            }

            List<SequenceFlow> flows = new ArrayList<>();
            for (org.camunda.bpm.model.bpmn.instance.SequenceFlow flow : model
                    .getModelElementsByType(org.camunda.bpm.model.bpmn.instance.SequenceFlow.class)) {
                flows.add(new SequenceFlow(
                        flow.getId(),
                        flow.getSource().getId(),
                        flow.getTarget().getId(), flow.getName(),
                        flow.getConditionExpression() != null ? flow.getConditionExpression().getRawTextContent()
                                : null,
                        flow.isImmediate()));
            }

            Map<String, GatewayMeta> gateways = new HashMap<>();
            for (ExclusiveGateway gateway : model.getModelElementsByType(ExclusiveGateway.class)) {
                gateways.put(gateway.getId(), new GatewayMeta(gateway.getId(), GatewayMeta.Type.EXCLUSIVE,
                        gateway.getDefault() != null ? gateway.getDefault().getId() : null));
            }
            for (InclusiveGateway gateway : model.getModelElementsByType(InclusiveGateway.class)) {
                gateways.put(gateway.getId(), new GatewayMeta(gateway.getId(), GatewayMeta.Type.INCLUSIVE,
                        gateway.getDefault() != null ? gateway.getDefault().getId() : null));
            }
            for (ParallelGateway gateway : model.getModelElementsByType(ParallelGateway.class)) {
                gateways.put(gateway.getId(), new GatewayMeta(gateway.getId(), GatewayMeta.Type.PARALLEL, null));
            }
            for (EventBasedGateway gateway : model.getModelElementsByType(EventBasedGateway.class)) {
                gateways.put(gateway.getId(), new GatewayMeta(gateway.getId(), GatewayMeta.Type.EVENT, null));
            }

            Map<String, EventMeta> events = new HashMap<>();
            for (IntermediateCatchEvent event : model.getModelElementsByType(IntermediateCatchEvent.class)) {
                if (!event.getEventDefinitions().isEmpty()) {
                    EventDefinition eventDefinition = event.getEventDefinitions().iterator().next();

                    if (eventDefinition instanceof MessageEventDefinition) {
                        MessageEventDefinition messageEventDef = (MessageEventDefinition) eventDefinition;
                        String messageName = messageEventDef.getMessage().getName();
                        events.put(event.getId(), new EventMeta(event.getId(), event.getName(),
                                EventMeta.EventType.MESSAGE, messageName));
                    } else if (eventDefinition instanceof TimerEventDefinition) {
                        TimerEventDefinition timerEventDef = (TimerEventDefinition) eventDefinition;
                        if (timerEventDef.getTimeDuration() != null) {
                            String duration = timerEventDef.getTimeDuration().getTextContent();
                            events.put(event.getId(),
                                    new EventMeta(event.getId(), event.getName(), EventMeta.EventType.TIMER, duration));
                        }
                    } else if (eventDefinition instanceof SignalEventDefinition) {
                        SignalEventDefinition signalEventDef = (SignalEventDefinition) eventDefinition;
                        String signalName = signalEventDef.getSignal().getName();
                        events.put(event.getId(),
                                new EventMeta(event.getId(), event.getName(), EventMeta.EventType.SIGNAL, signalName));
                    }
                }
            }

            Map<String, Object> endEvents = new HashMap<>();
            for (EndEvent endEvent : model.getModelElementsByType(EndEvent.class)) {
                endEvents.put(endEvent.getId(), endEvent);
            }

            // Extract candidate starter groups and users from the process element
            List<String> candidateStarterGroups = null;
            List<String> candidateStarterUsers = null;

            String starterGroups = process.getAttributeValueNs("http://camunda.org/schema/1.0/bpmn",
                    "candidateStarterGroups");
            if (starterGroups != null && !starterGroups.isBlank()) {
                candidateStarterGroups = Arrays.asList(starterGroups.split("\\s*,\\s*"));
            }

            String starterUsers = process.getAttributeValueNs("http://camunda.org/schema/1.0/bpmn",
                    "candidateStarterUsers");
            if (starterUsers != null && !starterUsers.isBlank()) {
                candidateStarterUsers = Arrays.asList(starterUsers.split("\\s*,\\s*"));
            }

            List<BoundaryMeta> boundaries = boundaries(model, flows);
            for (UserTask userTask : model.getModelElementsByType(UserTask.class)) {
                withSla(userTasks.get(userTask.getId()), userTask);
                withOutcomes(userTasks.get(userTask.getId()), userTask);
            }

            ParsedProcessDefinition definition = new ParsedProcessDefinition(id, name, documentation, startEventId,
                    userTasks, serviceTasks, scriptTasks, decisionTables, flows, gateways, events, endEvents, rawXml,
                    candidateStarterGroups, candidateStarterUsers);
            return definition.withLoops(loops(model)).withBoundaries(boundaries);

        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse BPMN", e);
        }
    }

    /**
     * Interrupting timer and error boundary events. Each becomes a
     * {@link BoundaryMeta} of the activity it is attached to; its outgoing flow
     * is re-sourced at that activity and marked as a boundary flow, so the
     * runtime treats it exactly like an APL on_timeout / on_error route.
     */
    private static List<BoundaryMeta> boundaries(BpmnModelInstance model, List<SequenceFlow> flows) {
        List<BoundaryMeta> boundaries = new ArrayList<>();
        for (BoundaryEvent boundary : model.getModelElementsByType(BoundaryEvent.class)) {
            String attachedTo = boundary.getAttachedTo().getId();
            org.camunda.bpm.model.bpmn.instance.SequenceFlow outgoing = SupportedBpmnValidator.flowsFrom(boundary).get(0);
            EventDefinition definition = boundary.getEventDefinitions().iterator().next();
            BoundaryMeta meta;
            if (definition instanceof TimerEventDefinition timer) {
                Duration after;
                try {
                    after = Duration.parse(timer.getTimeDuration().getTextContent().strip());
                } catch (java.time.format.DateTimeParseException exception) {
                    throw boundaryError(boundary.getId(), "timeDuration must be an ISO-8601 duration such as PT4H");
                }
                if (after.compareTo(Duration.ofSeconds(1)) < 0 || after.compareTo(Duration.ofDays(365)) > 0) {
                    throw boundaryError(boundary.getId(), "timeDuration must be between PT1S and P365D");
                }
                meta = new BoundaryMeta(boundary.getId(), attachedTo, BoundaryMeta.Kind.TIMEOUT, null, after,
                        outgoing.getTarget().getId());
            } else {
                ErrorEventDefinition error = (ErrorEventDefinition) definition;
                String code = error.getError() == null ? null : blankToNull(error.getError().getErrorCode());
                meta = new BoundaryMeta(boundary.getId(), attachedTo, BoundaryMeta.Kind.ERROR, code, null,
                        outgoing.getTarget().getId());
            }
            flows.removeIf(flow -> flow.getId().equals(outgoing.getId()));
            flows.add(new SequenceFlow(outgoing.getId(), attachedTo, meta.target(), outgoing.getName(), null, false,
                    meta.id()));
            boundaries.add(meta);
        }
        // Code-specific error boundaries are matched before catch-alls.
        boundaries.sort(java.util.Comparator.comparing(meta -> meta.kind() == BoundaryMeta.Kind.ERROR
                && meta.code() == null));
        return boundaries;
    }

    /** {@code abada:slaHours} and {@code abada:escalateTo} (comma-separated groups) on a user task. */
    private static void withSla(TaskMeta task, UserTask userTask) {
        String hours = blankToNull(userTask.getAttributeValueNs(BpmnCompatibilityDetector.ABADA_NAMESPACE, "slaHours"));
        String escalateTo = blankToNull(
                userTask.getAttributeValueNs(BpmnCompatibilityDetector.ABADA_NAMESPACE, "escalateTo"));
        if (hours != null) {
            double value;
            try {
                value = Double.parseDouble(hours.strip());
            } catch (NumberFormatException exception) {
                throw boundaryError(userTask.getId(), "abada:slaHours must be a number of hours");
            }
            if (value <= 0 || value > 8760) throw boundaryError(userTask.getId(), "abada:slaHours must be between 0 and 8760");
            task.setSlaHours(value);
        }
        if (escalateTo != null) {
            if (hours == null) throw boundaryError(userTask.getId(), "abada:escalateTo requires abada:slaHours");
            task.setEscalateTo(Arrays.stream(escalateTo.split("\\s*,\\s*")).filter(group -> !group.isBlank()).toList());
        }
    }

    /**
     * {@code abada:outcomes="approve,reject"} and {@code abada:commentRequired="reject"}
     * on a user task. The task records the decision in {@code <id>_outcome};
     * the BPMN graph routes on it with an ordinary exclusive gateway.
     */
    private static void withOutcomes(TaskMeta task, UserTask userTask) {
        String declared = blankToNull(
                userTask.getAttributeValueNs(BpmnCompatibilityDetector.ABADA_NAMESPACE, "outcomes"));
        String required = blankToNull(
                userTask.getAttributeValueNs(BpmnCompatibilityDetector.ABADA_NAMESPACE, "commentRequired"));
        if (declared == null) {
            if (required != null) throw boundaryError(userTask.getId(), "abada:commentRequired requires abada:outcomes");
            return;
        }
        List<String> names = Arrays.stream(declared.split("\\s*,\\s*")).filter(name -> !name.isBlank()).toList();
        if (names.size() < OutcomeMeta.MIN_OUTCOMES || names.size() > OutcomeMeta.MAX_OUTCOMES
                || new HashSet<>(names).size() != names.size()) {
            throw boundaryError(userTask.getId(), "abada:outcomes must list " + OutcomeMeta.MIN_OUTCOMES + " to "
                    + OutcomeMeta.MAX_OUTCOMES + " distinct outcomes");
        }
        for (String name : names) {
            if (!name.matches(OutcomeMeta.NAME_PATTERN)) {
                throw boundaryError(userTask.getId(), "outcome '" + name
                        + "' must be lowercase letters, digits and underscores, starting with a letter");
            }
        }
        Set<String> withComment = required == null ? Set.of()
                : Set.copyOf(Arrays.stream(required.split("\\s*,\\s*")).filter(name -> !name.isBlank()).toList());
        for (String name : withComment) {
            if (!names.contains(name)) {
                throw boundaryError(userTask.getId(), "abada:commentRequired names '" + name
                        + "', which is not one of abada:outcomes");
            }
        }
        task.setOutcomes(names.stream().map(name -> new OutcomeMeta(name, withComment.contains(name), null)).toList());
    }

    private static BpmnValidationException boundaryError(String elementId, String message) {
        return BpmnValidationException.single(new BpmnValidationIssue(BpmnErrorCodes.UNSUPPORTED_EXTENSION,
                ValidationSeverity.ERROR, "'" + elementId + "': " + message, null, elementId,
                BpmnCompatibilityDetector.ABADA_NAMESPACE, null, null));
    }

    /**
     * Loop bounds declared with {@code abada:maxIterations} (and optionally
     * {@code abada:onExhausted}) on the flow node a cycle returns to.
     */
    private static Map<String, LoopMeta> loops(BpmnModelInstance model) {
        Map<String, LoopMeta> loops = new LinkedHashMap<>();
        Set<String> nodeIds = new HashSet<>();
        model.getModelElementsByType(FlowNode.class).forEach(node -> nodeIds.add(node.getId()));
        for (FlowNode node : model.getModelElementsByType(FlowNode.class)) {
            String max = node.getAttributeValueNs(BpmnCompatibilityDetector.ABADA_NAMESPACE, "maxIterations");
            String onExhausted = blankToNull(
                    node.getAttributeValueNs(BpmnCompatibilityDetector.ABADA_NAMESPACE, "onExhausted"));
            if (max == null) {
                if (onExhausted != null) throw loopError(node.getId(), "abada:onExhausted requires abada:maxIterations");
                continue;
            }
            int iterations;
            try {
                iterations = Integer.parseInt(max.strip());
            } catch (NumberFormatException exception) {
                iterations = -1;
            }
            if (iterations < LoopMeta.MIN_ITERATIONS
                    || iterations > LoopMeta.MAX_ITERATIONS) {
                throw loopError(node.getId(), "abada:maxIterations must be an integer between "
                        + LoopMeta.MIN_ITERATIONS + " and "
                        + LoopMeta.MAX_ITERATIONS);
            }
            if (onExhausted != null && !nodeIds.contains(onExhausted)) {
                throw loopError(node.getId(), "abada:onExhausted target '" + onExhausted + "' is not a flow node");
            }
            loops.put(node.getId(), new LoopMeta(node.getId(), iterations, onExhausted));
        }
        return loops;
    }

    private static BpmnValidationException loopError(String elementId, String message) {
        return BpmnValidationException.single(new BpmnValidationIssue(
                BpmnErrorCodes.UNBOUNDED_LOOP,
                ValidationSeverity.ERROR, "node '" + elementId + "': " + message,
                null, elementId, BpmnCompatibilityDetector.ABADA_NAMESPACE, null,
                "Set abada:maxIterations to the number of times the step may run."));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }
}
