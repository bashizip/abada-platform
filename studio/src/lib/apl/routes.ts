import type { OnErrorRoute, ReviewOutcome, WorkflowEdge, WorkflowFile, WorkflowNode } from '@/types';

/**
 * Routes of a step: where it goes besides its normal `next`. The node config
 * (`onError`, `onTimeout`, `outcomes`, `loop`, …) is the source of truth that
 * saving writes to APL; the canvas edges labelled `on_*` / `outcome: <name>`
 * are always derived from it here, so editing a route in the inspector, from
 * the connect menu or by deleting its edge keeps both in step.
 */
export type Route =
  | { kind: 'next' }
  | { kind: 'error'; code?: string }
  | { kind: 'timeout'; after: string }
  | { kind: 'low_confidence' }
  | { kind: 'invalid_output' }
  | { kind: 'outcome'; name: string }
  | { kind: 'exhausted' };

/** Route edges are labelled `on_*` (boundaries, loop exhaustion) or `outcome: <name>` (review decisions). */
export const isOutcomeRouteEdge = (edge: { label?: string }): boolean =>
  typeof edge.label === 'string' && (edge.label.startsWith('on_') || edge.label.startsWith('outcome:'));

/** ISO-8601 durations the engine accepts for `on_timeout.after` (PT1S–P365D, no months or years). */
const DURATION = /^P(?!$)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

/** Why `after` is not a timeout the engine accepts, or null. */
export function timeoutError(after: string): string | null {
  const value = after.trim().toUpperCase();
  if (!DURATION.test(value)) return 'Use an ISO-8601 duration such as PT30M, PT4H or P2D.';
  const seconds = durationSeconds(value);
  if (seconds < 1 || seconds > 365 * 86_400) return 'The timeout must be between 1 second and 365 days.';
  return null;
}

function durationSeconds(value: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match) return 0;
  const [, d, h, m, s] = match;
  return Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

/** Outcome names the engine accepts. */
export const OUTCOME_NAME = /^[a-z][a-z0-9_]{0,31}$/;

const isTask = (node: WorkflowNode) => node.type === 'agent' || node.type === 'engine-task' || node.type === 'human';

const errorRouteOf = (node: WorkflowNode): OnErrorRoute | undefined =>
  node.type === 'agent' ? node.agentConfig?.onError
    : node.type === 'engine-task' ? node.engineTaskConfig?.onError
      : node.type === 'human' ? node.humanConfig?.onError : undefined;

const timeoutOf = (node: WorkflowNode) =>
  node.type === 'agent' ? node.agentConfig?.onTimeout
    : node.type === 'engine-task' ? node.engineTaskConfig?.onTimeout
      : node.type === 'human' ? node.humanConfig?.onTimeout : undefined;

/** The route edges a node's config implies, in a stable order with stable ids. */
export function routeEdges(node: WorkflowNode): WorkflowEdge[] {
  const routes: { target: string; label: string }[] = [];
  Object.entries(node.type === 'human' ? node.humanConfig?.outcomes ?? {} : {}).forEach(([name, outcome]) => {
    if (outcome?.next) routes.push({ target: outcome.next, label: `outcome: ${name}` });
  });
  if (node.type === 'agent') {
    if (node.agentConfig?.onLowConfidence) routes.push({ target: node.agentConfig.onLowConfidence, label: 'on_low_confidence' });
    if (node.agentConfig?.onInvalidOutput) routes.push({ target: node.agentConfig.onInvalidOutput, label: 'on_invalid_output' });
  }
  const onError = errorRouteOf(node);
  if (typeof onError === 'string' && onError) {
    routes.push({ target: onError, label: 'on_error' });
  } else if (Array.isArray(onError)) {
    onError.forEach((rule) => {
      if (rule?.then) routes.push({ target: rule.then, label: rule.code ? `on_error: ${rule.code}` : 'on_error' });
    });
  }
  const timeout = timeoutOf(node);
  if (timeout?.then) routes.push({ target: timeout.then, label: 'on_timeout' });
  const edges = routes.map((route, index) => ({
    id: `e_${node.id}_${route.target}_${route.label.replace(/[^a-z_]/gi, '')}_${index}`,
    source: node.id,
    target: route.target,
    label: route.label,
  }));
  if (node.loop?.onExhausted) {
    edges.push({
      id: `e_${node.id}_${node.loop.onExhausted}_on_exhausted`,
      source: node.id,
      target: node.loop.onExhausted,
      label: 'on_exhausted',
    });
  }
  return edges;
}

