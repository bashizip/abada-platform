import { WorkflowEdge, WorkflowFile } from '@/types';
import { isOutcomeRouteEdge } from '@/lib/apl/parser';
import {
  ActivityHistoryDTO,
  ActivityInstanceDTO,
  ProcessInstanceDTO,
  ProcessDefinitionDTO,
  ProjectJob,
} from '@/api/engine';
import { deriveLiveExecutionOverlay, NodeRunStatus } from '@/lib/run/liveRun';
import { deriveBusinessLabel, statusOf, unwrapVariable } from '@/lib/run/instanceFormat';
import { buildPathView, edgeOfFlow, recordedFlows, type PathView } from '@/lib/run/instancePath';

export interface InstancePath {
  statuses: Record<string, NodeRunStatus>;
  activeNodeIds: string[];
  /** Edge ids on the taken execution path. */
  activePathEdgeIds: string[];
  /**
   * Taken edges whose target is a currently active node — the token arriving
   * at the current position. One edge per active node (parallel gateways
   * included); the only edges that get an animated token dot.
   */
  tokenEdgeIds: string[];
  /**
   * Edges leaving a currently active node — the possible next steps. Rendered
   * with the animated flow dash (dry-run style), without a token dot.
   */
  nextEdgeIds: string[];
  /** The three layers the canvas draws: path taken, where it is now, not reached. */
  path: PathView;
}

export interface InstancePathOptions {
  /** Nodes with an open incident (their token is stopped, so it is not among the waiting activities). */
  incidentNodeIds?: string[];
}

/**
 * Derives the execution overlay from engine facts. Since 1.2 the engine
 * records every sequence flow a token takes (`FLOW_TAKEN`): the path is read
 * from those facts, in order, with each loop pass and branch decision. Only an
 * instance whose history predates them (started before the upgrade) falls
 * back to inferring the path from the activities it touched, and says so
 * (`path.source === 'reconstructed'`).
 */
export function deriveInstancePath(
  workflow: WorkflowFile,
  instance: ProcessInstanceDTO,
  activities: ActivityInstanceDTO[],
  history: ActivityHistoryDTO[],
  options: InstancePathOptions = {},
): InstancePath {
  const overlay = deriveLiveExecutionOverlay(workflow, instance, activities, history);
  const flows = recordedFlows(history);
  const startEvent = history.find((event) => event.eventType === 'PROCESS_STARTED')?.activityId
    ?? workflow.nodes.find((node) => node.type === 'event' && node.subtype === 'start')?.id;
  // Complete only when the first hop left the start: otherwise the instance ran before the upgrade.
  const complete = flows.length > 0 && flows[0].from === startEvent;
  const recordedSteps = flows
    .map((flow) => ({ flow, edge: edgeOfFlow(workflow.edges, flow) }))
    .filter((step): step is { flow: typeof step.flow; edge: WorkflowEdge } => !!step.edge);

  const statuses = { ...overlay.statuses };
  const activeIds = new Set(overlay.activeNodeIds);
  let activePathEdgeIds: string[];
  let tokenEdgeIds: string[];
  let path: PathView;
  if (complete) {
    activePathEdgeIds = [...new Set(recordedSteps.map((step) => step.edge.id))];
    // The edge each active token arrived by: the last recorded flow into it.
    tokenEdgeIds = [...new Set(overlay.activeNodeIds.flatMap((nodeId) => {
      const last = [...recordedSteps].reverse().find((step) => step.edge.target === nodeId);
      return last ? [last.edge.id] : [];
    }))];
    path = buildPathView(workflow, {
      entry: startEvent, steps: recordedSteps, statuses, activeNodeIds: overlay.activeNodeIds,
      incidentNodeIds: options.incidentNodeIds ?? [], status: instance.status, source: 'recorded', history,
    });
    // Every node the path left is done; an end the path never reached is not.
    for (const nodeId of Object.keys(path.visits)) {
      if (!activeIds.has(nodeId) && statuses[nodeId] === 'idle') statuses[nodeId] = 'completed';
    }
    workflow.nodes.filter((node) => node.type === 'event' && node.subtype === 'end' && !path.visits[node.id])
      .forEach((node) => { if (statuses[node.id] === 'completed') statuses[node.id] = 'idle'; });
  } else {
    const inferred = inferTakenEdges(workflow, instance, activities, history);
    // Facts recorded after the upgrade still count.
    activePathEdgeIds = [...new Set([...inferred, ...recordedSteps.map((step) => step.edge.id)])];
    const takenIds = new Set(activePathEdgeIds);
    tokenEdgeIds = overlay.activeNodeIds.flatMap((activeNodeId) => {
      const incoming = workflow.edges.filter((edge) => edge.target === activeNodeId);
      const takenIncoming = incoming.filter((edge) => takenIds.has(edge.id));
      // Gateways may advance synchronously without producing an activity event.
      // A sole incoming edge is still unambiguous evidence of the arrival path.
      const tokenEdges = takenIncoming.length > 0
        ? takenIncoming
        : incoming.length === 1
          ? incoming
          : [];
      return tokenEdges.map((edge) => edge.id);
    });
    const edgesById = new Map(workflow.edges.map((edge) => [edge.id, edge]));
    path = buildPathView(workflow, {
      entry: startEvent,
      steps: activePathEdgeIds.map((id) => ({ edge: edgesById.get(id)! })),
      touchedOrder: touchedInOrder(instance, activities, history),
      statuses, activeNodeIds: overlay.activeNodeIds, incidentNodeIds: options.incidentNodeIds ?? [],
      status: instance.status, source: 'reconstructed', history,
    });
  }
  const tokenIds = new Set(tokenEdgeIds);
  const nextEdgeIds = workflow.edges
    .filter((edge) => activeIds.has(edge.source) && !tokenIds.has(edge.id))
    .map((edge) => edge.id);
  return {
    statuses,
    activeNodeIds: overlay.activeNodeIds,
    activePathEdgeIds,
    tokenEdgeIds,
    nextEdgeIds,
    path,
  };
}

