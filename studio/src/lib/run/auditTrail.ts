import type { ActivityHistoryDTO, FlowTakenDTO } from '@/api/engine';
import type { DMNValue, WorkflowFile, WorkflowNode } from '@/types';
import { eventMeta } from '@/lib/run/instanceDetail';
import { humanize } from '@/lib/run/instanceFormat';

/**
 * The live audit trail (M5 S5): the instance history told as a story, one
 * entry per pass of a token through a node, plus the facts about the instance
 * as a whole (started, variables updated, suspended…). Read from recorded
 * facts only, with the same redacted fields as the raw rows:
 *
 * - A pass starts with the flow that entered the node and ends with the flow
 *   that left it; the facts recorded at the node in between belong to it.
 *   Synchronous nodes (engine tasks, scripts, gateways) record nothing but
 *   these flows, so this is the only place they appear.
 * - The actor follows the node type: the engine, an agent (model and prompt
 *   version), a person, or an external worker.
 * - A duration is shown only when the node waited for something (a worker, a
 *   person, a timer): it is the time between recorded facts.
 */

export type TrailActorKind = 'engine' | 'agent' | 'human' | 'worker';
export type TrailStatus = 'waiting' | 'running' | 'completed' | 'failed';

export interface TrailActor {
  kind: TrailActorKind;
  /** The person, the worker id, or nothing for the engine. */
  name?: string;
  /** Agent entries: the model that ran (or the declared one before it runs). */
  model?: string;
  /** Agent entries: the prompt version, or `#` and the start of the prompt hash. */
  prompt?: string;
}

interface TrailEntryBase {
  /** Stable across refetches: the id of the entry's first fact. */
  id: string;
  /** When the entry starts (its first fact). */
  at: string;
  /** The raw rows, as the history API returns them (already redacted by the engine). */
  facts: ActivityHistoryDTO[];
}

export interface NodeTrailEntry extends TrailEntryBase {
  kind: 'node';
  nodeId: string;
  title: string;
  nodeType?: WorkflowNode['type'];
  actor: TrailActor;
  status: TrailStatus;
  /** What happened, in a few words. */
  action: string;
  /** Milliseconds the node waited, when it waited for something. */
  durationMs?: number;
  /** Where the token went next and why (a gateway rule, a route). */
  exit?: string;
  /** Agent entries: the external tasks of the pass, for the agent-step inspector. */
  externalTaskIds: string[];
  /** Decision-table entries: the rules that matched, numbered from 1. */
  matchedRules?: number[];
  /** Decision-table entries: the matched rules themselves, read from the instance's deployed definition. */
  decision?: TrailDecision;
  /** Human entries: the outcome chosen and whether a comment was given (its length, never its text). */
  outcome?: string;
  commentLength?: number;
}

/** One rule of a decision table as the deployed definition declares it, numbered from 1. */
export interface TrailDecisionRule {
  number: number;
  otherwise: boolean;
  when?: string;
  then: Record<string, DMNValue>;
}

/**
 * What a decision-table application recorded, joined with the rules it names.
 * The engine records input and output names, never their values.
 */
export interface TrailDecision {
  decisionKey?: string;
  rules: TrailDecisionRule[];
  inputNames: string[];
  outputNames: string[];
}

const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];

/**
 * The decision a `DECISION_TABLE_APPLIED` fact records, with each matched rule
 * read from `node` (the node of the instance's own definition version, so the
 * indexes name the rules that actually ran). Null for any other fact.
 */
