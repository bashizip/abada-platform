import type { WorkflowEdge, WorkflowFile, WorkflowNode } from '@/types';
import type { ActivityHistoryDTO, FlowTakenDTO } from '@/api/engine';
import { isOutcomeRouteEdge } from '@/lib/apl/routes';
import { cleanEdgeLabel } from '@/lib/layout/edgeGeometry';
import type { NodeRunStatus } from '@/lib/run/liveRun';

/**
 * Where the instance is now, per node: a token running there, a human task
 * waiting there, an incident stopping it there, or the end it finished at.
 */
export type NowState = 'running' | 'waiting' | 'incident' | 'ended';

/** The three layers the canvas draws for an instance: what ran, where it is now, what never ran. */
export interface PathView {
  /**
   * `recorded`: rebuilt from the flows the engine recorded (FLOW_TAKEN, 1.2+).
   * `reconstructed`: some or all of the history predates the upgrade, so the
   * path is inferred from the activities it touched.
   */
  source: 'recorded' | 'reconstructed';
  /** 1-based visit numbers of every node the path entered, in order ("2, 5, 8"). */
  visits: Record<string, number[]>;
  /** How many times each taken edge was traversed. */
  edgeCounts: Record<string, number>;
  /** Where the instance is now. */
  now: Record<string, NowState>;
  /** Joins on the path: branches arrived over branches expected (2/2). */
  joins: Record<string, { arrived: number; expected: number }>;
  /** Delegations and for-each steps on the path: child results. */
  children: Record<string, { ok: number; failed: number }>;
  /** Why an unreached node was not reached, when the path says it ("the else branch was taken at …"). */
  notReached: Record<string, string>;
  /** For decision nodes on the path: the branches they took, as read on the diagram. */
  decided: Record<string, string[]>;
}

/** The flows the engine recorded, in the order they were taken. */
export function recordedFlows(history: ActivityHistoryDTO[]): FlowTakenDTO[] {
  return history
    .filter((event) => event.eventType === 'FLOW_TAKEN')
    .map((event) => event.flow ?? (event.details?.flow as FlowTakenDTO | undefined))
    .filter((flow): flow is FlowTakenDTO => !!flow && typeof flow.from === 'string' && typeof flow.to === 'string');
}

/** The canvas label of the route edge a recorded route stands for. */
function routeLabel(route: NonNullable<FlowTakenDTO['route']>): string | undefined {
  switch (route.kind) {
    case 'OUTCOME': return `outcome: ${route.code ?? ''}`;
    case 'ROUTE': return `route: ${route.code ?? ''}`;
    case 'ERROR': return route.code ? `on_error: ${route.code}` : 'on_error';
    case 'TIMEOUT': return 'on_timeout';
    case 'LOW_CONFIDENCE': return 'on_low_confidence';
    case 'INVALID_OUTPUT': return 'on_invalid_output';
    case 'LOOP_EXHAUSTED': return 'on_exhausted';
    default: return undefined;
  }
}

/**
 * The diagram edge a recorded flow took. Canvas edge ids are the Studio's own,
 * so a flow is matched by its endpoints; between the same two nodes, the
 * recorded route (outcome, error code…) picks the route edge, and a flow
 * without one is the normal successor.
 */
export function edgeOfFlow(edges: WorkflowEdge[], flow: FlowTakenDTO): WorkflowEdge | undefined {
  const candidates = edges.filter((edge) => edge.source === flow.from && edge.target === flow.to);
  if (candidates.length <= 1) return candidates[0];
  if (flow.route) {
    const label = routeLabel(flow.route);
    const exact = candidates.find((edge) => edge.label === label);
    if (exact) return exact;
    // An error code caught by a code-less on_error.
    if (flow.route.kind === 'ERROR') {
      const catchAll = candidates.find((edge) => edge.label === 'on_error');
      if (catchAll) return catchAll;
    }
    return candidates.find(isOutcomeRouteEdge) ?? candidates[0];
  }
  return candidates.find((edge) => !isOutcomeRouteEdge(edge)) ?? candidates[0];
}

const isDecisionNode = (node: WorkflowNode | undefined) =>
  !!node && ((node.type === 'gateway' && node.subtype !== 'parallel') || node.type === 'agent' || node.type === 'human'
    || node.type === 'dmn');

/** An edge label as read on a path: a condition without its `if `, a route without its prefix. */
export function pathLabel(label: string | undefined): string {
  return cleanEdgeLabel(label?.startsWith('if ') ? label.slice(3) : label);
}

/** How a taken branch reads in a sentence: `the else branch`, `“score ≥ 750”`, `outcome “reject”`. */
export function branchPhrase(edge: WorkflowEdge): string {
  const label = edge.label ?? '';
  if (!label) return 'another branch';
  if (label === 'else') return 'the else branch';
  if (label.startsWith('if ')) return `“${pathLabel(label)}”`;
  if (label.startsWith('outcome:')) return `outcome “${pathLabel(label)}”`;
  if (label.startsWith('route:')) return `route “${pathLabel(label)}”`;
  return `the ${pathLabel(label)} route`;
}

export interface PathFacts {
  /** The node the instance entered first (its start event). */
  entry?: string;
  /** Diagram edges taken, in order. */
  steps: { edge: WorkflowEdge }[];
  /** Nodes touched by history whose entry is not in the steps (reconstructed paths only). */
  touchedOrder?: string[];
  statuses: Record<string, NodeRunStatus>;
  activeNodeIds: string[];
  incidentNodeIds: string[];
  /** The instance status (COMPLETED, ACTIVE, FAILED, CANCELLED). */
  status: string;
  source: PathView['source'];
  history?: ActivityHistoryDTO[];
}