/** Activities in the order history first touched them (reconstructed paths). */
function touchedInOrder(
  instance: ProcessInstanceDTO,
  activities: ActivityInstanceDTO[],
  history: ActivityHistoryDTO[],
): string[] {
  const order: string[] = [];
  const add = (id: string | undefined) => { if (id && !order.includes(id)) order.push(id); };
  history.forEach((event) => add(event.activityId));
  activities.forEach((activity) => add(activity.activityId));
  add(instance.currentActivityId);
  return order;
}

/**
 * Pre-1.2 inference: edges whose both endpoints were touched (completed,
 * active or failed). Ambiguous with parallel branches, loops and two flows
 * between the same nodes — which is why recorded flows replace it.
 */
function inferTakenEdges(
  workflow: WorkflowFile,
  instance: ProcessInstanceDTO,
  activities: ActivityInstanceDTO[],
  history: ActivityHistoryDTO[],
): string[] {
  const touched = new Set<string>();
  if (instance.currentActivityId) touched.add(instance.currentActivityId);
  activities.forEach((activity) => touched.add(activity.activityId));
  history.forEach((event) => {
    if (event.activityId) touched.add(event.activityId);
  });
  return workflow.edges
    .filter((edge) => touched.has(edge.source) && touched.has(edge.target))
    .filter((edge) => !isOutcomeRouteEdge(edge) || outcomeRouteTaken(edge, history))
    .map((edge) => edge.id);
}

/** Boundary kind the engine records in BOUNDARY_TAKEN for each route label. */
const BOUNDARY_KIND: Record<string, string> = {
  on_low_confidence: 'LOW_CONFIDENCE',
  on_invalid_output: 'INVALID_OUTPUT',
  on_error: 'ERROR',
  on_timeout: 'TIMEOUT',
  outcome: 'OUTCOME',
};

/** Engine outcome recorded for each agent outcome-route label. */
const ROUTE_OUTCOME: Record<string, string> = {
  on_low_confidence: 'LOW_CONFIDENCE',
  on_invalid_output: 'INVALID_OUTPUT',
};

/**
 * A boundary route (`on_low_confidence`, `on_invalid_output`, `on_error`,
 * `on_timeout`) is taken only when the engine recorded it for its source:
 * visiting both ends is not enough, since the normal successor may lead there
 * too. Since 1.1 every boundary records `BOUNDARY_TAKEN` with its target (and
 * error code); older history is read from the agent verdict
 * (`EXTERNAL_TASK_COMPLETED.details.agentOutcome`) and the routed BPMN error
 * (`EXTERNAL_TASK_BPMN_ERROR.details.routedTo`).
 */
function outcomeRouteTaken(edge: WorkflowEdge, history: ActivityHistoryDTO[]): boolean {
  const label = edge.label ?? '';
  const fromSource = history.filter((event) => event.activityId === edge.source);
  const code = label.startsWith('on_error:') || label.startsWith('outcome:')
    ? label.slice(label.indexOf(':') + 1).trim() : null;
  const kind = BOUNDARY_KIND[label.split(':')[0]];
  if (kind && fromSource.some((event) => event.eventType === 'BOUNDARY_TAKEN'
    && event.details?.kind === kind
    && event.details?.routedTo === edge.target
    && (!code || event.details?.code === code))) {
    return true;
  }
  if (label.startsWith('on_error')) {
    return fromSource.some((event) => event.eventType === 'EXTERNAL_TASK_BPMN_ERROR'
      && event.details?.routedTo === edge.target
      && (!code || event.details?.errorCode === code));
  }
  const outcome = ROUTE_OUTCOME[label];
  return !!outcome && fromSource.some((event) => event.eventType === 'EXTERNAL_TASK_COMPLETED'
    && event.details?.agentOutcome === outcome);
}

