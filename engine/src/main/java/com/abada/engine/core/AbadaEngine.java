package com.abada.engine.core;

import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.bpmn.compatibility.BpmnParseOptions;
import com.abada.engine.bpmn.compatibility.BpmnParseResult;
import com.abada.engine.core.model.DecisionTableAudit;
import com.abada.engine.core.model.DefinitionSchema;
import com.abada.engine.core.model.EventMeta;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.core.model.ServiceTaskMeta;
import com.abada.engine.core.model.TaskInstance;
import com.abada.engine.core.model.TaskMeta;
import com.abada.engine.core.model.BoundaryMeta;
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.dto.UserTaskPayload;
import com.abada.engine.insight.InsightFactWriter;
import com.abada.engine.llm.AiProviderRegistry;
import com.abada.engine.observability.EngineMetrics;
import com.abada.engine.observability.TraceLogContext;
import com.abada.engine.parser.AplParser;
import com.abada.engine.tools.ToolRegistryService;
import com.abada.engine.parser.BpmnParser;
import com.abada.engine.persistence.PersistenceService;
import com.abada.engine.persistence.entity.EventSubscriptionEntity;
import com.abada.engine.persistence.entity.IncidentEntity;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.JobEntity;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.entity.ProcessInstanceEntity;
import com.abada.engine.persistence.entity.ProcessTokenEntity;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.EventSubscriptionRepository;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
import com.abada.engine.persistence.repository.JobRepository;
import com.abada.engine.persistence.repository.ProcessTokenRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Timer;
import io.micrometer.tracing.annotation.SpanTag;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.stream.Collectors;
import com.abada.engine.project.ProjectConstants;
import com.abada.engine.project.TaskGroupResolver;
import com.abada.engine.security.Identity;
import com.abada.engine.security.IdentityContext;

@Component
public class AbadaEngine {

    private static final Logger log = LoggerFactory.getLogger(AbadaEngine.class);

    private final PersistenceService persistenceService;
    private final BpmnParser parser;
    private final AplParser aplParser;
    private final ToolRegistryService toolRegistry;
    private final com.abada.engine.persistence.repository.AgentStepRepository agentSteps;
    private final com.abada.engine.core.delegation.CallTargetService callTargets;
    private final com.abada.engine.persistence.repository.ProcessInstanceRepository processInstanceRepository;
    /** Deepest call-process nesting the engine allows (a root instance is depth 0). */
    private final int maxCallDepth;
    /** Run a CHILD_DONE job right after the child's command commits instead of waiting for the poller. */
    private final boolean resumeChildImmediately;

    private final TaskManager taskManager;
    private final EventManager eventManager;
    private final JobScheduler jobScheduler;
    private final ExternalTaskRepository externalTaskRepository;
    private final EventSubscriptionRepository eventSubscriptionRepository;
    private final JobRepository jobRepository;
    private final ObjectMapper om;
    private final EngineMetrics engineMetrics;
    private final Tracer tracer;
    private final ActivityHistoryService historyService;
    private final InsightFactWriter insightFactWriter;
    private final TaskGroupResolver taskGroupResolver;
    private final ProcessTokenRepository processTokenRepository;
    private final com.abada.engine.persistence.repository.TaskRepository taskRepository;
    private final IncidentService incidentService;
    private final AiProviderRegistry aiProviders;
    private final Map<String, ParsedProcessDefinition> definitionsByDeploymentId = new ConcurrentHashMap<>();

    @Autowired
    public AbadaEngine(PersistenceService persistenceService, TaskManager taskManager, @Lazy EventManager eventManager,
            @Lazy JobScheduler jobScheduler, ExternalTaskRepository externalTaskRepository,
            EventSubscriptionRepository eventSubscriptionRepository, JobRepository jobRepository,
            ProcessTokenRepository processTokenRepository,
            com.abada.engine.persistence.repository.TaskRepository taskRepository,
            IncidentService incidentService, ObjectMapper om,
            EngineMetrics engineMetrics, Tracer tracer, ActivityHistoryService historyService,
            InsightFactWriter insightFactWriter,
            TaskGroupResolver taskGroupResolver,
            @Value("${abada.agent.allowed-models:" + AplParser.DEFAULT_ALLOWED_AGENT_MODELS + "}") String allowedAgentModels,
            @Autowired(required = false) AiProviderRegistry aiProviders,
            ToolRegistryService toolRegistry,
            com.abada.engine.persistence.repository.AgentStepRepository agentSteps,
            com.abada.engine.core.delegation.CallTargetService callTargets,
            com.abada.engine.persistence.repository.ProcessInstanceRepository processInstanceRepository,
            @Value("${abada.call-process.max-depth:4}") int maxCallDepth,
            @Value("${abada.call-process.resume-immediately:true}") boolean resumeChildImmediately) {
        this.persistenceService = persistenceService;
        this.parser = new BpmnParser();
        this.aplParser = new AplParser(allowedAgentModels);
        this.taskManager = taskManager;
        this.eventManager = eventManager;
        this.jobScheduler = jobScheduler;
        this.externalTaskRepository = externalTaskRepository;
        this.eventSubscriptionRepository = eventSubscriptionRepository;
        this.jobRepository = jobRepository;
        this.processTokenRepository = processTokenRepository;
        this.taskRepository = taskRepository;
        this.incidentService = incidentService;
        this.om = om;
        this.engineMetrics = engineMetrics;
        this.tracer = tracer;
        this.historyService = historyService;
        this.insightFactWriter = insightFactWriter;
        this.taskGroupResolver = taskGroupResolver;
        this.aiProviders = aiProviders;
        this.toolRegistry = toolRegistry;
        this.agentSteps = agentSteps;
        this.callTargets = callTargets;
        this.processInstanceRepository = processInstanceRepository;
        this.maxCallDepth = maxCallDepth;
        this.resumeChildImmediately = resumeChildImmediately;
    }

    @PostConstruct
    public void setup() {
        eventManager.setAbadaEngine(this);
        jobScheduler.setAbadaEngine(this);
    }

    @AtomicRuntimeCommand
    public ProcessDefinitionEntity deploy(InputStream bpmnXml) {
        return deploy(ProjectConstants.DEFAULT_PROJECT_ID, bpmnXml, BpmnParseOptions.defaults());
    }

    @AtomicRuntimeCommand
    public ProcessDefinitionEntity deploy(InputStream bpmnXml, BpmnParseOptions options) {
        return deploy(ProjectConstants.DEFAULT_PROJECT_ID, bpmnXml, options);
    }

    @AtomicRuntimeCommand
    public ProcessDefinitionEntity deploy(String projectId, InputStream source) {
        return deploy(projectId, source, BpmnParseOptions.defaults());
    }

