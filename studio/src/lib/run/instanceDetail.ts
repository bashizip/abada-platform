import { WorkflowFile } from '@/types';
import {
  ActivityHistoryDTO,
  ActivityInstanceDTO,
  ProcessInstanceDTO,
  ProcessDefinitionDTO,
  ProjectJob,
} from '@/api/engine';
import { deriveLiveExecutionOverlay, NodeRunStatus } from '@/lib/run/liveRun';
import { deriveBusinessLabel, statusOf, unwrapVariable } from '@/lib/run/instanceFormat';

export interface InstancePath {
  statuses: Record<string, NodeRunStatus>;
  activeNodeIds: string[];
  /** Edge ids on the taken execution path (both endpoints touched by events/tokens). */
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
}

/**
 * Derives the execution overlay strictly from engine-visible facts: node
 * statuses from history/active tokens, and the taken path as edges whose both
 * endpoints were touched (completed, active or failed). Unchosen branches keep
 * their dimmed default styling. Token motion is anchored at the current
 * position only — the taken history stays a static highlight.
 */
export function deriveInstancePath(
  workflow: WorkflowFile,
  instance: ProcessInstanceDTO,
  activities: ActivityInstanceDTO[],
  history: ActivityHistoryDTO[],
): InstancePath {
  const overlay = deriveLiveExecutionOverlay(workflow, instance, activities, history);
  const touched = new Set<string>();
  if (instance.currentActivityId) touched.add(instance.currentActivityId);
  activities.forEach((activity) => touched.add(activity.activityId));
  history.forEach((event) => {
    if (event.activityId) touched.add(event.activityId);
  });
  const activePathEdgeIds = workflow.edges
    .filter((edge) => touched.has(edge.source) && touched.has(edge.target))
    .map((edge) => edge.id);
  const takenIds = new Set(activePathEdgeIds);
  const activeIds = new Set(overlay.activeNodeIds);
  const tokenEdgeIds = overlay.activeNodeIds.flatMap((activeNodeId) => {
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
  const tokenIds = new Set(tokenEdgeIds);
  const nextEdgeIds = workflow.edges
    .filter((edge) => activeIds.has(edge.source) && !tokenIds.has(edge.id))
    .map((edge) => edge.id);
  return {
    statuses: overlay.statuses,
    activeNodeIds: overlay.activeNodeIds,
    activePathEdgeIds,
    tokenEdgeIds,
    nextEdgeIds,
  };
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
};

export const eventMeta = (eventType: string): { label: string; tone: AuditTone } =>
  EVENT_META[eventType] ?? { label: eventType.replace(/_/g, ' ').toLowerCase(), tone: 'info' };

/** Aggregates the agent attempt telemetry recorded in history details for one activity. */
export interface AgentTelemetry {
  model?: string;
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
  const job = jobs.find((item) => item.activityId === activityId);
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