export function decisionOf(fact: ActivityHistoryDTO, node: WorkflowNode | undefined): TrailDecision | null {
  if (fact.eventType !== 'DECISION_TABLE_APPLIED') return null;
  const details = (fact.details ?? {}) as Record<string, unknown>;
  const indexes = Array.isArray(details.matchedRuleIndexes)
    ? details.matchedRuleIndexes.filter((index): index is number => typeof index === 'number') : [];
  const rules = node?.dmnConfig?.rules ?? [];
  return {
    decisionKey: typeof details.decisionKey === 'string' ? details.decisionKey : undefined,
    rules: indexes.map((index) => {
      const rule = rules[index];
      return { number: index + 1, otherwise: !!rule?.otherwise, when: rule?.when, then: rule?.then ?? {} };
    }),
    inputNames: names(details.inputNames),
    outputNames: names(details.outputNames),
  };
}

export interface InstanceTrailEntry extends TrailEntryBase {
  kind: 'instance';
  /** The node a fact names, when it names one no pass covers (a boundary event, a timer). */
  nodeId?: string;
  action: string;
  actorName: string;
  tone: ReturnType<typeof eventMeta>['tone'];
}

export type TrailEntry = NodeTrailEntry | InstanceTrailEntry;

const flowOf = (event: ActivityHistoryDTO): FlowTakenDTO | undefined =>
  event.flow ?? (event.details?.flow as FlowTakenDTO | undefined);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const time = (iso: string) => Date.parse(iso);

/** Facts that say the node waits for someone or something: its duration is meaningful. */
const WAITS = new Set(['EXTERNAL_TASK_LOCKED', 'TASK_CREATED', 'TASK_CLAIMED', 'CHILD_STARTED',
  'DELEGATION_STARTED', 'FOR_EACH_STARTED']);
const DONE = new Set(['EXTERNAL_TASK_COMPLETED', 'TASK_COMPLETED', 'CHILD_COMPLETED', 'DELEGATION_COMPLETED',
  'EVENT_CORRELATED', 'TIMER_JOB_COMPLETED', 'FOR_EACH_COMPLETED']);
const FAILS = new Set(['EXTERNAL_TASK_FAILED', 'TASK_FAILED', 'TIMER_JOB_FAILED', 'CHILD_FAILED',
  'EXTERNAL_TASK_BPMN_ERROR', 'EXTERNAL_TASK_OUTPUT_REJECTED', 'LOOP_EXHAUSTED', 'TOOL_OUTCOME_UNKNOWN']);

/** The label of a route a flow records. */
function routeText(flow: FlowTakenDTO): string | undefined {
  const route = flow.route;
  if (route) {
    const kind = route.kind.toLowerCase().replace(/_/g, ' ');
    return route.code ? `${kind} ${route.code}` : kind;
  }
  if (flow.condition) return flow.condition;
  if (flow.else) return 'else';
  return undefined;
}

interface Pass {
  entry: NodeTrailEntry;
  node: WorkflowNode | undefined;
  open: boolean;
}

/** The prompt shown for an agent: its version when reported, else `#` and 8 characters of its hash. */
function promptLabel(version: string | undefined, hash: string | undefined): string | undefined {
  if (version) return version;
  return hash ? `#${hash.slice(0, 8)}` : undefined;
}

function actorOf(node: WorkflowNode | undefined): TrailActor {
  switch (node?.type) {
    case 'agent': return { kind: 'agent', model: node.agentConfig?.model || undefined };
    case 'human': return { kind: 'human' };
    default: return { kind: 'engine' };
  }
}