/** Replaces every route edge with the ones the nodes' config implies; next and gateway edges are kept. */
export function syncRouteEdges(workflow: WorkflowFile): WorkflowFile {
  return {
    ...workflow,
    edges: [
      ...workflow.edges.filter((edge) => !isOutcomeRouteEdge(edge)),
      ...workflow.nodes.flatMap(routeEdges),
    ],
  };
}

/** The routes a connection from this node can take, for the connect menu. */
export function routesFor(node: WorkflowNode): Route[] {
  if (!isTask(node)) return [{ kind: 'next' }];
  const routes: Route[] = [];
  const outcomes = node.type === 'human' ? Object.keys(node.humanConfig?.outcomes ?? {}) : [];
  if (outcomes.length > 0) outcomes.forEach((name) => routes.push({ kind: 'outcome', name }));
  else routes.push({ kind: 'next' });
  routes.push({ kind: 'error' }, { kind: 'timeout', after: 'PT1H' });
  if (node.type === 'agent') routes.push({ kind: 'low_confidence' }, { kind: 'invalid_output' });
  if (node.loop) routes.push({ kind: 'exhausted' });
  return routes;
}

export function routeLabel(route: Route): string {
  switch (route.kind) {
    case 'next': return 'Next step';
    case 'error': return route.code ? `On error ${route.code}` : 'On error';
    case 'timeout': return 'On timeout…';
    case 'low_confidence': return 'Low confidence';
    case 'invalid_output': return 'Invalid output';
    case 'outcome': return `Outcome: ${route.name.replace(/_/g, ' ')}`;
    case 'exhausted': return 'Loop limit reached';
  }
}

/** The route an edge stands for. */
export function routeOfEdge(edge: WorkflowEdge): Route {
  const label = edge.label ?? '';
  if (label === 'on_low_confidence') return { kind: 'low_confidence' };
  if (label === 'on_invalid_output') return { kind: 'invalid_output' };
  if (label === 'on_timeout') return { kind: 'timeout', after: '' };
  if (label === 'on_exhausted') return { kind: 'exhausted' };
  if (label.startsWith('on_error')) {
    const code = label.startsWith('on_error:') ? label.slice('on_error:'.length).trim() : undefined;
    return { kind: 'error', ...(code ? { code } : {}) };
  }
  if (label.startsWith('outcome:')) return { kind: 'outcome', name: label.slice('outcome:'.length).trim() };
  return { kind: 'next' };
}

/**
 * Points one route of a node at `target`, or removes it with `null`, then
 * re-derives the route edges. `next` replaces the step's normal successor
 * (gateways keep several). An outcome removed this way is dropped.
 */
export function setRoute(workflow: WorkflowFile, nodeId: string, route: Route, target: string | null): WorkflowFile {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return workflow;
  if (route.kind === 'next') {
    const gateway = node.type === 'gateway';
    const kept = workflow.edges.filter((edge) => !(edge.source === nodeId && !isOutcomeRouteEdge(edge)
      && (!gateway || edge.target === target)));
    const edges = target ? [...kept, { id: `e-${nodeId}-${target}-${Date.now()}`, source: nodeId, target }] : kept;
    return { ...workflow, edges };
  }
  const updated = withRoute(node, route, target);
  return syncRouteEdges({
    ...workflow,
    nodes: workflow.nodes.map((candidate) => (candidate.id === nodeId ? updated : candidate)),
  });
}

