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
import com.abada.engine.core.model.ProcessStatus;
import com.abada.engine.dto.UserTaskPayload;
import com.abada.engine.observability.EngineMetrics;
import com.abada.engine.observability.TraceLogContext;
import com.abada.engine.parser.AplParser;
import com.abada.engine.parser.BpmnParser;
import com.abada.engine.persistence.PersistenceService;
import com.abada.engine.persistence.entity.ExternalTaskEntity;
import com.abada.engine.persistence.entity.ProcessDefinitionEntity;
import com.abada.engine.persistence.entity.ProcessInstanceEntity;
import com.abada.engine.persistence.entity.TaskEntity;
import com.abada.engine.persistence.repository.ExternalTaskRepository;
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

@Component
public class AbadaEngine {

    private static final Logger log = LoggerFactory.getLogger(AbadaEngine.class);

    private final PersistenceService persistenceService;
    private final BpmnParser parser;
    private final AplParser aplParser = new AplParser();
    private final TaskManager taskManager;
    private final EventManager eventManager;
    private final JobScheduler jobScheduler;
    private final ExternalTaskRepository externalTaskRepository;
    private final ObjectMapper om;
    private final EngineMetrics engineMetrics;
    private final Tracer tracer;
    private final ActivityHistoryService historyService;
    private final Map<String, ParsedProcessDefinition> definitionsByDeploymentId = new ConcurrentHashMap<>();

    @Autowired
    public AbadaEngine(PersistenceService persistenceService, TaskManager taskManager, @Lazy EventManager eventManager,
            @Lazy JobScheduler jobScheduler, ExternalTaskRepository externalTaskRepository, ObjectMapper om,
            EngineMetrics engineMetrics, Tracer tracer, ActivityHistoryService historyService) {
        this.persistenceService = persistenceService;
        this.parser = new BpmnParser();
        this.taskManager = taskManager;
        this.eventManager = eventManager;
        this.jobScheduler = jobScheduler;
        this.externalTaskRepository = externalTaskRepository;
        this.om = om;
        this.engineMetrics = engineMetrics;
        this.tracer = tracer;
        this.historyService = historyService;
    }

    @PostConstruct
    public void setup() {
        eventManager.setAbadaEngine(this);
        jobScheduler.setAbadaEngine(this);
    }

    @AtomicRuntimeCommand
    public ProcessDefinitionEntity deploy(InputStream bpmnXml) {
        return deploy(bpmnXml, BpmnParseOptions.defaults());
    }

    @AtomicRuntimeCommand
    public ProcessDefinitionEntity deploy(InputStream bpmnXml, BpmnParseOptions options) {
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
            }
            ParsedProcessDefinition definition = parseResult.definition();
            ProcessDefinitionEntity persisted = saveProcessDefinition(parseResult, schema);
            historyService.record("PROCESS_DEFINITION_DEPLOYED", null, definition.getId(), null,
                    Map.of("deploymentId", persisted.getDeploymentId(), "version", persisted.getVersion()));
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