/** Fills in what the facts of a pass say: actor, status, action, duration. */
function describe(pass: Pass, promptVersions: ReadonlyMap<string, string>): void {
  const { entry, node } = pass;
  const facts = entry.facts;
  let status: TrailStatus = pass.open ? 'running' : 'completed';
  let waited = false;
  let doneAt: number | undefined;
  let agentDurationMs: number | undefined;
  let promptHash: string | undefined;
  let attempts = 0;
  const actor: TrailActor = { ...actorOf(node) };
  const tasks = new Set<string>();

  for (const fact of facts) {
    const details = fact.details ?? {};
    const taskId = text(details.externalTaskId);
    if (taskId) tasks.add(taskId);
    if (WAITS.has(fact.eventType)) waited = true;
    if (fact.eventType === 'TASK_CREATED') {
      if (pass.open) status = 'waiting';
      if (actor.kind === 'engine') actor.kind = 'human';
    }
    if (fact.eventType === 'TASK_CLAIMED' || fact.eventType === 'TASK_ASSIGNED') {
      actor.name = text(details.assignee) ?? actor.name;
      if (pass.open) status = 'running';
    }
    if (fact.eventType === 'EXTERNAL_TASK_LOCKED') {
      if (actor.kind === 'engine') actor.kind = 'worker';
      if (actor.kind === 'worker') actor.name = text(details.workerId) ?? actor.name;
      if (pass.open) status = 'running';
    }
    if (fact.eventType === 'INCIDENT_RETRIED' && pass.open) status = 'running';
    if (FAILS.has(fact.eventType)) {
      attempts += fact.eventType === 'EXTERNAL_TASK_FAILED' ? 1 : 0;
      // A failure with attempts left runs again; the last one leaves the step failed until retried.
      const retries = num(details.retries);
      if (pass.open && !(retries !== undefined && retries > 0)) status = 'failed';
      doneAt = time(fact.occurredAt);
    }
    if (DONE.has(fact.eventType)) doneAt = time(fact.occurredAt);
    if (fact.eventType === 'TASK_COMPLETED') {
      actor.name = fact.actor || actor.name;
      entry.outcome = text(details.outcome) ?? entry.outcome;
      if (details.commented === true) entry.commentLength = num(details.commentLength) ?? 0;
    }
    if (fact.eventType === 'DECISION_TABLE_APPLIED' && Array.isArray(details.matchedRuleIndexes)) {
      entry.matchedRules = (details.matchedRuleIndexes as unknown[])
        .filter((index): index is number => typeof index === 'number').map((index) => index + 1);
      entry.decision = decisionOf(fact, node) ?? undefined;
    }
    const agent = details.agent as Record<string, unknown> | undefined;
    if (agent && typeof agent === 'object') {
      actor.model = text(agent.model) ?? actor.model;
      promptHash = text(agent.promptHash) ?? promptHash;
      agentDurationMs = num(agent.durationMs) ?? agentDurationMs;
    }
    if (fact.eventType === 'FLOW_TAKEN' && flowOf(fact)?.from === entry.nodeId) {
      doneAt = doneAt ?? time(fact.occurredAt);
    }
  }

  entry.externalTaskIds = [...tasks];
  if (actor.kind === 'agent') {
    const version = entry.externalTaskIds.map((id) => promptVersions.get(id)).find(Boolean);
    actor.prompt = promptLabel(version, promptHash);
  }
  entry.actor = actor;
  entry.status = status;
  if (agentDurationMs !== undefined && !pass.open) entry.durationMs = agentDurationMs;
  else if (waited && doneAt !== undefined && doneAt >= time(entry.at)) {
    // From the token's arrival to the fact that ended the pass.
    entry.durationMs = doneAt - time(entry.at);
  }
  entry.action = actionOf(entry, node, attempts);
}

function actionOf(entry: NodeTrailEntry, node: WorkflowNode | undefined, attempts: number): string {
  const { status, actor } = entry;
  if (node?.type === 'event' && node.subtype === 'end') return 'Reached the end';
  if (status === 'failed') return attempts > 1 ? `Failed after ${attempts} attempts` : 'Failed';
  if (node?.type === 'gateway') return status === 'completed' ? 'Routed the token' : 'Waiting for the other branches';
  if (entry.matchedRules) {
    if (entry.matchedRules.length > 0 && entry.decision?.rules.every((rule) => rule.otherwise)) {
      return `Applied the fallback (rule #${entry.matchedRules[0]})`;
    }
    return entry.matchedRules.length === 0 ? 'No rule matched'
      : `Applied rule${entry.matchedRules.length > 1 ? 's' : ''} ${entry.matchedRules.map((rule) => `#${rule}`).join(', ')}`;
  }
  if (actor.kind === 'human') {
    // The decision is recorded just before the token leaves: it is the story even while the token is still here.
    if (status === 'completed' || entry.facts.some((fact) => fact.eventType === 'TASK_COMPLETED')) {
      return entry.outcome ? `Decided ${entry.outcome}` : 'Completed the task';
    }
    return actor.name ? `Working on the task` : 'Waiting for a person';
  }
  if (actor.kind === 'agent' || actor.kind === 'worker') {
    if (status === 'completed') return 'Completed';
    return entry.facts.some((fact) => fact.eventType === 'EXTERNAL_TASK_LOCKED') ? 'Working' : 'Waiting for a worker';
  }
  return status === 'completed' ? 'Ran' : 'Running';
}

