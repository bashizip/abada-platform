/**
 * Incident helpers shared by the Operations list and the instance detail
 * view. Studio only decides what to offer; the engine enforces who may retry,
 * which incidents accept a model and which models are allowed.
 */
import { ActivityHistoryDTO, EngineAPI, IncidentDTO } from '@/api/engine';
import type { ProjectRole } from '@/api/projects';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';
import { WorkflowFile } from '@/types';

export const INCIDENT_KIND_META: Record<string, { label: string; hint: string }> = {
  WORK_FAILED: { label: 'Work failed', hint: 'The step used up its attempts. Retry reopens it with a fresh attempt budget.' },
  LOOP_EXHAUSTED: { label: 'Loop exhausted', hint: 'A loop reached its limit with no exhaustion route. Retry restarts the step.' },
  MISSING_CORRELATION_KEY: { label: 'Missing correlation key', hint: 'A message wait could not compute its correlation key. Retry restarts the step.' },
  TOOL_OUTCOME_UNKNOWN: { label: 'Write outcome unknown', hint: 'An agent write was interrupted and its server takes no idempotency key, so it is never re-sent. Check the target system, then say whether it happened; the agent resumes with that fact.' },
};

export const incidentKindLabel = (kind: string): string => INCIDENT_KIND_META[kind]?.label ?? kind;

/** Retrying an incident is a project operator or owner action. */
export const canRetryIncidents = (roles: readonly ProjectRole[] | undefined): boolean =>
  !!roles?.some((role) => role === 'OPERATOR' || role === 'OWNER');

/**
 * The model an agent step currently runs on: the last model an operator
 * chose on retry, otherwise the deployed one. Null when the step is not an
 * agent step.
 */
export const agentStepModel = (
  workflow: WorkflowFile | null | undefined,
  activityId: string,
  history: readonly ActivityHistoryDTO[] = [],
): string | null => {
  const node = workflow?.nodes.find((item) => item.id === activityId);
  if (!node || node.type !== 'agent') return null;
  const override = [...history]
    .filter((event) => event.eventType === 'INCIDENT_RETRIED' && event.activityId === activityId
      && typeof event.details?.toModel === 'string' && event.details.toModel)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .pop();
  return (override?.details.toModel as string | undefined) ?? node.agentConfig?.model ?? '';
};

/** Models offered for "Retry on another model": the allowed ones except the current one. */
export const retryModelOptions = (allowed: readonly string[], current: string | null): string[] =>
  allowed.filter((model) => model !== current);

/** Only failed agent work can be retried on another model. */
export const offersModelRetry = (incident: IncidentDTO, model: string | null | undefined): boolean =>
  incident.type === 'WORK_FAILED' && model !== null && model !== undefined;

/**
 * Loads the current model of an incident's step from its instance's
 * immutable definition and history. Null for non-agent steps and BPMN
 * definitions.
 */
export const loadAgentStepModel = async (projectId: string, incident: IncidentDTO): Promise<string | null> => {
  const instance = await EngineAPI.getInstance(incident.processInstanceId, projectId);
  const [definition, history] = await Promise.all([
    EngineAPI.getDefinitionForInstance(instance, projectId),
    EngineAPI.getInstanceHistory(incident.processInstanceId, projectId),
  ]);
  if (definition?.schemaType !== 'APL_NATIVE' || !definition.bpmnXml) return null;
  return agentStepModel(aplToWorkflow(parseAPLYaml(definition.bpmnXml)), incident.activityId, history);
};