    public ParsedProcessDefinition getParsedProcessDefinition(String processDefinitionId) {
        ProcessDefinitionEntity latest = persistenceService.findProcessDefinitionById(processDefinitionId);
        return latest == null ? null : cacheDefinition(latest);
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
        Timer.Sample sample = engineMetrics.startProcessTimer();
        Span span = tracer.spanBuilder("abada.process.start").startSpan();

        try (var scope = TraceLogContext.open(span)) {
            ProcessDefinitionEntity deployment = persistenceService.findProcessDefinitionById(processDefinitionId);
            if (deployment == null) {
                throw new ProcessEngineException("Unknown process ID: " + processDefinitionId);
            }
            ParsedProcessDefinition definition = cacheDefinition(deployment);

            ProcessInstance instance = new ProcessInstance(definition);
            instance.setProcessDefinitionDeploymentId(deployment.getDeploymentId());
            instance.putAllVariables(initialVariables);
            instance.setStartedBy(username != null && !username.isBlank() ? username : "system");

            span.setAttribute("process.instance.id", instance.getId());
            span.setAttribute("process.definition.id", processDefinitionId);
            span.setAttribute("process.definition.name", definition.getName());

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

            historyService.record("PROCESS_STARTED", instance, definition.getStartEventId(), Map.of());
            recordDecisionTableAudits(instance);

            for (UserTaskPayload task : userTasks) {
                createAndPersistTask(task, instance);
            }

            eventManager.registerWaitStates(instance);
            scheduleWaitingTimerEvents(instance);
            createExternalTaskJobs(instance);
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

    // Overloaded version for backward compatibility
    public ProcessInstance startProcess(@SpanTag("process.definition.id") String processDefinitionId) {
        return startProcess(processDefinitionId, null);
    }

    @AtomicRuntimeCommand
    public void claim(String taskId, String user, List<String> groups) {
        TaskInstance task = loadTaskForUpdate(taskId);
        requireActiveProcessForTask(task);
        taskManager.claimTask(task, user, groups);
        persistTask(task);
        historyService.record("TASK_CLAIMED", loadProcessInstance(task.getProcessInstanceId()),
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
        log.info("Completing task {} with variables: {}", taskId, variables);
        TaskInstance currentTask = loadTaskForUpdate(taskId);
        taskManager.checkCanComplete(currentTask, user, groups);

        String processInstanceId = currentTask.getProcessInstanceId();
        ProcessInstanceEntity authoritativeInstance =
                persistenceService.findProcessInstanceByIdForUpdate(processInstanceId);
        if (authoritativeInstance == null) {
            // This is an internal consistency error, not a client error.
            throw new IllegalStateException("No process instance found for id=" + processInstanceId);
        }
        ProcessInstance instance = materializeProcessInstance(authoritativeInstance);

        requireActive(instance);

        if (variables != null && !variables.isEmpty()) {
            instance.putAllVariables(variables);
        }

        taskManager.completeTask(currentTask);
        persistTask(currentTask);
        historyService.record("TASK_COMPLETED", instance, currentTask.getTaskDefinitionKey(), Map.of());
        persistRuntimeState(instance);

        List<UserTaskPayload> nextTasks = instance.advance(currentTask.getTaskDefinitionKey());
        recordDecisionTableAudits(instance);
        if (instance.isCompleted() && instance.getEndDate() == null) {
            instance.setEndDate(Instant.now());
        }
        persistRuntimeState(instance);

        for (UserTaskPayload task : nextTasks) {
            createAndPersistTask(task, instance);
        }

        eventManager.registerWaitStates(instance);
        scheduleWaitingTimerEvents(instance);
        createExternalTaskJobs(instance);
    }

    @AtomicRuntimeCommand
    public void failTask(String taskId) {
        TaskInstance task = loadTaskForUpdate(taskId);
        requireActiveProcessForTask(task);
        taskManager.failTask(task);
        persistTask(task);
        historyService.record("TASK_FAILED", loadProcessInstance(task.getProcessInstanceId()),
                task.getTaskDefinitionKey(), Map.of());
    }

    @AtomicRuntimeCommand
    public boolean failProcess(String processInstanceId) {
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null || instance.getStatus() == ProcessStatus.COMPLETED
                || instance.getStatus() == ProcessStatus.FAILED
                || instance.getStatus() == ProcessStatus.CANCELLED) {
            log.warn("Process instance {} not found or already in a terminal state.", processInstanceId);
            return false;
        }

        log.info("Failing process instance {}", processInstanceId);
        instance.setStatus(ProcessStatus.FAILED);
        instance.setEndDate(Instant.now());
        instance.setActiveTokens(Collections.emptyList()); // Clear active tokens to stop execution

        // Record metrics for process failure
        engineMetrics.recordProcessFailed(instance.getDefinition().getId());

        persistRuntimeState(instance);
        historyService.record("PROCESS_FAILED", instance, null, Map.of());
        return true;
    }

    @AtomicRuntimeCommand
    public void cancelProcessInstance(String processInstanceId, String reason) {
        log.info("Cancelling process instance {} for reason: {}", processInstanceId, reason);
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null) {
            throw new ProcessEngineException("Process instance not found: " + processInstanceId);
        }

        if (instance.getStatus() == ProcessStatus.COMPLETED || instance.getStatus() == ProcessStatus.FAILED
                || instance.getStatus() == ProcessStatus.CANCELLED) {
            throw new ProcessEngineException(
                    "Process instance is already in a terminal state: " + instance.getStatus());
        }

        instance.setStatus(ProcessStatus.CANCELLED);
        instance.setEndDate(Instant.now());
        instance.setActiveTokens(Collections.emptyList());

        persistRuntimeState(instance);
        historyService.record("PROCESS_CANCELLED", instance, null, Map.of("reason", reason == null ? "" : reason));
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
        log.info("Resuming process instance {} from event {}", processInstanceId, eventId);
        ProcessInstance instance = loadProcessInstanceForUpdate(processInstanceId);
        if (instance == null) {
            throw new ProcessEngineException("No process instance found for id=" + processInstanceId);
        }

        requireActive(instance);

        if (variables != null && !variables.isEmpty()) {
            instance.putAllVariables(variables);
        }

        List<UserTaskPayload> nextTasks = instance.advance(eventId);
        recordDecisionTableAudits(instance);
        if (instance.isCompleted() && instance.getEndDate() == null) {
            instance.setEndDate(Instant.now());
        }
        persistRuntimeState(instance);
        historyService.record("EVENT_CORRELATED", instance, eventId, Map.of());

        for (UserTaskPayload task : nextTasks) {
            createAndPersistTask(task, instance);
        }

        eventManager.registerWaitStates(instance);
        scheduleWaitingTimerEvents(instance);
        createExternalTaskJobs(instance);
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
        instance.setEntityVersion(entity.getEntityVersion());
        instance.setStartedBy(entity.getStartedBy());
        instance.putAllVariables(readMap(entity.getVariablesJson()));
        instance.setActiveTokens(readList(entity.getActiveTokensJson(), activeTokens));
        instance.setJoinExpectedTokens(readIntegerMap(entity.getJoinExpectedTokensJson()));
        instance.setJoinArrivedTokens(readSetMap(entity.getJoinArrivedTokensJson()));
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

    private ParsedProcessDefinition cacheDefinition(ProcessDefinitionEntity entity) {
        byte[] source = entity.getBpmnXml().getBytes(StandardCharsets.UTF_8);
        return definitionsByDeploymentId.computeIfAbsent(entity.getDeploymentId(), ignored -> {
            if (DefinitionSchema.from(entity.getSchemaType()) == DefinitionSchema.APL_NATIVE) {
                return aplParser.parse(source);
            }
            return parser.parseDetailed(new java.io.ByteArrayInputStream(source),
                            new BpmnParseOptions(Arrays.stream(entity.getCompatibilityProfiles().split(","))
                                    .map(String::trim).filter(value -> !value.isEmpty()).toList(), false, false))
                    .definition();
        });
    }

    /** Records decision-table applications (identifiers and names only) in history and the outbox. */
    private void recordDecisionTableAudits(ProcessInstance instance) {
        for (DecisionTableAudit audit : instance.takeDecisionAudits()) {
            historyService.record("DECISION_TABLE_APPLIED", instance, audit.activityId(), Map.of(
                    "decisionKey", audit.decisionKey(),
                    "matchedRuleIndexes", audit.matchedRuleIndexes(),
                    "inputNames", audit.inputNames(),
                    "outputNames", audit.outputNames()));
        }
    }

    private void createAndPersistTask(UserTaskPayload task, ProcessInstance instance) {
        TaskInstance createdTask = taskManager.createTaskSnapshot(
                task.taskDefinitionKey(),
                task.name(),
                instance.getId(),
                task.assignee(),
                task.candidateUsers(),
                task.candidateGroups(),
                task.assignmentStrategy());
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
        for (String tokenId : instance.getActiveTokens()) {
            if (definition.isCatchEvent(tokenId)) {
                EventMeta eventMeta = definition.getEvents().get(tokenId);
                if (eventMeta != null && eventMeta.type() == EventMeta.EventType.TIMER) {
                    try {
                        Duration duration = Duration.parse(eventMeta.definitionRef());
                        jobScheduler.scheduleJob(instance.getId(), tokenId, Instant.now().plus(duration));
                    } catch (Exception e) {
                        throw new ProcessEngineException("Could not persist timer " + tokenId
                                + " with duration " + eventMeta.definitionRef(), e);
                    }
                }
            }
        }
    }

    private void createExternalTaskJobs(ProcessInstance instance) {
        ParsedProcessDefinition definition = instance.getDefinition();
        for (String tokenId : instance.getActiveTokens()) {
            if (definition.isServiceTask(tokenId)) {
                ServiceTaskMeta serviceTaskMeta = definition.getServiceTask(tokenId);
                if (serviceTaskMeta != null && serviceTaskMeta.topicName() != null) {
                    if (externalTaskRepository.existsByProcessInstanceIdAndActivityIdAndStatusIn(instance.getId(),
                            tokenId, List.of(ExternalTaskEntity.Status.OPEN, ExternalTaskEntity.Status.LOCKED))) {
                        continue;
                    }
                    ExternalTaskEntity externalTask = new ExternalTaskEntity(instance.getId(),
                            serviceTaskMeta.topicName());
                    externalTask.setActivityId(tokenId);
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
        return entity;
    }

    private void persistRuntimeState(ProcessInstance instance) {
        persistRuntimeState(instance, convertToEntity(instance));
    }

    private void persistRuntimeState(ProcessInstance instance, ProcessInstanceEntity entity) {
        ProcessInstanceEntity saved = persistenceService.saveOrUpdateProcessInstance(entity);
        instance.setEntityVersion(saved.getEntityVersion());
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

        entity.setCandidateUsers(new ArrayList<>(taskInstance.getCandidateUsers()));
        entity.setCandidateGroups(new ArrayList<>(taskInstance.getCandidateGroups()));
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
    public Page<ProcessDefinitionEntity> getDeployedProcesses(Pageable pageable) {
        return persistenceService.findProcessDefinitions(pageable);
    }

    @Transactional(readOnly = true)
    public Page<ProcessDefinitionEntity> getDeployedProcesses(String processKey, Pageable pageable) {
        return persistenceService.findProcessDefinitions(processKey, pageable);
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
        ParsedProcessDefinition definition = parseResult.definition();
        String checksum = sha256(definition.getRawXml());
        ProcessDefinitionEntity latest = persistenceService.findProcessDefinitionById(definition.getId());
        if (latest != null && checksum.equals(latest.getChecksum())) {
            return latest;
        }
        ProcessDefinitionEntity entity = new ProcessDefinitionEntity();
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

}