/**
 * Builds the trail from the history shown so far, in playback order.
 * `promptVersions` maps an external task to the prompt version the
 * agent-step journal reported for it (often none).
 */
export function buildAuditTrail(
  history: readonly ActivityHistoryDTO[],
  workflow: WorkflowFile | null | undefined,
  promptVersions: ReadonlyMap<string, string> = new Map(),
): TrailEntry[] {
  const nodes = new Map((workflow?.nodes ?? []).map((node) => [node.id, node]));
  const entries: TrailEntry[] = [];
  const passes: Pass[] = [];
  /** The latest pass through each node: facts at the node join it. */
  const latest = new Map<string, Pass>();

  const openPass = (nodeId: string, first: ActivityHistoryDTO): Pass => {
    const node = nodes.get(nodeId);
    const entry: NodeTrailEntry = {
      kind: 'node', id: first.id, at: first.occurredAt, facts: [], nodeId,
      title: node?.title || humanize(nodeId), nodeType: node?.type, actor: actorOf(node),
      status: 'running', action: '', externalTaskIds: [],
    };
    const pass: Pass = { entry, node, open: true };
    passes.push(pass);
    latest.set(nodeId, pass);
    entries.push(entry);
    return pass;
  };

  for (const fact of history) {
    if (fact.eventType === 'FLOW_TAKEN') {
      const flow = flowOf(fact);
      if (!flow) continue;
      const leaving = latest.get(flow.from);
      if (leaving) {
        leaving.entry.facts.push(fact);
        const route = routeText(flow);
        const target = nodes.get(flow.to)?.title || humanize(flow.to);
        const exit = route ? `→ ${target} (${route})` : `→ ${target}`;
        // A split leaves by several flows at once: list them all.
        leaving.entry.exit = leaving.open || !leaving.entry.exit ? exit : `${leaving.entry.exit}, ${exit}`;
        leaving.open = false;
      }
      const arriving = latest.get(flow.to);
      // A join collects the tokens of its branches in one pass.
      if (arriving?.open) arriving.entry.facts.push(fact);
      else openPass(flow.to, fact).entry.facts.push(fact);
      const target = nodes.get(flow.to);
      if (target?.type === 'event' && target.subtype === 'end') latest.get(flow.to)!.open = false;
      continue;
    }
    const pass = fact.activityId ? latest.get(fact.activityId) : undefined;
    if (pass && fact.eventType !== 'PROCESS_STARTED') {
      pass.entry.facts.push(fact);
      if (fact.eventType === 'INCIDENT_RETRIED') pass.open = true;
      continue;
    }
    const meta = eventMeta(fact.eventType);
    entries.push({
      kind: 'instance', id: fact.id, at: fact.occurredAt, facts: [fact],
      nodeId: fact.eventType === 'PROCESS_STARTED' ? undefined : fact.activityId,
      action: fact.eventType === 'PROCESS_STARTED' ? 'Instance started' : meta.label,
      actorName: fact.actor || 'system',
      tone: meta.tone,
    });
  }

  passes.forEach((pass) => describe(pass, promptVersions));
  return entries;
}