export type AuditTone = 'success' | 'failure' | 'running' | 'warning' | 'info' | 'external';

export const EVENT_META: Record<string, { label: string; tone: AuditTone }> = {
  PROCESS_STARTED: { label: 'Process started', tone: 'running' },
  PROCESS_COMPLETED: { label: 'Process completed', tone: 'success' },
  PROCESS_FAILED: { label: 'Process failed', tone: 'failure' },
  PROCESS_CANCELLED: { label: 'Process cancelled', tone: 'failure' },
  PROCESS_DEFINITION_DEPLOYED: { label: 'Definition deployed', tone: 'info' },
  VARIABLES_UPDATED: { label: 'Variables updated', tone: 'info' },
  EVENT_CORRELATED: { label: 'Event correlated', tone: 'warning' },
  DECISION_TABLE_APPLIED: { label: 'Decision table applied', tone: 'success' },
  TASK_CREATED: { label: 'Task created', tone: 'warning' },
  TASK_ASSIGNED: { label: 'Task assigned', tone: 'warning' },
  TASK_CLAIMED: { label: 'Task claimed', tone: 'running' },
  TASK_UNCLAIMED: { label: 'Task unclaimed', tone: 'info' },
  TASK_COMPLETED: { label: 'Task completed', tone: 'success' },
  TASK_FAILED: { label: 'Task failed', tone: 'failure' },
  TIMER_JOB_COMPLETED: { label: 'Timer fired', tone: 'success' },
  TIMER_JOB_FAILED: { label: 'Timer job failed', tone: 'failure' },
  EXTERNAL_TASK_LOCKED: { label: 'Job locked by worker', tone: 'external' },
  EXTERNAL_TASK_COMPLETED: { label: 'Job completed', tone: 'success' },
  EXTERNAL_TASK_FAILED: { label: 'Job failed', tone: 'failure' },
  EXTERNAL_TASK_LOCK_EXTENDED: { label: 'Job lock extended', tone: 'external' },
  EXTERNAL_TASK_RETRIES_SET: { label: 'Job retries set', tone: 'warning' },
  EXTERNAL_TASK_BPMN_ERROR: { label: 'Job BPMN error', tone: 'failure' },
  EXTERNAL_TASK_DEFERRED: { label: 'Model unavailable, retry deferred', tone: 'warning' },
  BOUNDARY_TAKEN: { label: 'Boundary route taken', tone: 'warning' },
  TASK_SLA_BREACHED: { label: 'SLA missed, task escalated', tone: 'warning' },
  LOOP_EXHAUSTED: { label: 'Loop limit reached', tone: 'warning' },
  INCIDENT_RETRIED: { label: 'Incident retried', tone: 'warning' },
  FLOW_TAKEN: { label: 'Flow taken', tone: 'info' },
};

/** One line for a BOUNDARY_TAKEN event: which route left the step, e.g. `outcome reject → draft`. */
export function boundarySummary(details: Record<string, unknown>): string | undefined {
  if (typeof details.kind !== 'string' || typeof details.routedTo !== 'string') return undefined;
  const kind = details.kind.toLowerCase().replace(/_/g, ' ');
  const code = typeof details.code === 'string' ? ` ${details.code}` : '';
  return `${kind}${code} → ${details.routedTo}`;
}

export const eventMeta = (eventType: string): { label: string; tone: AuditTone } =>
  EVENT_META[eventType] ?? { label: eventType.replace(/_/g, ' ').toLowerCase(), tone: 'info' };

/** Aggregates the agent attempt telemetry recorded in history details for one activity. */
export interface AgentTelemetry {
  model?: string;
  /** The node's declared model when the worker ran a fallback model instead. */
  requestedModel?: string;
  provider?: string;
  attempt?: number;
  durationMs?: number;
  tools?: string[];
  resultVariable?: string;
  promptHash?: string;
  errorType?: string;
  /** Achieved {@code _confidence} (0-100) reported by the worker, when present. */
  confidence?: number;
  /** The APL confidence_threshold the attempt was gated against. */
  confidenceThreshold?: number;
  workerId?: string;
  retries?: number;
  topic?: string;
  errorMessage?: string;
  /** Provider token usage for the attempt, when reported. */
  promptTokens?: number;
  completionTokens?: number;
  /** Engine-side output contract result: OK, LOW_CONFIDENCE, INVALID_OUTPUT or ERROR. */
  outcome?: string;
  /** Why the engine rejected the result (JSON paths and keywords, never values). */
  outcomeReason?: string;
}

