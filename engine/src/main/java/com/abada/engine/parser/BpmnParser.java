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

            ParsedProcessDefinition definition = new ParsedProcessDefinition(id, name, documentation, startEventId,
                    userTasks, serviceTasks, scriptTasks, decisionTables, flows, gateways, events, endEvents, rawXml,
                    candidateStarterGroups, candidateStarterUsers);
            return definition;

        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse BPMN", e);
        }
    }
}