/** Builds the three-layer view from the edges the path took. */
export function buildPathView(workflow: WorkflowFile, facts: PathFacts): PathView {
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const visits: Record<string, number[]> = {};
  const edgeCounts: Record<string, number> = {};
  let order = 0;
  const visit = (nodeId: string | undefined) => {
    if (!nodeId || !nodes.has(nodeId)) return;
    (visits[nodeId] ??= []).push(++order);
  };
  visit(facts.entry);
  facts.touchedOrder?.forEach((nodeId) => { if (!visits[nodeId]) visit(nodeId); });
  for (const { edge } of facts.steps) {
    edgeCounts[edge.id] = (edgeCounts[edge.id] ?? 0) + 1;
    // A reconstructed path has its touched nodes numbered already.
    if (facts.source === 'recorded' || !visits[edge.target]) visit(edge.target);
  }

  const now: Record<string, NowState> = {};
  const incidents = new Set(facts.incidentNodeIds);
  for (const nodeId of facts.activeNodeIds) {
    const node = nodes.get(nodeId);
    if (!node) continue;
    now[nodeId] = incidents.has(nodeId) || facts.statuses[nodeId] === 'failed' ? 'incident'
      : node.type === 'human' ? 'waiting' : 'running';
  }
  incidents.forEach((nodeId) => { if (nodes.has(nodeId)) now[nodeId] = 'incident'; });
  const status = facts.status.toUpperCase();
  if (status === 'COMPLETED') {
    workflow.nodes.filter((node) => node.type === 'event' && node.subtype === 'end' && visits[node.id])
      .forEach((node) => { now[node.id] = 'ended'; });
  }

  const taken = new Set(Object.keys(edgeCounts));
  const incoming = (nodeId: string) => workflow.edges.filter((edge) => edge.target === nodeId);

  const joins: PathView['joins'] = {};
  for (const node of workflow.nodes) {
    if (node.type !== 'gateway' || (node.subtype !== 'parallel' && node.subtype !== 'inclusive')) continue;
    const into = incoming(node.id);
    if (into.length < 2 || !visits[node.id]) continue;
    const arrived = into.filter((edge) => taken.has(edge.id)).length;
    const fired = workflow.edges.some((edge) => edge.source === node.id && taken.has(edge.id));
    joins[node.id] = { arrived, expected: node.subtype === 'inclusive' && fired ? arrived : into.length };
  }

  const decided: PathView['decided'] = {};
  for (const edge of workflow.edges) {
    if (!taken.has(edge.id) || !isDecisionNode(nodes.get(edge.source))) continue;
    const siblings = workflow.edges.filter((other) => other.source === edge.source);
    if (siblings.length < 2) continue;
    const branches = (decided[edge.source] ??= []);
    if (!branches.includes(branchPhrase(edge))) branches.push(branchPhrase(edge));
  }

  const children: PathView['children'] = {};
  for (const event of facts.history ?? []) {
    if (!event.activityId || !visits[event.activityId]) continue;
    const tally = () => (children[event.activityId!] ??= { ok: 0, failed: 0 });
    if (event.eventType === 'FOR_EACH_ITEM_DONE') {
      if (event.details?.ok === false) tally().failed += 1; else tally().ok += 1;
    } else if (event.eventType === 'CHILD_COMPLETED') {
      tally().ok += 1;
    } else if (event.eventType === 'CHILD_FAILED') {
      tally().failed += 1;
    }
  }

  const running = status === 'ACTIVE' || status === 'RUNNING';
  const notReached: PathView['notReached'] = {};
  for (const node of workflow.nodes) {
    if (visits[node.id]) continue;
    notReached[node.id] = notReachedReason(workflow, node.id, visits, taken, now, running, nodes);
  }

  return { source: facts.source, visits, edgeCounts, now, joins, children, notReached, decided };
}

/**
 * Walks back from an unreached node to the nearest step the path did reach,
 * and says what happened there instead.
 */
function notReachedReason(
  workflow: WorkflowFile,
  nodeId: string,
  visits: Record<string, number[]>,
  taken: Set<string>,
  now: Record<string, NowState>,
  running: boolean,
  nodes: Map<string, WorkflowNode>,
): string {
  const seen = new Set<string>([nodeId]);
  let frontier = [nodeId];
  for (let depth = 0; depth < 50 && frontier.length; depth++) {
    const next: string[] = [];
    // The nearest steps the path reached; a token still there outranks a branch taken elsewhere.
    const reached: WorkflowEdge[] = [];
    for (const current of frontier) {
      for (const edge of workflow.edges.filter((candidate) => candidate.target === current)) {
        if (visits[edge.source]) reached.push(edge);
        else if (!seen.has(edge.source)) {
          seen.add(edge.source);
          next.push(edge.source);
        }
      }
    }
    const atNow = reached.find((edge) => now[edge.source] && now[edge.source] !== 'ended');
    if (atNow) {
      const title = nodes.get(atNow.source)?.title || atNow.source;
      return running ? `Not reached yet — the instance is at ${title}` : `Not reached — the instance stopped at ${title}`;
    }
    for (const edge of reached) {
      const instead = workflow.edges.filter((other) => other.source === edge.source && taken.has(other.id));
      if (instead.length > 0 && !taken.has(edge.id)) {
        const title = nodes.get(edge.source)?.title || edge.source;
        return `Not reached — ${instead.map(branchPhrase).join(' and ')} was taken at ${title}`;
      }
    }
    if (reached.length > 0) return running ? 'Not reached yet' : 'Not reached';
    frontier = next;
  }
  return running ? 'Not reached yet' : 'Not reached';
}