export function aggregateNodeTelemetry(
  history: ActivityHistoryDTO[],
  activityId: string,
  jobs: ProjectJob[],
): { agent?: AgentTelemetry; workerIds: string[]; retries: number; errorMessage?: string } {
  const workerIds = new Set<string>();
  let retries = 0;
  let agent: AgentTelemetry | undefined;
  let errorMessage: string | undefined;
  for (const event of history) {
    if (!event.activityId || event.activityId !== activityId) continue;
    const details = (event.details ?? {}) as Record<string, unknown>;
    const rawWorker = details.workerId;
    if (typeof rawWorker === 'string' && rawWorker) workerIds.add(rawWorker);
    if (typeof details.retries === 'number') retries = details.retries;
    const rawAgent = details.agent as Record<string, unknown> | undefined;
    if (rawAgent && typeof rawAgent === 'object') {
      agent = {
        ...(agent ?? {}),
        model: typeof rawAgent.model === 'string' ? rawAgent.model : undefined,
        requestedModel: typeof rawAgent.requestedModel === 'string' ? rawAgent.requestedModel : undefined,
        provider: typeof rawAgent.provider === 'string' ? rawAgent.provider : undefined,
        attempt: typeof rawAgent.attempt === 'number' ? rawAgent.attempt : undefined,
        durationMs: typeof rawAgent.durationMs === 'number' ? rawAgent.durationMs : undefined,
        tools: Array.isArray(rawAgent.tools) ? rawAgent.tools.map(String) : undefined,
        resultVariable: typeof rawAgent.resultVariable === 'string' ? rawAgent.resultVariable : undefined,
        promptHash: typeof rawAgent.promptHash === 'string' ? rawAgent.promptHash : undefined,
        errorType: typeof rawAgent.errorType === 'string' ? rawAgent.errorType : undefined,
        confidence: typeof rawAgent.confidence === 'number' ? rawAgent.confidence : undefined,
        confidenceThreshold: typeof rawAgent.confidenceThreshold === 'number'
          ? rawAgent.confidenceThreshold : undefined,
        promptTokens: typeof rawAgent.promptTokens === 'number' ? rawAgent.promptTokens : undefined,
        completionTokens: typeof rawAgent.completionTokens === 'number' ? rawAgent.completionTokens : undefined,
      };
    }
    if (typeof details.agentOutcome === 'string') {
      agent = {
        ...(agent ?? {}),
        outcome: details.agentOutcome,
        outcomeReason: typeof details.outcomeReason === 'string' ? details.outcomeReason : undefined,
      };
    }
    if (typeof details.topic === 'string') agent = { ...(agent ?? {}), topic: details.topic };
    if (typeof rawAgent?.errorMessage === 'string') errorMessage = rawAgent.errorMessage as string;
  }
  // The project job list spans instances: only this instance's job applies.
  const instanceId = history.find((event) => event.processInstanceId)?.processInstanceId;
  const job = jobs.find((item) => item.activityId === activityId
    && (!instanceId || !item.processInstanceId || item.processInstanceId === instanceId));
  if (job) {
    retries = job.retries ?? retries;
    errorMessage = job.exceptionMessage ?? errorMessage;
    agent = { ...(agent ?? {}), retries: job.retries ?? undefined };
  }
  return { agent, workerIds: [...workerIds], retries, errorMessage };
}

/** Builds the complete, serializable execution trace for the JSON export. */
export function buildExecutionTrace(
  instance: ProcessInstanceDTO,
  definition: ProcessDefinitionDTO | null,
  activities: ActivityInstanceDTO[],
  history: ActivityHistoryDTO[],
  variables: Record<string, unknown> | null,
  jobs: ProjectJob[],
): Record<string, unknown> {
  const { label } = deriveBusinessLabel(instance);
  return {
    exportedAt: new Date().toISOString(),
    instance: {
      id: instance.id,
      businessKey: label,
      status: statusOf(instance),
      processDefinitionId: instance.processDefinitionId,
      processDefinitionName: instance.processDefinitionName,
      startedBy: instance.startedBy,
      startDate: instance.startDate,
      endDate: instance.endDate ?? null,
      currentActivityId: instance.currentActivityId ?? null,
      suspended: instance.suspended,
    },
    definition: definition
      ? {
          processKey: definition.id,
          name: definition.name,
          version: definition.version,
          deploymentId: definition.deploymentId,
          schemaType: definition.schemaType,
          aplSource: definition.bpmnXml ?? null,
        }
      : null,
    activeActivities: activities,
    history,
    variables: variables ? unwrapVariable(variables) : null,
    jobs,
  };
}