function withRoute(node: WorkflowNode, route: Route, target: string | null): WorkflowNode {
  const value = target ?? undefined;
  switch (route.kind) {
    case 'low_confidence':
      return { ...node, agentConfig: node.agentConfig && { ...node.agentConfig, onLowConfidence: value } };
    case 'invalid_output':
      return { ...node, agentConfig: node.agentConfig && { ...node.agentConfig, onInvalidOutput: value } };
    case 'exhausted':
      return node.loop ? { ...node, loop: { ...node.loop, onExhausted: value } } : node;
    case 'timeout':
      return withConfig(node, { onTimeout: target ? { after: route.after, then: target } : undefined });
    case 'error':
      return withConfig(node, { onError: errorRouteWith(errorRouteOf(node), route.code, target) });
    case 'outcome': {
      if (node.type !== 'human' || !node.humanConfig) return node;
      const outcomes = { ...(node.humanConfig.outcomes ?? {}) };
      if (target) outcomes[route.name] = { ...(outcomes[route.name] ?? {}), next: target };
      else delete outcomes[route.name];
      return { ...node, humanConfig: { ...node.humanConfig, outcomes } };
    }
    default:
      return node;
  }
}

/** Sets `onError` / `onTimeout` on whichever config the node type carries. */
function withConfig(node: WorkflowNode, patch: { onError?: OnErrorRoute; onTimeout?: { after: string; then: string } }) {
  const key = Object.keys(patch)[0] as 'onError' | 'onTimeout';
  const value = patch[key];
  if (node.type === 'agent' && node.agentConfig) return { ...node, agentConfig: { ...node.agentConfig, [key]: value } };
  if (node.type === 'engine-task') {
    return { ...node, engineTaskConfig: { service: node.engineTaskConfig?.service ?? '', ...node.engineTaskConfig, [key]: value } };
  }
  if (node.type === 'human' && node.humanConfig) return { ...node, humanConfig: { ...node.humanConfig, [key]: value } };
  return node;
}

/** `on_error` with the rule for `code` (or the catch-all) pointed at `target`, or removed. */
function errorRouteWith(current: OnErrorRoute | undefined, code: string | undefined, target: string | null): OnErrorRoute | undefined {
  const rules = typeof current === 'string' ? [{ then: current }] : [...(current ?? [])];
  const index = rules.findIndex((rule) => (rule.code ?? undefined) === code);
  if (target) {
    const rule = code ? { code, then: target } : { then: target };
    if (index >= 0) rules[index] = rule; else rules.push(rule);
  } else if (index >= 0) {
    rules.splice(index, 1);
  }
  if (rules.length === 0) return undefined;
  // A single catch-all is written in the short form `on_error: <node>`.
  if (rules.length === 1 && !rules[0].code) return rules[0].then;
  // Code-specific rules first, the catch-all last, as the engine matches them.
  return [...rules.filter((rule) => rule.code), ...rules.filter((rule) => !rule.code)];
}

/** Deletes an edge: a route edge clears the config it came from; a next or gateway edge is removed. */
export function removeEdge(workflow: WorkflowFile, edgeId: string): WorkflowFile {
  const edge = workflow.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return workflow;
  if (!isOutcomeRouteEdge(edge)) return { ...workflow, edges: workflow.edges.filter((candidate) => candidate.id !== edgeId) };
  return setRoute(workflow, edge.source, routeOfEdge(edge), null);
}

/** Clears every route that points at a deleted node, so saving never writes a reference to it. */
export function dropNodeReferences(workflow: WorkflowFile, nodeId: string): WorkflowFile {
  const nodes = workflow.nodes.filter((node) => node.id !== nodeId).map((node) => {
    let updated = node;
    for (const edge of routeEdges(node)) {
      if (edge.target === nodeId) updated = withRoute(updated, routeOfEdge(edge), null);
    }
    return updated;
  });
  return syncRouteEdges({
    ...workflow,
    nodes,
    edges: workflow.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  });
}

/** Problems the engine would reject in a review's outcomes, or null. */
export function outcomesProblem(outcomes: Record<string, ReviewOutcome>): string | null {
  const names = Object.keys(outcomes);
  if (names.length < 2 || names.length > 6) return 'A review needs between 2 and 6 outcomes.';
  const bad = names.find((name) => !OUTCOME_NAME.test(name));
  if (bad) return `"${bad}" must be lowercase letters, digits and underscores, starting with a letter.`;
  const missing = names.find((name) => !outcomes[name]?.next);
  if (missing) return `Choose where "${missing}" leads.`;
  return null;
}