    @AtomicRuntimeCommand
    public ProcessDefinitionEntity deploy(String projectId, InputStream bpmnXml, BpmnParseOptions options) {
        Span span = tracer.spanBuilder("abada.process.deploy").startSpan();
        Timer.Sample deploymentSample = engineMetrics.startBpmnDeploymentTimer();
        boolean succeeded = false;
        try (var scope = TraceLogContext.open(span)) {
            // Polymorphic definition load: the source stream is either
            // canonical BPMN 2.0 XML or a native abada.io/v1 APL YAML
            // document — the schema marker selects the compiler. Both paths
            // compile into the same ParsedProcessDefinition graph.
            byte[] source;
            try {
                source = bpmnXml.readNBytes(BpmnParser.MAX_DEPLOYMENT_BYTES + 1);
            } catch (java.io.IOException exception) {
                throw new ProcessEngineException("Failed to read definition source", exception);
            }
            if (source.length > BpmnParser.MAX_DEPLOYMENT_BYTES) {
                throw new ProcessEngineException(
                        "Definition deployment exceeds the 10 MiB input limit");
            }
            DefinitionSchema schema = AplParser.isAplSource(source)
                    ? DefinitionSchema.APL_NATIVE
                    : DefinitionSchema.BPMN_XML;
            BpmnParseResult parseResult;
            if (schema == DefinitionSchema.APL_NATIVE) {
                parseResult = aplParser.parseDetailed(source);
            } else {
                parseResult = parser.parseDetailed(new java.io.ByteArrayInputStream(source), options);
                com.abada.engine.expression.DefinitionPolicyValidator.validate(parseResult.definition(),
                        com.abada.engine.bpmn.compatibility.BpmnErrorCodes.UNSUPPORTED_EXTENSION,
                        "http://www.omg.org/spec/BPMN/20100524/MODEL");
                // Every cycle must be bounded (deployment only: stored definitions reload unchanged).
                List<com.abada.engine.bpmn.compatibility.BpmnValidationIssue> loopErrors =
                        com.abada.engine.parser.LoopRules.check(parseResult.definition(),
                                        com.abada.engine.bpmn.compatibility.BpmnErrorCodes.UNBOUNDED_LOOP,
                                        com.abada.engine.bpmn.compatibility.BpmnCompatibilityDetector.ABADA_NAMESPACE)
                                .stream().filter(issue -> issue.severity()
                                        == com.abada.engine.bpmn.compatibility.ValidationSeverity.ERROR)
                                .toList();
                if (!loopErrors.isEmpty()) {
                    throw new com.abada.engine.bpmn.compatibility.BpmnValidationException(loopErrors);
                }
            }
            ParsedProcessDefinition definition = parseResult.definition();
            String toolBindings = null;
            if (schema == DefinitionSchema.APL_NATIVE) {
                // Tool references resolve against the project's tool servers now and stay frozen with this version.
                ToolRegistryService.Resolution tools = toolRegistry.resolve(projectId, source);
                if (!tools.ok()) {
                    List<com.abada.engine.bpmn.compatibility.BpmnValidationIssue> issues =
                            new ArrayList<>(tools.errors());
                    issues.addAll(parseResult.report().issues());
                    throw new com.abada.engine.bpmn.compatibility.BpmnValidationException(issues);
                }
                toolBindings = toolRegistry.toJson(tools.bindings());
            }
            // Called processes are pinned to their current version now, with this version.
            com.abada.engine.core.delegation.CallTargetService.Resolution calls =
                    callTargets.resolve(projectId, definition, source);
            if (!calls.ok()) {
                List<com.abada.engine.bpmn.compatibility.BpmnValidationIssue> issues = new ArrayList<>(calls.errors());
                issues.addAll(parseResult.report().issues());
                throw new com.abada.engine.bpmn.compatibility.BpmnValidationException(issues);
            }
            ProcessDefinitionEntity persisted = saveProcessDefinition(parseResult, schema, projectId, toolBindings,
                    callTargets.toJson(calls.targets()));
            historyService.record("PROCESS_DEFINITION_DEPLOYED", null, definition.getId(), null,
                    Map.of("deploymentId", persisted.getDeploymentId(), "version", persisted.getVersion(),
                            "projectId", projectId));
            registerDefinitionAfterCommit(definition, persisted);

            span.setAttribute("process.definition.id", definition.getId());
            span.setAttribute("process.definition.name", definition.getName());
            span.setAttribute("process.definition.version", "1.0");
            span.setAttribute("process.definition.schema", schema.name());

            log.info("Deployed process definition: {} (schema: {})", definition.getId(), schema);
            succeeded = true;
            return persisted;
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR, e.getMessage());
            throw e;
        } finally {
            engineMetrics.recordBpmnDeployment(deploymentSample, succeeded);
            span.end();
        }
    }

    public List<ProcessDefinitionEntity> getDeployedProcesses() {
        Map<String, ProcessDefinitionEntity> latest = new LinkedHashMap<>();
        persistenceService.findAllProcessDefinitions()
                .forEach(definition -> latest.putIfAbsent(definition.getProcessKey(), definition));
        return List.copyOf(latest.values());
    }

    public Optional<ProcessDefinitionEntity> getProcessDefinitionById(String id) {
        return Optional.ofNullable(persistenceService.findProcessDefinitionById(id));
    }

    public Optional<ProcessDefinitionEntity> getProcessDefinitionById(String projectId, String id) {
        return Optional.ofNullable(persistenceService.findProcessDefinitionByProjectAndId(projectId, id));
    }

    public ParsedProcessDefinition getParsedProcessDefinition(String processDefinitionId) {
        ProcessDefinitionEntity latest = persistenceService.findProcessDefinitionById(processDefinitionId);
        return latest == null ? null : cacheDefinition(latest);
    }

    /**
     * The tool bindings an agent activity of this instance may use, as frozen
     * when its definition version was deployed. Empty when it binds none.
     */
    public List<com.abada.engine.core.model.ToolBinding> toolBindings(ProcessInstance instance, String activityId) {
        String deploymentId = instance.getProcessDefinitionDeploymentId();
        if (deploymentId == null) return List.of();
        ProcessDefinitionEntity deployment = persistenceService.findProcessDefinitionByDeploymentId(deploymentId);
        if (deployment == null) return List.of();
        return toolRegistry.bindingsFor(deploymentId, deployment.getToolBindings())
                .getOrDefault(activityId, List.of());
    }

    private void registerDefinition(ParsedProcessDefinition definition, ProcessDefinitionEntity entity) {
        definitionsByDeploymentId.putIfAbsent(entity.getDeploymentId(), definition);
    }

    private void registerDefinitionAfterCommit(ParsedProcessDefinition definition, ProcessDefinitionEntity entity) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            registerDefinition(definition, entity);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                registerDefinition(definition, entity);
            }
        });
    }

    @AtomicRuntimeCommand
    public ProcessInstance startProcess(@SpanTag("process.definition.id") String processDefinitionId, String username) {
        return startProcess(processDefinitionId, username, Map.of());
    }

    @AtomicRuntimeCommand
    public ProcessInstance startProcess(@SpanTag("process.definition.id") String processDefinitionId, String username,
            Map<String, Object> initialVariables) {
        return startProcess(ProjectConstants.DEFAULT_PROJECT_ID, processDefinitionId, username, initialVariables);
    }

    @AtomicRuntimeCommand
    public ProcessInstance startProcess(String projectId,
            @SpanTag("process.definition.id") String processDefinitionId, String username,
            Map<String, Object> initialVariables) {
        Timer.Sample sample = engineMetrics.startProcessTimer();
        Span span = tracer.spanBuilder("abada.process.start").startSpan();

        try (var scope = TraceLogContext.open(span)) {
            ProcessDefinitionEntity deployment = persistenceService
                    .findProcessDefinitionByProjectAndId(projectId, processDefinitionId);
            if (deployment == null) {
                throw new ProcessEngineException("Unknown process ID: " + processDefinitionId);
            }
            ParsedProcessDefinition definition = cacheDefinition(deployment);

            List<String> unconfiguredModels = unconfiguredAgentModels(definition);
            if (!unconfiguredModels.isEmpty()) {
                throw new ProcessEngineException("Cannot start process instance: definition '" + definition.getId()
                        + "' contains AI agent task(s) but no AI provider is configured for model(s) "
                        + String.join(", ", unconfiguredModels)
                        + ". Add a provider and its API key in Studio Settings > AI Providers.");
            }

            ProcessInstance instance = launch(deployment, definition, projectId, username, initialVariables, null);
            span.setAttribute("process.instance.id", instance.getId());
            span.setAttribute("process.definition.id", processDefinitionId);
            span.setAttribute("process.definition.name", definition.getName());
            engineMetrics.recordProcessDuration(sample, processDefinitionId);
            return instance;
        } catch (Exception e) {
            engineMetrics.recordProcessFailed(processDefinitionId);
            span.recordException(e);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR, e.getMessage());
            throw e;
        } finally {
            span.end();
        }
    }

    /**
     * Creates, advances and persists one instance of a deployed version and
     * arms its work, in the caller's transaction. A root instance has no
     * lineage; a call-process child names its parent, token and call activity.
     */
    private ProcessInstance launch(ProcessDefinitionEntity deployment, ParsedProcessDefinition definition,
            String projectId, String username, Map<String, Object> initialVariables,
            ProcessInstance.Lineage lineage) {
        String processDefinitionId = definition.getId();
        ProcessInstance instance = new ProcessInstance(definition);
        instance.setProcessDefinitionDeploymentId(deployment.getDeploymentId());
        instance.setProjectId(projectId);
        instance.putAllVariables(initialVariables);
        instance.setStartedBy(username != null && !username.isBlank() ? username : "system");
        instance.setLineage(lineage);

        engineMetrics.recordProcessStarted(processDefinitionId);
        log.info("Started process instance: {} of definition: {} by user: {}",
                instance.getId(), processDefinitionId, username != null ? username : "system");

        ProcessInstanceEntity entity = convertToEntity(instance);
        entity.setStartedBy(instance.getStartedBy());
        persistRuntimeState(instance, entity);

        List<UserTaskPayload> userTasks = instance.advance();
        if (instance.isCompleted() && instance.getEndDate() == null) {
            instance.setEndDate(Instant.now());
            engineMetrics.recordProcessCompleted(processDefinitionId);
        }

        entity = convertToEntity(instance);
        entity.setStartedBy(instance.getStartedBy());
        persistRuntimeState(instance, entity);

        Map<String, Object> started = new LinkedHashMap<>();
        if (lineage != null) {
            started.put("parentInstanceId", lineage.parentInstanceId());
            started.put("parentTokenId", lineage.parentTokenId());
            started.put("parentActivityId", lineage.parentActivityId());
            started.put("depth", lineage.depth());
        }
        historyService.record("PROCESS_STARTED", instance, definition.getStartEventId(), started);
        recordDecisionTableAudits(instance);
        recordLoopExhaustions(instance);

        armWork(instance, userTasks);
        return instance;
    }

    // Overloaded version for backward compatibility
    public ProcessInstance startProcess(@SpanTag("process.definition.id") String processDefinitionId) {
        return startProcess(processDefinitionId, null);
    }

    @AtomicRuntimeCommand
    public void claim(String taskId, String user, List<String> groups) {
        TaskInstance task = loadTaskForUpdate(taskId);
        ProcessInstance instance = requireActiveProcessForTask(task);
        String principalId = IdentityContext.get().map(Identity::principalId).orElse(null);
        List<String> effective = taskGroupResolver.effectiveGroups(
                instance.getProjectId(), principalId, groups);
        taskManager.claimTask(task, user, effective);
        persistTask(task);
        historyService.record("TASK_CLAIMED", instance,
                task.getTaskDefinitionKey(), Map.of("assignee", user));
    }

    @AtomicRuntimeCommand
    public void unclaim(String taskId, String user) {
        TaskInstance task = loadTaskForUpdate(taskId);
        requireActiveProcessForTask(task);
        taskManager.unclaimTask(task, user);
        persistTask(task);
        historyService.record("TASK_UNCLAIMED", loadProcessInstance(task.getProcessInstanceId()),
                task.getTaskDefinitionKey(), Map.of("previousAssignee", user));
    }

    @AtomicRuntimeCommand
    public void completeTask(String taskId, String user, List<String> groups, Map<String, Object> variables) {
        finishTask(taskId, user, groups, variables, false, null, null);
    }

    /**
     * A reviewer's decision on a human task that declares {@code outcomes}: the
     * engine checks the outcome is declared and that a required comment is
     * present, writes {@code <task>_outcome} and {@code <task>_comment}, and
     * continues at that outcome's {@code next} (APL), or after the task for the
     * graph to route on the outcome (BPMN). All or nothing.
     */
    @AtomicRuntimeCommand
    public void decideTask(String taskId, String user, List<String> groups, String outcome, String comment,
            Map<String, Object> variables) {
        finishTask(taskId, user, groups, variables, true, outcome, comment);
    }

    private void finishTask(String taskId, String user, List<String> groups, Map<String, Object> variables,
            boolean decision, String outcome, String comment) {
        // Variable names only: submitted values (and comments) never reach the logs.
        log.info("Completing task {} with variables {}", taskId, variables == null ? Set.of() : variables.keySet());
        TaskInstance currentTask = loadTaskForUpdate(taskId);

        String processInstanceId = currentTask.getProcessInstanceId();
        ProcessInstanceEntity authoritativeInstance =
                persistenceService.findProcessInstanceByIdForUpdate(processInstanceId);
        if (authoritativeInstance == null) {
            throw new IllegalStateException("No process instance found for id=" + processInstanceId);
        }
        ProcessInstance instance = materializeProcessInstance(authoritativeInstance);

        requireActive(instance);

        String principalId = IdentityContext.get().map(Identity::principalId).orElse(null);
        List<String> effective = taskGroupResolver.effectiveGroups(
                instance.getProjectId(), principalId, groups);
        taskManager.checkCanComplete(currentTask, user, effective);

        String activityId = currentTask.getTaskDefinitionKey();
        TaskMeta meta = instance.getDefinition().getUserTask(activityId);
        List<com.abada.engine.core.model.OutcomeMeta> outcomes = meta == null ? List.of() : meta.getOutcomes();
        List<String> names = outcomes.stream().map(com.abada.engine.core.model.OutcomeMeta::name).toList();
        com.abada.engine.core.model.OutcomeMeta chosen = null;
        String kept = null;
        if (!decision && !outcomes.isEmpty()) {
            throw new ProcessEngineException("Task '" + activityId + "' needs a decision, one of " + names
                    + "; submit it with the decision endpoint");
        }
        if (decision) {
            if (outcomes.isEmpty()) {
                throw new ProcessEngineException("Task '" + activityId + "' declares no outcomes; complete it instead");
            }
            chosen = meta.getOutcome(outcome);
            if (chosen == null) {
                throw new ProcessEngineException("Unknown outcome '" + outcome + "' for task '" + activityId
                        + "'; expected one of " + names);
            }
            kept = comment == null || comment.isBlank() ? null : comment.strip();
            if (chosen.commentRequired() && kept == null) {
                throw new ProcessEngineException("Outcome '" + chosen.name() + "' of task '" + activityId
                        + "' requires a comment");
            }
            if (kept != null && kept.length() > com.abada.engine.core.model.OutcomeMeta.MAX_COMMENT_LENGTH) {
                throw new ProcessEngineException("The comment is longer than "
                        + com.abada.engine.core.model.OutcomeMeta.MAX_COMMENT_LENGTH + " characters");
            }
            if (variables != null && (variables.containsKey(AplParser.outcomeVariable(activityId))
                    || variables.containsKey(AplParser.commentVariable(activityId)))) {
                throw new ProcessEngineException("'" + AplParser.outcomeVariable(activityId) + "' and '"
                        + AplParser.commentVariable(activityId) + "' are written by the engine from the decision");
            }
        }

        if (variables != null && !variables.isEmpty()) {
            instance.putAllVariables(variables);
        }
        if (chosen != null) {
            Map<String, Object> decided = new HashMap<>();
            decided.put(AplParser.outcomeVariable(activityId), chosen.name());
            // Always written, so the comment of an earlier pass never reaches the next one.
            decided.put(AplParser.commentVariable(activityId), kept);
            instance.putAllVariables(decided);
        }

        taskManager.completeTask(currentTask);
        persistTask(currentTask);
        Map<String, Object> details = new LinkedHashMap<>();
        if (chosen != null) {
            // The decision is evidence; the comment text stays in the process variable only.
            details.put("outcome", chosen.name());
            details.put("commented", kept != null);
            details.put("commentLength", kept == null ? 0 : kept.length());
        }
        historyService.record("TASK_COMPLETED", instance, activityId, details);
        recordUserTaskFact(instance, currentTask);
        persistRuntimeState(instance);

        String completedTokenRef = currentTask.getTokenId() != null ? currentTask.getTokenId() : activityId;
        String tokenId = instance.waitingTokenId(completedTokenRef);
        retireTaskJobs(instance, tokenId);
        if (chosen != null && chosen.target() != null) {
            BoundaryMeta route = instance.getDefinition().boundaryFor(activityId, BoundaryMeta.Kind.OUTCOME,
                    chosen.name());
            leaveViaBoundary(instance, tokenId, route, Map.of(), Map.of("taskId", currentTask.getId()));
            return;
        }
        List<UserTaskPayload> nextTasks = instance.advance(completedTokenRef);
        recordDecisionTableAudits(instance);
        recordLoopExhaustions(instance);
        if (instance.isCompleted() && instance.getEndDate() == null) {
            instance.setEndDate(Instant.now());
        }
        persistRuntimeState(instance);

        armWork(instance, nextTasks);
    }

    @AtomicRuntimeCommand
    public void failTask(String taskId) {
        TaskInstance task = loadTaskForUpdate(taskId);
        requireActiveProcessForTask(task);
        taskManager.failTask(task);
        persistTask(task);
        historyService.record("TASK_FAILED", loadProcessInstance(task.getProcessInstanceId()),
                task.getTaskDefinitionKey(), Map.of());
        // The token is still waiting at the task: route it through on_error, or open an incident.
        workFailed(task.getProcessInstanceId(), task.getTaskDefinitionKey(), task.getTokenId(),
                "task " + task.getId() + " was failed");
    }

    @AtomicRuntimeCommand
    public boolean failProcess(String processInstanceId) {
        // Work rows first, then the instance: the lock order of every work command.
        retireAllWork(processInstanceId);
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null || instance.getStatus() == ProcessStatus.COMPLETED
                || instance.getStatus() == ProcessStatus.FAILED
                || instance.getStatus() == ProcessStatus.CANCELLED) {
            log.warn("Process instance {} not found or already in a terminal state.", processInstanceId);
            return false;
        }

        log.info("Failing process instance {}", processInstanceId);
        cancelChildren(instance.getId(), null, "the parent instance failed");
        instance.setStatus(ProcessStatus.FAILED);
        instance.setEndDate(Instant.now());
        instance.setActiveTokens(Collections.emptyList()); // Clear active tokens to stop execution
        incidentService.resolveAll(instance.getId(), IncidentService.RESOLVED_BY_FAIL);

        // Record metrics for process failure
        engineMetrics.recordProcessFailed(instance.getDefinition().getId());

        persistRuntimeState(instance);
        historyService.record("PROCESS_FAILED", instance, null, Map.of());
        return true;
    }

    @AtomicRuntimeCommand
    public void cancelProcessInstance(String processInstanceId, String reason) {
        log.info("Cancelling process instance {} for reason: {}", processInstanceId, reason);
        // Work rows first, then the instance: the lock order of every work command
        // (a racing message correlation holds its subscription, then waits for the instance).
        retireAllWork(processInstanceId);
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null) {
            throw new ProcessEngineException("Process instance not found: " + processInstanceId);
        }

        if (instance.getStatus() == ProcessStatus.COMPLETED || instance.getStatus() == ProcessStatus.FAILED
                || instance.getStatus() == ProcessStatus.CANCELLED) {
            throw new ProcessEngineException(
                    "Process instance is already in a terminal state: " + instance.getStatus());
        }

        cancelChildren(instance.getId(), null, "the parent instance was cancelled");
        instance.setStatus(ProcessStatus.CANCELLED);
        instance.setEndDate(Instant.now());
        instance.setActiveTokens(Collections.emptyList());
        incidentService.resolveAll(instance.getId(), IncidentService.RESOLVED_BY_CANCEL);

        persistRuntimeState(instance);
        historyService.record("PROCESS_CANCELLED", instance, null, Map.of("reason", reason == null ? "" : reason));
    }

    // ---- call-process (E20a) ---------------------------------------------------------------------------

    /** Ancestors (root first) and direct children of an instance; read-only. */
    @Transactional(readOnly = true)
    public com.abada.engine.dto.LineageDto lineage(String instanceId) {
        ProcessInstanceEntity self = processInstanceRepository.findById(instanceId)
                .orElseThrow(() -> new ProcessEngineException("Process instance not found: " + instanceId));
        List<com.abada.engine.dto.LineageDto.Link> ancestors = new ArrayList<>();
        String parentId = self.getParentInstanceId();
        int guard = 0;
        while (parentId != null && guard++ < 64) {
            ProcessInstanceEntity parent = processInstanceRepository.findById(parentId).orElse(null);
            if (parent == null) break;
            ancestors.add(0, link(parent));
            parentId = parent.getParentInstanceId();
        }
        List<com.abada.engine.dto.LineageDto.Link> children = processInstanceRepository
                .findByParentInstanceIdOrderByStartDateAsc(instanceId).stream().map(AbadaEngine::link).toList();
        return new com.abada.engine.dto.LineageDto(instanceId,
                self.getRootInstanceId() == null ? instanceId : self.getRootInstanceId(), self.getCallDepth(),
                List.copyOf(ancestors), children);
    }

    private static com.abada.engine.dto.LineageDto.Link link(ProcessInstanceEntity row) {
        return new com.abada.engine.dto.LineageDto.Link(row.getId(), row.getProcessDefinitionId(),
                row.getStatus() == null ? null : row.getStatus().name(), row.getParentActivityId(),
                row.getCallDepth(), row.getStartDate(), row.getEndDate());
    }

    /**
     * Starts one child per token that parked at a call-process node in this
     * command, in the same transaction. A call that cannot start (inputs fail
     * to evaluate or do not fit the child's declared types, or the depth limit
     * is reached) leaves through on_error or stops at a CHILD_FAILED incident.
     */
    private void startChildren(ProcessInstance instance, List<ProcessInstance.Parked> parkedTokens) {
        for (ProcessInstance.Parked parked : parkedTokens) {
            com.abada.engine.core.model.CallProcessMeta call =
                    instance.getDefinition().getCallProcess(parked.activityId());
            if (call == null || !instance.isWaitingAt(parked.tokenId(), parked.activityId())) continue;
            startChild(instance, parked.tokenId(), call);
        }
    }

    private void startChild(ProcessInstance instance, String tokenId, com.abada.engine.core.model.CallProcessMeta call) {
        ProcessDefinitionEntity parentDeployment =
                persistenceService.findProcessDefinitionByDeploymentId(instance.getProcessDefinitionDeploymentId());
        com.abada.engine.core.delegation.CallTargetService.CallTarget target = parentDeployment == null ? null
                : callTargets.targetsFor(parentDeployment.getDeploymentId(), parentDeployment.getCallTargets())
                        .get(call.id());
        if (target == null) {
            throw new ProcessEngineException("Call '" + call.id() + "' of definition '" + instance.getDefinition().getId()
                    + "' has no pinned target; redeploy the definition");
        }
        int depth = instance.getCallDepth() + 1;
        int limit = call.maxDepth() == null ? maxCallDepth : Math.min(maxCallDepth, call.maxDepth());
        if (depth > limit) {
            callFailed(instance, tokenId, call.id(), "CHILD_DEPTH_EXCEEDED", "calling '" + target.processKey()
                    + "' would nest " + depth + " deep; the limit is " + limit, null);
            return;
        }
        Map<String, Object> inputs = new LinkedHashMap<>();
        for (Map.Entry<String, String> input : call.inputs().entrySet()) {
            Object value;
            try {
                value = com.abada.engine.expression.WorkflowExpressions.compile(input.getValue())
                        .evaluate(instance.getVariables());
            } catch (RuntimeException exception) {
                callFailed(instance, tokenId, call.id(), "CHILD_INPUT_INVALID", "input '" + input.getKey()
                        + "' could not be evaluated: " + exception.getMessage(), null);
                return;
            }
            String type = target.declaredTypes().get(input.getKey());
            if (!com.abada.engine.core.delegation.CallTargetService.fits(value, type)) {
                callFailed(instance, tokenId, call.id(), "CHILD_INPUT_INVALID", "input '" + input.getKey()
                        + "' is not a " + type + " as '" + target.processKey() + "' declares", null);
                return;
            }
            inputs.put(input.getKey(), value);
        }
        ProcessDefinitionEntity childDeployment = persistenceService.findProcessDefinitionByDeploymentId(
                target.deploymentId());
        if (childDeployment == null) {
            throw new ProcessEngineException("Pinned version " + target.version() + " of '" + target.processKey()
                    + "' no longer exists");
        }
        ParsedProcessDefinition childDefinition = cacheDefinition(childDeployment);
        List<String> unconfigured = unconfiguredAgentModels(childDefinition);
        if (!unconfigured.isEmpty()) {
            callFailed(instance, tokenId, call.id(), "CHILD_START_REFUSED", "'" + target.processKey()
                    + "' has agent tasks but no AI provider is configured for model(s) "
                    + String.join(", ", unconfigured), null);
            return;
        }
        ProcessInstance child = launch(childDeployment, childDefinition, instance.getProjectId(),
                instance.getStartedBy(), inputs, new ProcessInstance.Lineage(instance.getId(), tokenId, call.id(),
                        instance.getRootInstanceId(), depth));
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("childInstanceId", child.getId());
        details.put("processKey", target.processKey());
        details.put("version", target.version());
        details.put("inputs", List.copyOf(inputs.keySet()));
        historyService.record("CHILD_STARTED", instance, call.id(), details);
    }

    /**
     * A call failed for the parent token: through an on_error boundary that
     * catches {@code code} (or catches all), otherwise the token stops at a
     * CHILD_FAILED incident that, retried, starts a new child.
     */
    private void callFailed(ProcessInstance instance, String tokenId, String activityId, String code, String message,
            String childInstanceId) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("code", code);
        if (childInstanceId != null) details.put("childInstanceId", childInstanceId);
        details.put("message", truncate(message, 500));
        historyService.record("CHILD_FAILED", instance, activityId, details);
        BoundaryMeta boundary = instance.getDefinition().boundaryFor(activityId, BoundaryMeta.Kind.ERROR, code);
        if (boundary != null && !instance.isSuspended()) {
            Map<String, Object> variables = new LinkedHashMap<>();
            variables.put(AplParser.outcomeVariable(activityId), AplParser.OUTCOME_ERROR);
            variables.put(AplParser.errorCodeVariable(activityId), code);
            leaveViaBoundary(instance, tokenId, boundary, variables, details);
            return;
        }
        retireTaskJobs(instance, tokenId);
        instance.stopAtIncident(tokenId);
        persistRuntimeState(instance);
        incidentService.open(instance, tokenId, activityId, IncidentEntity.Type.CHILD_FAILED,
                "call at '" + activityId + "' failed (" + code + "): " + truncate(message, 900));
        log.warn("Process instance {}: call at '{}' failed with no on_error route; incident opened",
                instance.getId(), activityId);
    }

    /**
     * Resumes a parent token whose child ended (a CHILD_DONE job). Locks only
     * the parent; the child is read. A token that already left (timeout,
     * cancel) is left alone. A completed child's mapped outputs are written
     * and the token moves on; a failed or cancelled child takes on_error or
     * opens a CHILD_FAILED incident.
     *
     * @return true when the parent token moved or stopped
     */
    @AtomicRuntimeCommand
    public boolean childEnded(String parentInstanceId, String activityId, String parentTokenId,
            String childInstanceId) {
        ProcessInstance parent = loadProcessInstanceForUpdate(parentInstanceId);
        if (parent == null || isTerminal(parent)) return false;
        ProcessInstance child = getProcessInstanceById(childInstanceId);
        if (child == null || child.getLineage() == null || !parentTokenId.equals(child.getLineage().parentTokenId())
                || !parent.isWaitingAt(parentTokenId, activityId)) {
            historyService.record("CHILD_RESULT_IGNORED", parent, activityId,
                    Map.of("childInstanceId", childInstanceId, "reason", "the calling token is no longer waiting"));
            return false;
        }
        com.abada.engine.core.model.CallProcessMeta call = parent.getDefinition().getCallProcess(activityId);
        if (child.getStatus() != ProcessStatus.COMPLETED) {
            callFailed(parent, parentTokenId, activityId, "CHILD_FAILED", "child " + childInstanceId + " ended "
                    + child.getStatus(), childInstanceId);
            return true;
        }
        Map<String, Object> outputs = new LinkedHashMap<>();
        List<String> missing = new ArrayList<>();
        for (Map.Entry<String, String> output : call.outputs().entrySet()) {
            if (!child.getVariables().containsKey(output.getValue())) missing.add(output.getValue());
            outputs.put(output.getKey(), child.getVariables().get(output.getValue()));
        }
        outputs.put(AplParser.outcomeVariable(activityId), AplParser.OUTCOME_OK);
        if (parent.getVariables().containsKey(AplParser.errorCodeVariable(activityId))) {
            outputs.put(AplParser.errorCodeVariable(activityId), null);
        }
        parent.putAllVariables(outputs);
        retireTaskJobs(parent, parentTokenId);
        List<UserTaskPayload> nextTasks = parent.advance(parentTokenId);
        recordDecisionTableAudits(parent);
        recordLoopExhaustions(parent);
        if (parent.isCompleted() && parent.getEndDate() == null) {
            parent.setEndDate(Instant.now());
        }
        persistRuntimeState(parent);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("childInstanceId", childInstanceId);
        details.put("outputs", List.copyOf(call.outputs().keySet()));
        if (!missing.isEmpty()) details.put("missingChildVariables", missing);
        historyService.record("CHILD_COMPLETED", parent, activityId, details);
        armWork(parent, nextTasks);
        return true;
    }

    /**
     * When a child instance reaches its end, schedules the job that resumes its
     * parent token (once per child), in the child's command. The child never
     * locks its parent. A child cancelled by its parent schedules nothing.
     */
    private void scheduleParentResume(ProcessInstance instance) {
        ProcessInstance.Lineage lineage = instance.getLineage();
        if (lineage == null || !isTerminal(instance) || instance.isEndedByParent()) return;
        String jobId = jobScheduler.scheduleChildDone(lineage.parentInstanceId(), lineage.parentActivityId(),
                lineage.parentTokenId(), instance.getId());
        if (jobId == null || !resumeChildImmediately) return;
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    jobScheduler.runSoon(jobId);
                }
            });
        }
    }

    /**
     * Cancels the running children of an instance (all of them, or those of
     * some tokens) and their descendants, in the caller's transaction. The
     * caller holds the parent's lock: the order is always parent, then child.
     */
    private void cancelChildren(String parentInstanceId, Set<String> tokenIds, String reason) {
        for (ProcessInstanceEntity row : processInstanceRepository.findByParentInstanceIdOrderByStartDateAsc(
                parentInstanceId)) {
            if (tokenIds != null && !tokenIds.contains(row.getParentTokenId())) continue;
            if (row.getStatus() == ProcessStatus.COMPLETED || row.getStatus() == ProcessStatus.FAILED
                    || row.getStatus() == ProcessStatus.CANCELLED) continue;
            retireAllWork(row.getId());
            ProcessInstance child = loadProcessInstanceForUpdate(row.getId());
            if (child == null || isTerminal(child)) continue;
            cancelChildren(child.getId(), null, "its parent instance ended");
            child.setEndedByParent(true);
            child.setStatus(ProcessStatus.CANCELLED);
            child.setEndDate(Instant.now());
            child.setActiveTokens(Collections.emptyList());
            incidentService.resolveAll(child.getId(), IncidentService.RESOLVED_BY_CANCEL);
            persistRuntimeState(child);
            historyService.record("PROCESS_CANCELLED", child, null,
                    Map.of("reason", reason, "parentInstanceId", parentInstanceId));
        }
    }

    @AtomicRuntimeCommand
    public void suspendProcessInstance(String processInstanceId, boolean suspended) {
        log.info("Setting suspension state for process instance {} to {}", processInstanceId, suspended);
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null) {
            throw new ProcessEngineException("Process instance not found: " + processInstanceId);
        }

        if (suspended) {
            // Only suspend if not already in a terminal state
            if (instance.getStatus() != ProcessStatus.COMPLETED
                    && instance.getStatus() != ProcessStatus.FAILED
                    && instance.getStatus() != ProcessStatus.CANCELLED) {
                instance.setSuspended(true);
                instance.setStatus(ProcessStatus.SUSPENDED);
            }
        } else {
            // Resume: restore to RUNNING if currently SUSPENDED
            if (instance.getStatus() == ProcessStatus.SUSPENDED) {
                instance.setSuspended(false);
                instance.setStatus(ProcessStatus.RUNNING);
            }
        }

        persistRuntimeState(instance);
        historyService.record(suspended ? "PROCESS_SUSPENDED" : "PROCESS_RESUMED", instance, null, Map.of());
    }

    @AtomicRuntimeCommand
    public void updateProcessVariables(String processInstanceId, Map<String, Object> modifications) {
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null) throw new ProcessEngineException("Process instance not found: " + processInstanceId);
        instance.putAllVariables(modifications);
        persistRuntimeState(instance);
        historyService.record("VARIABLES_UPDATED", instance, null,
                Map.of("variableNames", modifications.keySet()));
    }

    @AtomicRuntimeCommand
    public void resumeFromEvent(String processInstanceId, String eventId, Map<String, Object> variables) {
        resumeFromEvent(processInstanceId, eventId, null, variables);
    }

    /**
     * Resumes the token waiting at {@code eventId}. {@code tokenId} identifies it
     * exactly; null (work created before V23) resumes the oldest token waiting
     * at that activity.
     */
    @AtomicRuntimeCommand
    public void resumeFromEvent(String processInstanceId, String eventId, String tokenId,
            Map<String, Object> variables) {
        log.info("Resuming process instance {} from event {}", processInstanceId, eventId);
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null) {
            throw new ProcessEngineException("No process instance found for id=" + processInstanceId);
        }

        requireActive(instance);

        if (variables != null && !variables.isEmpty()) {
            instance.putAllVariables(variables);
        }

        // The losing siblings of an event-gateway race leave the active set
        // before the winner advances: advance() must see the final token set
        // so an event gateway whose children lead straight to an end event
        // marks the instance COMPLETED in the same transaction.
        String tokenRef = tokenId != null ? tokenId : eventId;
        cancelEventGatewaySiblings(instance, tokenRef);
        // The token leaves its task normally: its timeout and SLA timers must never fire.
        retireTaskJobs(instance, instance.waitingTokenId(tokenRef));
        List<UserTaskPayload> nextTasks = instance.advance(tokenRef);
        recordDecisionTableAudits(instance);
        recordLoopExhaustions(instance);
        if (instance.isCompleted() && instance.getEndDate() == null) {
            instance.setEndDate(Instant.now());
        }
        persistRuntimeState(instance);
        historyService.record("EVENT_CORRELATED", instance, eventId, Map.of());

        armWork(instance, nextTasks);
    }

    /**
     * Cancels the competing wait states of an event gateway in the same
     * transaction as the winning event's advancement: the losing sibling
     * tokens leave the active set, sibling message/signal subscriptions are
     * consumed and sibling timer jobs are cancelled so they can never fire a
     * duplicate transition. Standalone events (no owning gateway) are a no-op.
     */
    private void cancelEventGatewaySiblings(ProcessInstance instance, String tokenRef) {
        ProcessInstance.EventRace race = instance.eventRace(tokenRef);
        List<String> siblings = race.loserActivityIds();
        if (siblings.isEmpty()) {
            return;
        }
        Set<String> loserTokens = Set.copyOf(race.loserTokenIds());
        // Work of the losing tokens; rows created before V23 carry no token and
        // are matched by activity.
        java.util.function.Predicate<String> losing = token -> token == null || loserTokens.contains(token);

        List<EventSubscriptionEntity> subscriptions = eventSubscriptionRepository
                .findByProcessInstanceIdAndActivityIdInAndConsumedAtIsNull(instance.getId(), siblings).stream()
                .filter(subscription -> losing.test(subscription.getTokenId())).toList();
        Instant now = Instant.now();
        subscriptions.forEach(subscription -> subscription.setConsumedAt(now));
        eventSubscriptionRepository.saveAll(subscriptions);

        List<JobEntity> jobs = jobRepository.findByProcessInstanceIdAndEventIdInAndStatusIn(instance.getId(),
                siblings, List.of(JobEntity.Status.AVAILABLE, JobEntity.Status.LEASED)).stream()
                .filter(job -> losing.test(job.getTokenId())).toList();
        jobs.forEach(job -> {
            job.setStatus(JobEntity.Status.CANCELLED);
            job.setLeaseOwner(null);
            job.setLeaseExpiresAt(null);
        });
        jobRepository.saveAll(jobs);
        log.info("Event race of instance {} resolved by token {}; cancelled {} sibling wait state(s) "
                        + "({} subscription(s), {} timer job(s))",
                instance.getId(), race.winnerTokenId(), siblings.size(), subscriptions.size(), jobs.size());
    }

    private ProcessInstance requireActiveProcessForTask(TaskInstance task) {
        ProcessInstance instance = loadProcessInstanceForUpdate(task.getProcessInstanceId());
        if (instance == null) throw new IllegalStateException(
                "Task references missing process instance: " + task.getProcessInstanceId());
        requireActive(instance);
        return instance;
    }

    private void requireActive(ProcessInstance instance) {
        if (instance.isSuspended() || instance.getStatus() == ProcessStatus.SUSPENDED)
            throw new ProcessEngineException("Process instance is suspended: " + instance.getId());
        if (instance.getStatus() == ProcessStatus.COMPLETED || instance.getStatus() == ProcessStatus.FAILED
                || instance.getStatus() == ProcessStatus.CANCELLED)
            throw new ProcessEngineException("Process instance is already in a terminal state: "
                    + instance.getStatus());
    }

    private ProcessInstance materializeProcessInstance(ProcessInstanceEntity entity) {
        ParsedProcessDefinition def = loadDefinition(entity);

        List<String> activeTokens = entity.getCurrentActivityId() != null ? List.of(entity.getCurrentActivityId())
                : Collections.emptyList();

        ProcessInstance instance = new ProcessInstance(
                entity.getId(),
                def,
                activeTokens,
                entity.getStartDate(),
                entity.getEndDate());
        instance.setStatus(entity.getStatus());
        instance.setSuspended(entity.isSuspended());
        instance.setProcessDefinitionDeploymentId(entity.getProcessDefinitionDeploymentId());
        instance.setProjectId(entity.getProjectId());
        instance.setEntityVersion(entity.getEntityVersion());
        instance.setStartedBy(entity.getStartedBy());
        if (entity.getParentInstanceId() != null) {
            instance.setLineage(new ProcessInstance.Lineage(entity.getParentInstanceId(), entity.getParentTokenId(),
                    entity.getParentActivityId(), entity.getRootInstanceId(), entity.getCallDepth()));
        }
        instance.putAllVariables(readMap(entity.getVariablesJson()));
        List<ProcessTokenEntity> rows = processTokenRepository
                .findByProcessInstanceIdOrderByCreatedAtAscIdAsc(entity.getId());
        List<String> legacyActive = readList(entity.getActiveTokensJson(), activeTokens);
        Map<String, Integer> legacyExpected = readIntegerMap(entity.getJoinExpectedTokensJson());
        Map<String, Set<String>> legacyArrived = readSetMap(entity.getJoinArrivedTokensJson());
        if (!rows.isEmpty()) {
            instance.restoreTokens(rows.stream().map(this::toToken).toList());
            if (matchesLegacyState(instance, legacyActive, legacyExpected, legacyArrived)) {
                return instance;
            }
            // The legacy columns are dual-written from the tokens, so a mismatch
            // means an older engine (after an image rollback) advanced this
            // instance: its JSON is the truth and the rows are replaced.
            log.warn("Token rows of process instance {} do not match its stored legacy state; "
                    + "rebuilding them (the instance was changed by an older engine)", entity.getId());
            instance.markStoredTokensStale();
        }
        // Pre-V23 instance: rebuild tokens from the legacy JSON. The rows are
        // written by the first command that persists this instance.
        List<String> warnings = instance.restoreLegacyTokens(legacyActive, legacyExpected, legacyArrived);
        warnings.forEach(warning -> log.warn("Converting tokens of process instance {}: {}",
                entity.getId(), warning));
        return instance;
    }

    private ParsedProcessDefinition loadDefinition(ProcessInstanceEntity instance) {
        String deploymentId = instance.getProcessDefinitionDeploymentId();
        if (deploymentId == null || deploymentId.isBlank()) {
            throw new IllegalStateException(
                    "Process instance " + instance.getId() + " is not pinned to a definition deployment");
        }

        ParsedProcessDefinition cached = definitionsByDeploymentId.get(deploymentId);
        if (cached != null) {
            return cached;
        }

        ProcessDefinitionEntity definition = persistenceService.findProcessDefinitionByDeploymentId(deploymentId);
        if (definition == null) {
            throw new IllegalStateException(
                    "No deployed process definition found for deployment ID: " + deploymentId);
        }
        return cacheDefinition(definition);
    }

    /**
     * Reloads immutable, already-admitted definitions without re-applying the
     * current agent model allow-list: tightening the list after deployment
     * must not change the semantics of running instances (runtime invariant
     * "definitions are immutable once deployed").
     */
    private static final AplParser definitionReloadParser = new AplParser("", false);

    private ParsedProcessDefinition cacheDefinition(ProcessDefinitionEntity entity) {
        byte[] source = entity.getBpmnXml().getBytes(StandardCharsets.UTF_8);
        return definitionsByDeploymentId.computeIfAbsent(entity.getDeploymentId(), ignored -> {
            if (DefinitionSchema.from(entity.getSchemaType()) == DefinitionSchema.APL_NATIVE) {
                return definitionReloadParser.parse(source);
            }
            return parser.parseDetailed(new java.io.ByteArrayInputStream(source),
                            new BpmnParseOptions(Arrays.stream(entity.getCompatibilityProfiles().split(","))
                                    .map(String::trim).filter(value -> !value.isEmpty()).toList(), false, false))
                    .definition();
        });
    }

    /** Records decision-table applications (identifiers and names only) in history and the outbox. */
    /**
     * Operator action on an open incident: the stopped token starts again at
     * its activity (a loop step with a fresh pass, a message wait re-reading
     * correlationKey). Recorded as INCIDENT_RETRIED history with the actor.
     */
    @AtomicRuntimeCommand
    public void retryIncident(String processInstanceId, String incidentId) {
        retryIncident(processInstanceId, incidentId, null, null);
    }

    /**
     * Retries an incident. A stopped token restarts at its activity. Failed
     * work ({@code WORK_FAILED}) is reopened with a fresh attempt budget; for
     * agent work the operator may name another allowed {@code model} (with a
     * {@code reason}) for this task only.
     */
    @AtomicRuntimeCommand
    public void retryIncident(String processInstanceId, String incidentId, String model, String reason) {
        retryIncident(processInstanceId, incidentId, model, reason, null);
    }

    /**
     * Retries an incident. For {@code TOOL_OUTCOME_UNKNOWN} the operator must
     * first say whether the interrupted write happened ({@code PERFORMED}) or
     * not ({@code NOT_PERFORMED}); the agent then resumes its attempt with
     * that fact and the write is never re-sent blindly.
     */
    @AtomicRuntimeCommand
    public void retryIncident(String processInstanceId, String incidentId, String model, String reason,
            String toolOutcome) {
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null) {
            throw new ProcessEngineException("No process instance found for id=" + processInstanceId);
        }
        requireActive(instance);
        IncidentEntity incident = incidentService.requireOpen(processInstanceId, incidentId);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("incidentId", incidentId);
        details.put("type", incident.getType());
        if (IncidentEntity.Type.TOOL_OUTCOME_UNKNOWN.name().equals(incident.getType())) {
            if (model != null) {
                throw new ProcessEngineException("A model cannot be chosen when confirming a tool outcome");
            }
            details.putAll(resolveUnknownToolOutcome(instance, incident, toolOutcome));
            incidentService.resolve(incident, IncidentService.RESOLVED_BY_RETRY);
            historyService.record("INCIDENT_RETRIED", instance, incident.getActivityId(), details);
            return;
        }
        if (toolOutcome != null) {
            throw new ProcessEngineException("A tool outcome is only confirmed for a TOOL_OUTCOME_UNKNOWN incident");
        }
        if (IncidentEntity.Type.WORK_FAILED.name().equals(incident.getType())) {
            details.putAll(reopenFailedWork(instance, incident.getTokenId(), incident.getActivityId(), model, reason));
            incidentService.resolve(incident, IncidentService.RESOLVED_BY_RETRY);
            historyService.record("INCIDENT_RETRIED", instance, incident.getActivityId(), details);
            return;
        }
        if (model != null) {
            throw new ProcessEngineException("A model can only be chosen when retrying failed agent work");
        }
        List<UserTaskPayload> nextTasks = instance.retryIncident(incident.getTokenId());
        incidentService.resolve(incident, IncidentService.RESOLVED_BY_RETRY);
        recordDecisionTableAudits(instance);
        recordLoopExhaustions(instance);
        if (instance.isCompleted() && instance.getEndDate() == null) {
            instance.setEndDate(Instant.now());
        }
        persistRuntimeState(instance);
        historyService.record("INCIDENT_RETRIED", instance, incident.getActivityId(), details);
        armWork(instance, nextTasks);
    }

    /**
     * Reopens the failed work of a token: its external task returns to OPEN
     * with the node's full attempt budget, or its failed user task becomes
     * available again. The token never left the activity, so nothing else moves.
     */
    private Map<String, Object> reopenFailedWork(ProcessInstance instance, String tokenId, String activityId,
            String model, String reason) {
        java.util.function.Predicate<String> ofToken = token -> tokenId == null ? token == null
                : tokenId.equals(token);
        Optional<ExternalTaskEntity> failed = externalTaskRepository
                .findByProcessInstanceIdAndStatusInForUpdate(instance.getId(),
                        List.of(ExternalTaskEntity.Status.FAILED)).stream()
                .filter(task -> ofToken.test(task.getTokenId()) && activityId.equals(task.getActivityId()))
                .findFirst();
        if (failed.isPresent()) {
            ExternalTaskEntity task = failed.get();
            ServiceTaskMeta meta = instance.getDefinition().getServiceTask(activityId);
            Map<String, Object> details = reopenExternalTask(task, meta, model, reason);
            externalTaskRepository.save(task);
            return details;
        }
        if (model != null) {
            throw new ProcessEngineException("A model can only be chosen when retrying failed agent work");
        }
        TaskEntity userTask = taskRepository.findByProcessInstanceIdAndStatusInForUpdate(instance.getId(),
                        List.of(com.abada.engine.core.model.TaskStatus.FAILED)).stream()
                .filter(task -> ofToken.test(task.getTokenId()) && activityId.equals(task.getTaskDefinitionKey()))
                .findFirst()
                .orElseThrow(() -> new ProcessEngineException("No failed work found at '" + activityId
                        + "' of process instance " + instance.getId()));
        userTask.setStatus(com.abada.engine.core.model.TaskStatus.AVAILABLE);
        userTask.setAssignee(null);
        userTask.setEndDate(null);
        taskRepository.save(userTask);
        return Map.of("taskId", userTask.getId());
    }

    /**
     * Returns failed external work to OPEN with the node's attempt budget,
     * optionally on an operator-chosen model. The model must be on the engine
     * allow-list, needs a reason, and only applies to agent work; the deployed
     * definition is not changed.
     */
    Map<String, Object> reopenExternalTask(ExternalTaskEntity task, ServiceTaskMeta meta, String model,
            String reason) {
        boolean unknownWrite = agentSteps.findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.getId()).stream()
                .anyMatch(step -> step.getState()
                        == com.abada.engine.persistence.entity.AgentStepEntity.State.OUTCOME_UNKNOWN);
        if (unknownWrite) {
            throw new ProcessEngineException("Task " + task.getId() + " stopped on a write with an unknown outcome;"
                    + " retry its TOOL_OUTCOME_UNKNOWN incident with the confirmed outcome instead");
        }
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalTaskId", task.getId());
        if (model != null) {
            if (meta == null || meta.agentWork() == null) {
                throw new ProcessEngineException("A model can only be chosen when retrying failed agent work");
            }
            String chosen = model.strip();
            Set<String> allowed = aplParser.allowedAgentModels();
            if (chosen.isEmpty() || !allowed.isEmpty() && !allowed.contains(chosen)) {
                throw new ProcessEngineException("Model '" + chosen + "' is not on the allowed model list ("
                        + String.join(", ", allowed) + ")");
            }
            if (reason == null || reason.isBlank()) {
                throw new ProcessEngineException("A reason is required when retrying on another model");
            }
            String from = task.getModelOverride() != null ? task.getModelOverride() : meta.agentWork().model();
            task.setModelOverride(chosen);
            task.setRequiredModel(chosen);
            details.put("fromModel", from == null ? "" : from);
            details.put("toModel", chosen);
            details.put("reason", reason.strip().length() > 500 ? reason.strip().substring(0, 500) : reason.strip());
        }
        int attempts = meta != null && meta.agentWork() != null && meta.agentWork().maxAttempts() != null
                ? meta.agentWork().maxAttempts() : 3;
        task.setRetries(attempts);
        task.setDeferrals(0);
        // A retry is a new attempt: a fresh conversation, with earlier completed writes passed on as done.
        task.setAttempt(task.getAttempt() + 1);
        task.setStatus(ExternalTaskEntity.Status.OPEN);
        task.setWorkerId(null);
        task.setLockExpirationTime(null);
        details.put("retries", attempts);
        return details;
    }

    /**
     * An agent write without an idempotency key was interrupted (E9): the
     * engine never re-sends it. Opens a {@code TOOL_OUTCOME_UNKNOWN} incident
     * for a person to confirm what happened; no boundary routes it.
     */
    public void toolOutcomeUnknown(String processInstanceId, String tokenId, String activityId, String toolRef,
            int sequence) {
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null || isTerminal(instance)) return;
        String token = instance.waitingTokenId(tokenId != null ? tokenId : activityId);
        incidentService.open(instance, token, activityId, IncidentEntity.Type.TOOL_OUTCOME_UNKNOWN,
                "write '" + toolRef + "' (step " + sequence + ") at '" + activityId
                        + "' was interrupted and its server accepts no idempotency key; confirm whether it happened");
        historyService.record("TOOL_OUTCOME_UNKNOWN", instance, activityId,
                Map.of("toolRef", toolRef, "sequence", sequence));
        log.warn("Process instance {}: write {} at '{}' has an unknown outcome; incident opened",
                instance.getId(), toolRef, activityId);
    }

    private Map<String, Object> resolveUnknownToolOutcome(ProcessInstance instance, IncidentEntity incident,
            String toolOutcome) {
        String outcome = toolOutcome == null ? "" : toolOutcome.strip().toUpperCase(java.util.Locale.ROOT);
        if (!outcome.equals("PERFORMED") && !outcome.equals("NOT_PERFORMED")) {
            throw new ProcessEngineException("Confirm the interrupted write first: toolOutcome must be PERFORMED"
                    + " or NOT_PERFORMED");
        }
        java.util.function.Predicate<String> ofToken = token -> incident.getTokenId() == null ? token == null
                : incident.getTokenId().equals(token);
        ExternalTaskEntity task = externalTaskRepository
                .findByProcessInstanceIdAndStatusInForUpdate(instance.getId(),
                        List.of(ExternalTaskEntity.Status.FAILED)).stream()
                .filter(candidate -> ofToken.test(candidate.getTokenId())
                        && incident.getActivityId().equals(candidate.getActivityId()))
                .findFirst()
                .orElseThrow(() -> new ProcessEngineException("No stopped agent work found at '"
                        + incident.getActivityId() + "' of process instance " + instance.getId()));
        com.abada.engine.persistence.entity.AgentStepEntity step = agentSteps
                .findByExternalTaskIdOrderByAttemptAscSequenceAsc(task.getId()).stream()
                .filter(candidate -> candidate.getState()
                        == com.abada.engine.persistence.entity.AgentStepEntity.State.OUTCOME_UNKNOWN)
                .findFirst()
                .orElseThrow(() -> new ProcessEngineException("No write with an unknown outcome found for task "
                        + task.getId()));
        boolean performed = outcome.equals("PERFORMED");
        String actor = com.abada.engine.security.IdentityContext.get()
                .map(com.abada.engine.security.Identity::username).orElse("system");
        step.setState(performed ? com.abada.engine.persistence.entity.AgentStepEntity.State.COMPLETED
                : com.abada.engine.persistence.entity.AgentStepEntity.State.FAILED);
        if (performed) {
            // The tool's own answer is lost; the agent continues with the operator's confirmation.
            com.fasterxml.jackson.databind.node.ObjectNode result = om.createObjectNode()
                    .put("confirmedByOperator", true).put("performed", true);
            step.setResultDigest(com.abada.engine.core.agent.AgentStepService.digest(result));
            step.setResultEnc(null);
        } else {
            step.setErrorType("NOT_PERFORMED_CONFIRMED");
        }
        step.setResolvedBy(actor);
        agentSteps.save(step);
        // Resume the same attempt: the journal already says what happened.
        task.setStatus(ExternalTaskEntity.Status.OPEN);
        task.setWorkerId(null);
        task.setLockExpirationTime(null);
        if (task.getRetries() == null || task.getRetries() < 1) task.setRetries(1);
        externalTaskRepository.save(task);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("externalTaskId", task.getId());
        details.put("toolRef", step.getToolRef());
        details.put("sequence", step.getSequence());
        details.put("toolOutcome", outcome);
        return details;
    }

    /** Resolves the open WORK_FAILED incident of failed work an operator retried directly. */
    void resolveWorkIncident(String processInstanceId, String tokenId, String activityId) {
        incidentService.resolveFor(processInstanceId, tokenId, activityId, IncidentEntity.Type.WORK_FAILED,
                IncidentService.RESOLVED_BY_RETRY);
    }

    /**
     * Leaves a waiting task through one of its boundaries, atomically: the
     * task's remaining work (external task, user task, timers) is retired, the
     * engine-written variables are set, and the token continues at the
     * boundary's target.
     */
    @AtomicRuntimeCommand
    public void takeBoundary(String processInstanceId, String activityId, String tokenId, BoundaryMeta boundary,
            Map<String, Object> variables, Map<String, Object> details) {
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null) {
            throw new ProcessEngineException("No process instance found for id=" + processInstanceId);
        }
        requireActive(instance);
        String token = instance.waitingTokenId(tokenId != null ? tokenId : activityId);
        leaveViaBoundary(instance, token, boundary, variables, details);
    }

    private void leaveViaBoundary(ProcessInstance instance, String token, BoundaryMeta boundary,
            Map<String, Object> variables, Map<String, Object> details) {
        if (variables != null && !variables.isEmpty()) {
            instance.putAllVariables(variables);
        }
        retireWork(instance, Set.of(token));
        List<UserTaskPayload> nextTasks = instance.leaveViaBoundary(token, boundary);
        recordDecisionTableAudits(instance);
        recordLoopExhaustions(instance);
        if (instance.isCompleted() && instance.getEndDate() == null) {
            instance.setEndDate(Instant.now());
        }
        persistRuntimeState(instance);
        Map<String, Object> taken = new LinkedHashMap<>(details == null ? Map.of() : details);
        taken.put("boundary", boundary.id());
        taken.put("kind", boundary.kind().name());
        if (boundary.code() != null) taken.put("code", boundary.code());
        taken.put("routedTo", boundary.target());
        historyService.record("BOUNDARY_TAKEN", instance, boundary.attachedTo(), taken);
        armWork(instance, nextTasks);
    }

    /**
     * Fires a task's {@code on_timeout}: the task's work is cancelled and the
     * token leaves through the timeout boundary. A token that already left the
     * task (the job lost a race with the completion) is left alone.
     *
     * @return true when the boundary fired
     */
    @AtomicRuntimeCommand
    public boolean fireTimeout(String processInstanceId, String activityId, String tokenId, String boundaryId) {
        // The token's work before its instance, as a completing worker or user locks them.
        externalTaskRepository.findByTokenAndStatusInForUpdate(processInstanceId, tokenId, OPEN_EXTERNAL);
        taskRepository.findByTokenAndStatusInForUpdate(processInstanceId, tokenId, OPEN_TASKS);
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null || isTerminal(instance)) return false;
        BoundaryMeta boundary = instance.getDefinition().getBoundary(activityId, boundaryId);
        if (boundary == null || !instance.isWaitingAt(tokenId, activityId)) return false;
        Map<String, Object> variables = new LinkedHashMap<>();
        variables.put(AplParser.outcomeVariable(activityId), AplParser.OUTCOME_TIMEOUT);
        leaveViaBoundary(instance, tokenId, boundary, variables, Map.of("after", boundary.after().toString()));
        return true;
    }

    /**
     * Escalates an open human task that missed its {@code sla_hours}: the task
     * stays open and assigned as it was, the {@code escalate_to} groups become
     * candidates too, and {@code TASK_SLA_BREACHED} goes to history and the
     * outbox. The token does not move.
     *
     * @return true when a task was escalated
     */
    @AtomicRuntimeCommand
    public boolean escalateTask(String processInstanceId, String activityId, String tokenId) {
        // The task before its instance, as completing it locks them.
        Optional<TaskEntity> open = taskRepository.findByTokenAndStatusInForUpdate(processInstanceId, tokenId,
                        OPEN_TASKS).stream()
                .filter(task -> activityId.equals(task.getTaskDefinitionKey()) && task.getEscalatedAt() == null)
                .findFirst();
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null || isTerminal(instance)) return false;
        if (open.isEmpty()) return false;
        TaskEntity task = open.get();
        TaskMeta meta = instance.getDefinition().getUserTask(activityId);
        List<String> added = new ArrayList<>();
        if (meta != null) {
            for (String group : meta.getEscalateTo()) {
                if (!task.getCandidateGroups().contains(group)) {
                    task.getCandidateGroups().add(group);
                    added.add(group);
                }
            }
        }
        task.setEscalatedAt(Instant.now());
        taskRepository.save(task);
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("taskId", task.getId());
        details.put("dueAt", task.getDueAt() == null ? "" : task.getDueAt().toString());
        details.put("escalatedTo", added);
        details.put("assignee", task.getAssignee() == null ? "" : task.getAssignee());
        historyService.record("TASK_SLA_BREACHED", instance, activityId, details);
        return true;
    }

    /**
     * Work at a task failed for good (attempts exhausted, or a user task was
     * failed). With an {@code on_error} boundary that catches {@code WORK_FAILED}
     * the token leaves through it; otherwise a {@code WORK_FAILED} incident opens
     * and the token keeps waiting for an operator retry or cancel.
     *
     * @return the boundary target, or null when an incident was opened
     */
    @AtomicRuntimeCommand
    public String workFailed(String processInstanceId, String activityId, String tokenId, String message) {
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null || isTerminal(instance)) return null;
        String token = instance.waitingTokenId(tokenId != null ? tokenId : activityId);
        BoundaryMeta boundary = instance.getDefinition()
                .boundaryFor(activityId, BoundaryMeta.Kind.ERROR, BoundaryMeta.WORK_FAILED);
        if (boundary != null && !instance.isSuspended()) {
            Map<String, Object> variables = new LinkedHashMap<>();
            variables.put(AplParser.outcomeVariable(activityId), AplParser.OUTCOME_ERROR);
            variables.put(AplParser.errorCodeVariable(activityId), BoundaryMeta.WORK_FAILED);
            leaveViaBoundary(instance, token, boundary, variables, Map.of("message", truncate(message, 500)));
            return boundary.target();
        }
        incidentService.open(instance, token, activityId, IncidentEntity.Type.WORK_FAILED,
                "work at '" + activityId + "' failed: " + truncate(message, 900));
        log.warn("Process instance {}: work at '{}' failed with no on_error route; incident opened",
                instance.getId(), activityId);
        return null;
    }

    private static String truncate(String value, int max) {
        String text = value == null ? "" : value;
        return text.length() > max ? text.substring(0, max) : text;
    }

    private static boolean isTerminal(ProcessInstance instance) {
        return instance.getStatus() == ProcessStatus.COMPLETED || instance.getStatus() == ProcessStatus.FAILED
                || instance.getStatus() == ProcessStatus.CANCELLED;
    }

    static Duration slaDuration(double hours) {
        return Duration.ofSeconds(Math.round(hours * 3600));
    }

    /**
     * Creates the work of the tokens that parked in this command: user tasks,
     * subscriptions, timer events, external tasks, and the boundary timeout and
     * SLA timers of the tasks just entered.
     */
    private void armWork(ProcessInstance instance, List<UserTaskPayload> userTasks) {
        for (UserTaskPayload task : userTasks) {
            createAndPersistTask(task, instance);
        }
        eventManager.registerWaitStates(instance);
        scheduleWaitingTimerEvents(instance);
        createExternalTaskJobs(instance);
        List<ProcessInstance.Parked> parked = instance.takeParked();
        scheduleTaskTimers(instance, parked);
        // Last: a child that cannot start may move the token on through on_error.
        startChildren(instance, parked);
    }

    private void scheduleTaskTimers(ProcessInstance instance, List<ProcessInstance.Parked> parkedTokens) {
        ParsedProcessDefinition definition = instance.getDefinition();
        Instant now = Instant.now();
        for (ProcessInstance.Parked parked : parkedTokens) {
            for (BoundaryMeta boundary : definition.boundariesOf(parked.activityId())) {
                if (boundary.kind() == BoundaryMeta.Kind.TIMEOUT) {
                    jobScheduler.scheduleTaskJob(instance.getId(), parked.activityId(), parked.tokenId(),
                            JobEntity.Kind.BOUNDARY_TIMEOUT, boundary.id(), now.plus(boundary.after()));
                }
            }
            TaskMeta task = definition.getUserTask(parked.activityId());
            if (task != null && task.getSlaHours() != null) {
                jobScheduler.scheduleTaskJob(instance.getId(), parked.activityId(), parked.tokenId(),
                        JobEntity.Kind.SLA, null, now.plus(slaDuration(task.getSlaHours())));
            }
        }
    }

    private static final List<JobEntity.Status> PENDING_JOBS =
            List.of(JobEntity.Status.AVAILABLE, JobEntity.Status.LEASED);
    private static final List<ExternalTaskEntity.Status> OPEN_EXTERNAL =
            List.of(ExternalTaskEntity.Status.OPEN, ExternalTaskEntity.Status.LOCKED);
    private static final List<com.abada.engine.core.model.TaskStatus> OPEN_TASKS =
            List.of(com.abada.engine.core.model.TaskStatus.AVAILABLE, com.abada.engine.core.model.TaskStatus.CLAIMED);

    /** Cancels the timeout and SLA timers of a token that leaves its task normally. */
    private void retireTaskJobs(ProcessInstance instance, String tokenId) {
        cancelJobs(jobRepository.findPendingForTokensSkipLocked(instance.getId(), Set.of(tokenId)).stream()
                .filter(job -> job.getKind() != JobEntity.Kind.EVENT).toList());
    }

    /**
     * Retires the unfinished work of tokens leaving through a boundary, in the
     * current command: pending jobs are cancelled, open or locked external
     * tasks and open user tasks cancelled. A worker or user acting on retired
     * work afterwards is rejected. A token at a task has no subscription.
     * Callers lock the token's task rows before the instance; jobs a firing
     * timer holds are skipped (that timer finds the token gone).
     */
    private void retireWork(ProcessInstance instance, Set<String> tokenIds) {
        cancelChildren(instance.getId(), tokenIds, "the calling step left through a boundary");
        cancelJobs(jobRepository.findPendingForTokensSkipLocked(instance.getId(), tokenIds));
        for (String tokenId : tokenIds) {
            cancelExternalTasks(externalTaskRepository.findByTokenAndStatusInForUpdate(instance.getId(), tokenId,
                    OPEN_EXTERNAL));
            cancelUserTasks(taskRepository.findByTokenAndStatusInForUpdate(instance.getId(), tokenId, OPEN_TASKS),
                    Instant.now());
        }
    }

    /**
     * Retires all unfinished work of an instance that is being cancelled or
     * failed. Called before the instance row is locked, so it follows the lock
     * order of every work command (work row, then instance).
     */
    private void retireAllWork(String processInstanceId) {
        Instant now = Instant.now();
        List<EventSubscriptionEntity> subscriptions =
                eventSubscriptionRepository.findOpenByProcessInstanceIdForUpdate(processInstanceId);
        subscriptions.forEach(subscription -> subscription.setConsumedAt(now));
        eventSubscriptionRepository.saveAll(subscriptions);
        cancelJobs(jobRepository.findByProcessInstanceIdAndStatusIn(processInstanceId, PENDING_JOBS));
        cancelExternalTasks(externalTaskRepository.findByProcessInstanceIdAndStatusInForUpdate(processInstanceId,
                OPEN_EXTERNAL));
        cancelUserTasks(taskRepository.findByProcessInstanceIdAndStatusInForUpdate(processInstanceId, OPEN_TASKS),
                now);
    }

    private void cancelJobs(List<JobEntity> jobs) {
        jobs.forEach(job -> {
            job.setStatus(JobEntity.Status.CANCELLED);
            job.setLeaseOwner(null);
            job.setLeaseExpiresAt(null);
        });
        jobRepository.saveAll(jobs);
    }

    private void cancelExternalTasks(List<ExternalTaskEntity> tasks) {
        tasks.forEach(task -> {
            task.setStatus(ExternalTaskEntity.Status.CANCELLED);
            task.setWorkerId(null);
            task.setLockExpirationTime(null);
        });
        externalTaskRepository.saveAll(tasks);
    }

    private void cancelUserTasks(List<TaskEntity> tasks, Instant now) {
        tasks.forEach(task -> {
            task.setStatus(com.abada.engine.core.model.TaskStatus.CANCELLED);
            task.setEndDate(now);
        });
        taskRepository.saveAll(tasks);
    }

    /**
     * Records each loop that reached its limit in this command, and opens an
     * incident when the loop declares no on_exhausted route (its token stopped
     * in the INCIDENT state).
     */
    private void recordLoopExhaustions(ProcessInstance instance) {
        for (ProcessInstance.LoopExhaustion exhausted : instance.takeLoopExhaustions()) {
            historyService.record("LOOP_EXHAUSTED", instance, exhausted.headerId(), Map.of(
                    "maxIterations", exhausted.maxIterations(),
                    "routedTo", exhausted.routedTo() == null ? "" : exhausted.routedTo()));
        }
        for (ProcessInstance.RuntimeIncident incident : instance.takeIncidents()) {
            incidentService.open(instance, incident.tokenId(), incident.activityId(), incident.type(),
                    incident.message());
            log.warn("Process instance {}: {} at '{}'; incident opened", instance.getId(), incident.type(),
                    incident.activityId());
        }
    }

    private void recordDecisionTableAudits(ProcessInstance instance) {
        for (DecisionTableAudit audit : instance.takeDecisionAudits()) {
            historyService.record("DECISION_TABLE_APPLIED", instance, audit.activityId(), Map.of(
                    "decisionKey", audit.decisionKey(),
                    "matchedRuleIndexes", audit.matchedRuleIndexes(),
                    "inputNames", audit.inputNames(),
                    "outputNames", audit.outputNames()));
            recordDecisionFact(instance, audit);
        }
    }

    /** One terminal DECISION fact per application inside the same transaction. */
    private void recordDecisionFact(ProcessInstance instance, DecisionTableAudit audit) {
        var table = instance.getDefinition().getDecisionTables().get(audit.activityId());
        if (table == null) {
            return;
        }
        boolean fallbackUsed = audit.matchedRuleIndexes().stream()
                .anyMatch(index -> index != null && index >= 0 && index < table.rules().size()
                        && table.rules().get(index).otherwise());
        insightFactWriter.recordDecisionApplied(
                instance.getProjectId(),
                audit.visitId(),
                instance.getDefinition().getId(),
                instance.getProcessDefinitionDeploymentId(),
                instance.getId(),
                audit.activityId(),
                audit.decisionKey(),
                audit.matchedRuleIndexes(),
                fallbackUsed,
                Instant.now());
    }

    /** One terminal USER_TASK fact per completion inside the same transaction. */
    private void recordUserTaskFact(ProcessInstance instance, TaskInstance task) {
        if (task.getStartDate() == null) {
            return;
        }
        insightFactWriter.recordUserTaskCompleted(
                instance.getProjectId(),
                task.getId(),
                instance.getDefinition().getId(),
                instance.getProcessDefinitionDeploymentId(),
                instance.getId(),
                task.getTaskDefinitionKey(),
                task.getStartDate(),
                Instant.now());
    }

    private void createAndPersistTask(UserTaskPayload task, ProcessInstance instance) {
        TaskInstance createdTask = taskManager.createTaskSnapshot(
                task.taskDefinitionKey(),
                task.name(),
                instance.getId(),
                task.assignee(),
                task.candidateUsers(),
                task.candidateGroups(),
                task.formKey(),
                task.assignmentStrategy());
        createdTask.setTokenId(task.tokenId());
        TaskMeta meta = instance.getDefinition().getUserTask(task.taskDefinitionKey());
        if (meta != null && meta.getSlaHours() != null) {
            createdTask.setDueAt(createdTask.getStartDate().plus(slaDuration(meta.getSlaHours())));
        }
        persistTask(createdTask);
        historyService.record("TASK_CREATED", instance, task.taskDefinitionKey(),
                Map.of("assignee", task.assignee() == null ? "" : task.assignee(),
                        "assignmentStrategy", task.assignmentStrategy().name()));
        if (task.assignee() != null && !task.assignee().isBlank()) {
            historyService.record("TASK_ASSIGNED", instance, task.taskDefinitionKey(),
                    Map.of("assignee", task.assignee()));
        }
    }

    private void scheduleWaitingTimerEvents(ProcessInstance instance) {
        ParsedProcessDefinition definition = instance.getDefinition();
        for (ProcessToken token : instance.getWaitingTokens()) {
            String activityId = token.activityId();
            if (definition.isCatchEvent(activityId)) {
                EventMeta eventMeta = definition.getEvents().get(activityId);
                if (eventMeta != null && eventMeta.type() == EventMeta.EventType.TIMER) {
                    try {
                        Duration duration = Duration.parse(eventMeta.definitionRef());
                        jobScheduler.scheduleJob(instance.getId(), activityId, token.id(),
                                Instant.now().plus(duration));
                    } catch (Exception e) {
                        throw new ProcessEngineException("Could not persist timer " + activityId
                                + " with duration " + eventMeta.definitionRef(), e);
                    }
                }
            }
        }
    }

    private void createExternalTaskJobs(ProcessInstance instance) {
        ParsedProcessDefinition definition = instance.getDefinition();
        List<ExternalTaskEntity.Status> open = List.of(ExternalTaskEntity.Status.OPEN,
                ExternalTaskEntity.Status.LOCKED);
        for (ProcessToken token : instance.getWaitingTokens()) {
            String activityId = token.activityId();
            if (definition.isServiceTask(activityId)) {
                ServiceTaskMeta serviceTaskMeta = definition.getServiceTask(activityId);
                if (serviceTaskMeta != null && serviceTaskMeta.topicName() != null) {
                    if (externalTaskRepository.existsByProcessInstanceIdAndTokenIdAndStatusIn(instance.getId(),
                            token.id(), open)
                            || externalTaskRepository.existsByProcessInstanceIdAndActivityIdAndTokenIdIsNullAndStatusIn(
                                    instance.getId(), activityId, open)) {
                        continue;
                    }
                    ExternalTaskEntity externalTask = new ExternalTaskEntity(instance.getId(),
                            serviceTaskMeta.topicName());
                    externalTask.setActivityId(activityId);
                    externalTask.setTokenId(token.id());
                    externalTask.setCreatedAt(Instant.now());
                    if (serviceTaskMeta.agentWork() != null) {
                        if (serviceTaskMeta.agentWork().maxAttempts() != null) {
                            externalTask.setRetries(serviceTaskMeta.agentWork().maxAttempts());
                        }
                        String requiredModel = serviceTaskMeta.agentWork().model();
                        if (requiredModel != null && !requiredModel.isBlank()) {
                            externalTask.setRequiredModel(requiredModel);
                        }
                    }
                    var spanContext = io.opentelemetry.api.trace.Span.current().getSpanContext();
                    if (spanContext.isValid()) {
                        externalTask.setTraceParent("00-" + spanContext.getTraceId() + "-" + spanContext.getSpanId()
                                + (spanContext.isSampled() ? "-01" : "-00"));
                    }
                    externalTaskRepository.save(externalTask);
                    log.info("Created external task {} for topic {}", externalTask.getId(),
                            serviceTaskMeta.topicName());
                }
            }
        }
    }

    private ProcessInstanceEntity convertToEntity(ProcessInstance instance) {
        ProcessInstanceEntity entity = new ProcessInstanceEntity();
        entity.setId(instance.getId());
        entity.setProcessDefinitionId(instance.getDefinition().getId());
        entity.setProcessDefinitionDeploymentId(instance.getProcessDefinitionDeploymentId());
        entity.setProjectId(instance.getProjectId());

        if (instance.getActiveTokens() != null && !instance.getActiveTokens().isEmpty()) {
            entity.setCurrentActivityId(instance.getActiveTokens().get(0));
        } else {
            entity.setCurrentActivityId(null);
        }

        entity.setStatus(instance.getStatus());
        entity.setSuspended(instance.isSuspended());

        entity.setStartDate(instance.getStartDate());
        entity.setEndDate(instance.getEndDate());
        entity.setVariablesJson(writeMap(instance.getVariables()));
        entity.setStartedBy(instance.getStartedBy());
        entity.setActiveTokensJson(writeValue(instance.getActiveTokens()));
        entity.setJoinExpectedTokensJson(writeValue(instance.getJoinExpectedTokens()));
        entity.setJoinArrivedTokensJson(writeValue(instance.getJoinArrivedTokens()));
        entity.setEntityVersion(instance.getEntityVersion());
        ProcessInstance.Lineage lineage = instance.getLineage();
        if (lineage != null) {
            entity.setParentInstanceId(lineage.parentInstanceId());
            entity.setParentTokenId(lineage.parentTokenId());
            entity.setParentActivityId(lineage.parentActivityId());
            entity.setRootInstanceId(lineage.rootInstanceId());
            entity.setCallDepth(lineage.depth());
        }
        return entity;
    }

    private void persistRuntimeState(ProcessInstance instance) {
        persistRuntimeState(instance, convertToEntity(instance));
    }

    private void persistRuntimeState(ProcessInstance instance, ProcessInstanceEntity entity) {
        ProcessInstanceEntity saved = persistenceService.saveOrUpdateProcessInstance(entity);
        instance.setEntityVersion(saved.getEntityVersion());
        scheduleParentResume(instance);
        if (instance.isStoredTokensStale()) {
            processTokenRepository.deleteByProcessInstanceId(instance.getId());
            instance.clearStoredTokensStale();
        }
        List<ProcessToken> changed = instance.getDirtyTokens();
        if (!changed.isEmpty()) {
            processTokenRepository.saveAll(changed.stream().map(token -> toEntity(instance, token)).toList());
            instance.markTokensClean();
        }
    }

    /**
     * Whether stored token rows still describe the legacy columns written
     * with them: same waiting activities, same join expectations and arrival
     * counts. Arrival sets are compared by size because an older engine records
     * predecessor activity ids where this one records token ids.
     */
    private static boolean matchesLegacyState(ProcessInstance instance, List<String> active,
            Map<String, Integer> expected, Map<String, Set<String>> arrived) {
        List<String> derived = new ArrayList<>(instance.getActiveTokens());
        List<String> stored = new ArrayList<>(active);
        Collections.sort(derived);
        Collections.sort(stored);
        if (!derived.equals(stored) || !instance.getJoinExpectedTokens().equals(expected)) return false;
        Map<String, Set<String>> derivedArrived = instance.getJoinArrivedTokens();
        Set<String> joins = new HashSet<>(derivedArrived.keySet());
        joins.addAll(arrived.keySet());
        for (String join : joins) {
            if (derivedArrived.getOrDefault(join, Set.of()).size() != arrived.getOrDefault(join, Set.of()).size()) {
                return false;
            }
        }
        return true;
    }

    private ProcessTokenEntity toEntity(ProcessInstance instance, ProcessToken token) {
        ProcessTokenEntity entity = new ProcessTokenEntity();
        entity.setId(token.id());
        entity.setProcessInstanceId(instance.getId());
        entity.setActivityId(token.activityId());
        entity.setState(token.state().name());
        entity.setParentTokenId(token.parentTokenId());
        entity.setScopeTokenId(token.scopeTokenId());
        entity.setLoopCounter(token.loopCounter());
        entity.setLoopCounts(token.loopCounts().isEmpty() ? null : writeValue(token.loopCounts()));
        entity.setCreatedAt(token.createdAt());
        entity.setUpdatedAt(token.updatedAt());
        return entity;
    }

    private ProcessToken toToken(ProcessTokenEntity entity) {
        return ProcessToken.restore(entity.getId(), entity.getActivityId(),
                ProcessToken.State.valueOf(entity.getState()), entity.getParentTokenId(), entity.getScopeTokenId(),
                entity.getLoopCounter(), readIntegerMap(entity.getLoopCounts()), entity.getCreatedAt(),
                entity.getUpdatedAt());
    }

    private TaskEntity convertToEntity(TaskInstance taskInstance) {
        TaskEntity entity = new TaskEntity();
        entity.setId(taskInstance.getId());
        entity.setProcessInstanceId(taskInstance.getProcessInstanceId());
        entity.setTaskDefinitionKey(taskInstance.getTaskDefinitionKey());
        entity.setName(taskInstance.getName());
        entity.setAssignee(taskInstance.getAssignee());
        entity.setAssignmentStrategy(taskInstance.getAssignmentStrategy());
        entity.setStatus(taskInstance.getStatus());
        entity.setStartDate(taskInstance.getStartDate());
        entity.setEndDate(taskInstance.getEndDate());
        entity.setDueAt(taskInstance.getDueAt());
        entity.setEscalatedAt(taskInstance.getEscalatedAt());

        entity.setCandidateUsers(new ArrayList<>(taskInstance.getCandidateUsers()));
        entity.setCandidateGroups(new ArrayList<>(taskInstance.getCandidateGroups()));
        entity.setFormKey(taskInstance.getFormKey());
        entity.setTokenId(taskInstance.getTokenId());
        entity.setEntityVersion(taskInstance.getEntityVersion());

        return entity;
    }

    private TaskInstance loadTaskForUpdate(String taskId) {
        TaskEntity entity = persistenceService.findTaskByIdForUpdate(taskId);
        if (entity == null) {
            throw new ProcessEngineException("Task not found: " + taskId);
        }
        return taskManager.materialize(entity);
    }

    private ProcessInstance loadProcessInstance(String processInstanceId) {
        ProcessInstanceEntity entity = persistenceService.findProcessInstanceById(processInstanceId);
        if (entity == null) {
            throw new IllegalStateException("No process instance found for id=" + processInstanceId);
        }
        return materializeProcessInstance(entity);
    }

    private ProcessInstance loadProcessInstanceForUpdate(String processInstanceId) {
        ProcessInstanceEntity entity = persistenceService.findProcessInstanceByIdForUpdate(processInstanceId);
        return entity == null ? null : materializeProcessInstance(entity);
    }

    private void persistTask(TaskInstance task) {
        TaskEntity saved = persistenceService.saveTask(convertToEntity(task));
        task.setEntityVersion(saved.getEntityVersion());
    }

    public void clearMemory() {
        definitionsByDeploymentId.clear();
    }

    @Transactional(readOnly = true)
    public ProcessInstance getProcessInstanceById(@SpanTag("process.instance.id") String id) {
        Span span = tracer.spanBuilder("abada.process.get").startSpan();
        try (var scope = TraceLogContext.open(span)) {
            span.setAttribute("process.instance.id", id);
            ProcessInstanceEntity entity = persistenceService.findProcessInstanceById(id);
            ProcessInstance instance = entity == null ? null : materializeProcessInstance(entity);
            if (instance != null) {
                span.setAttribute("process.definition.id", instance.getDefinition().getId());
                span.setAttribute("process.status", instance.getStatus().toString());
            }
            return instance;
        } finally {
            span.end();
        }
    }

    @Transactional(readOnly = true)
    public Page<ProcessInstance> getProcessInstances(Pageable pageable) {
        return persistenceService.findProcessInstances(pageable)
                .map(this::materializeProcessInstance);
    }

    @Transactional(readOnly = true)
    public Page<ProcessInstance> getProcessInstances(com.abada.engine.core.model.ProcessStatus status,
            String processDefinitionId, Pageable pageable) {
        return persistenceService.findProcessInstances(status, processDefinitionId, pageable)
                .map(this::materializeProcessInstance);
    }

    @Transactional(readOnly = true)
    public Page<ProcessInstance> getProcessInstances(String projectId,
            com.abada.engine.core.model.ProcessStatus status,
            String processDefinitionId, Pageable pageable) {
        return persistenceService.findProcessInstances(projectId, status, processDefinitionId, pageable)
                .map(this::materializeProcessInstance);
    }

    @Transactional(readOnly = true)
    public Page<ProcessDefinitionEntity> getDeployedProcesses(Pageable pageable) {
        return persistenceService.findProcessDefinitions(pageable);
    }

    @Transactional(readOnly = true)
    public Page<ProcessDefinitionEntity> getDeployedProcesses(String processKey, Pageable pageable) {
        return persistenceService.findProcessDefinitions(processKey, pageable);
    }

    @Transactional(readOnly = true)
    public Page<ProcessDefinitionEntity> getDeployedProcesses(String projectId, String processKey,
            Pageable pageable) {
        return persistenceService.findProcessDefinitions(projectId, processKey, pageable);
    }

    @Transactional(readOnly = true)
    public Map<String, ProcessInstance> getProcessInstancesByIds(Collection<String> instanceIds) {
        if (instanceIds == null || instanceIds.isEmpty()) {
            return Map.of();
        }
        return persistenceService.findProcessInstancesByIds(instanceIds).stream()
                .map(this::materializeProcessInstance)
                .collect(Collectors.toMap(ProcessInstance::getId, Function.identity()));
    }

    public TaskManager getTaskManager() {
        return taskManager;
    }

    public Optional<TaskInstance> getTaskById(String taskId) {
        return taskManager.getTask(taskId);
    }

    private ProcessDefinitionEntity saveProcessDefinition(BpmnParseResult parseResult) {
        return saveProcessDefinition(parseResult, DefinitionSchema.BPMN_XML);
    }

    private ProcessDefinitionEntity saveProcessDefinition(BpmnParseResult parseResult, DefinitionSchema schema) {
        return saveProcessDefinition(parseResult, schema, ProjectConstants.DEFAULT_PROJECT_ID);
    }

    private ProcessDefinitionEntity saveProcessDefinition(BpmnParseResult parseResult, DefinitionSchema schema,
            String projectId) {
        return saveProcessDefinition(parseResult, schema, projectId, null, null);
    }

    private ProcessDefinitionEntity saveProcessDefinition(BpmnParseResult parseResult, DefinitionSchema schema,
            String projectId, String toolBindings, String pinnedCalls) {
        ParsedProcessDefinition definition = parseResult.definition();
        String checksum = sha256(definition.getRawXml());
        ProcessDefinitionEntity latest = persistenceService
                .findProcessDefinitionByProjectAndId(projectId, definition.getId());
        // Same source, tools and called versions: nothing changed. A changed tool server or a newer
        // called process makes a new version.
        if (latest != null && checksum.equals(latest.getChecksum())
                && java.util.Objects.equals(toolBindings, latest.getToolBindings())
                && java.util.Objects.equals(pinnedCalls, latest.getCallTargets())) {
            return latest;
        }
        ProcessDefinitionEntity entity = new ProcessDefinitionEntity();
        entity.setProjectId(projectId);
        entity.setId(definition.getId());
        entity.setVersion(latest == null ? 1 : latest.getVersion() + 1);
        entity.setChecksum(checksum);
        entity.setName(definition.getName());
        entity.setDocumentation(definition.getDocumentation());
        entity.setBpmnXml(definition.getRawXml());
        entity.setSchemaType(schema.name());
        entity.setDefinitionFormatVersion(schema == DefinitionSchema.APL_NATIVE ? "apl-native-1" : "canonical-1");
        entity.setCompatibilityProfiles(String.join(",", parseResult.activeProfiles()));
        entity.setDetectedNamespaces(String.join(",", new TreeSet<>(parseResult.detectedNamespaces())));
        entity.setCompilerVersion(schema == DefinitionSchema.APL_NATIVE ? "apl-1" : "1");
        entity.setToolBindings(toolBindings);
        entity.setCallTargets(pinnedCalls);
        try {
            entity.setCompatibilityReport(om.writeValueAsString(parseResult.report()));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Serialize BPMN compatibility report failed", exception);
        }

        // Save candidate starter groups and users as comma-separated strings
        if (definition.getCandidateStarterGroups() != null && !definition.getCandidateStarterGroups().isEmpty()) {
            entity.setCandidateStarterGroups(String.join(",", definition.getCandidateStarterGroups()));
        }
        if (definition.getCandidateStarterUsers() != null && !definition.getCandidateStarterUsers().isEmpty()) {
            entity.setCandidateStarterUsers(String.join(",", definition.getCandidateStarterUsers()));
        }

        return persistenceService.saveProcessDefinition(entity);
    }

    private Map<String, Object> readMap(String json) {
        if (json == null || json.isBlank())
            return new HashMap<>();
        try {
            return om.readValue(json, new TypeReference<>() {
            });
        } catch (IOException ex) {
            throw new IllegalStateException("Bad variables_json", ex);
        }
    }

    private String writeMap(Map<String, Object> m) {
        try {
            return om.writeValueAsString(m == null ? Map.of() : m);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Serialize variables failed", ex);
        }
    }

    private String writeValue(Object value) {
        try {
            return om.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Serialize runtime state failed", ex);
        }
    }

    private List<String> readList(String json, List<String> fallback) {
        if (json == null || json.isBlank()) return fallback;
        try {
            return om.readValue(json, new TypeReference<>() {});
        } catch (IOException ex) {
            throw new IllegalStateException("Bad active_tokens_json", ex);
        }
    }

    private Map<String, Integer> readIntegerMap(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return om.readValue(json, new TypeReference<>() {});
        } catch (IOException ex) {
            throw new IllegalStateException("Bad join_expected_tokens_json", ex);
        }
    }

    private Map<String, Set<String>> readSetMap(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return om.readValue(json, new TypeReference<>() {});
        } catch (IOException ex) {
            throw new IllegalStateException("Bad join_arrived_tokens_json", ex);
        }
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        }
    }

    /**
     * Models of the definition's agent tasks that no configured AI provider
     * serves (a task without a model needs any provider). Empty when every
     * agent task can run, or when the definition has none.
     */
    private List<String> unconfiguredAgentModels(ParsedProcessDefinition definition) {
        if (definition == null || definition.getServiceTasks() == null) return List.of();
        java.util.Set<String> missing = new java.util.LinkedHashSet<>();
        definition.getServiceTasks().values().stream()
                .filter(task -> task.agentWork() != null
                        || AplParser.AGENT_EXTERNAL_TOPIC.equals(task.topicName()))
                .forEach(task -> {
                    String model = task.agentWork() == null ? null : task.agentWork().model();
                    if (aiProviders == null || aiProviders.resolveForModel(model).isEmpty()) {
                        missing.add(model == null || model.isBlank() ? "(default)" : model);
                    }
                });
        return List.copyOf(missing);
    }

}
