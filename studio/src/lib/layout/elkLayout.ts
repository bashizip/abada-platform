import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from 'elkjs/lib/elk-api';
import type { WorkflowEdge, WorkflowNode } from '@/types';
import {
  type FlowDirection,
  type Point,
  flowSides,
  outcomePortPoint,
  outcomeSide,
  outsideLabelSize,
  sidePoint,
  sizeOf,
} from './nodeGeometry';
import {
  type EdgeRoute,
  cleanEdgeLabel,
  edgeKindOf,
  estimateLabelSize,
  inferDirection,
  isOutcomeKind,
  outcomeSlots,
  truncateLabel,
} from './edgeGeometry';
import { modelOrder } from './graphOrder';

/**
 * Auto-layout for the Studio canvas, built on ELK's `layered` algorithm
 * (Sugiyama-style: cycle breaking → layering → crossing minimisation → node
 * placement → orthogonal edge routing).
 *
 * - `horizontal` / `vertical`: full layout, flow left → right or top → bottom.
 * - `tidy`: keeps the author's arrangement (layers and order come from the
 *   current positions) and only straightens, spaces and re-routes it.
 *
 * The result is deterministic: nodes are fed in the reverse post-order of a
 * depth-first walk from the start event, so the same process always gets the
 * same picture, and loops (edges back to an earlier node) are exactly the
 * depth-first back edges.
 */
export type LayoutMode = 'horizontal' | 'vertical' | 'tidy';

export const LAYOUT_MODES: LayoutMode[] = ['horizontal', 'vertical', 'tidy'];

export type { EdgeRoute };

export interface LayoutResult {
  direction: FlowDirection;
  /** Top-left position of each node. */
  positions: Map<string, Point>;
  /** Orthogonal route for each edge, valid for `positions`. */
  routes: Map<string, EdgeRoute>;
}

/** The part of the ELK API the layout uses; injectable for tests. */
export interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
  terminateWorker?(): void;
}

export const LAYOUT_TIMEOUT_MS = 5000;

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

async function createWorkerEngine(): Promise<LayoutEngine> {
  // Loaded on demand and run in a Web Worker: ELK stays out of the main bundle
  // and never blocks the UI thread.
  const [{ default: ELK }, { default: workerUrl }] = await Promise.all([
    import('elkjs/lib/elk-api.js'),
    import('elkjs/lib/elk-worker.min.js?url'),
  ]);
  return new ELK({ workerUrl });
}

let engineFactory: () => Promise<LayoutEngine> = createWorkerEngine;
let enginePromise: Promise<LayoutEngine> | null = null;

/** Replaces the engine (tests use the synchronous bundled build). Pass null to restore. */
export function setLayoutEngineFactory(factory: (() => Promise<LayoutEngine>) | null): void {
  enginePromise?.then((engine) => engine.terminateWorker?.()).catch(() => undefined);
  enginePromise = null;
  engineFactory = factory ?? createWorkerEngine;
}

function getEngine(): Promise<LayoutEngine> {
  if (!enginePromise) {
    enginePromise = engineFactory().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

async function runWithTimeout(graph: ElkNode): Promise<ElkNode> {
  const engine = await getEngine();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // A runaway layout would keep the worker busy for every later request.
      engine.terminateWorker?.();
      enginePromise = null;
      reject(new Error(`Auto-layout took longer than ${LAYOUT_TIMEOUT_MS / 1000}s`));
    }, LAYOUT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([engine.layout(graph), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Graph construction                                                  */
/* ------------------------------------------------------------------ */

const ELK_SIDE = { left: 'WEST', right: 'EAST', top: 'NORTH', bottom: 'SOUTH' } as const;

const inPort = (id: string) => `${id}::in`;
const outPort = (id: string) => `${id}::out`;
const outcomePort = (id: string, index: number) => `${id}::outcome${index}`;

const BASE_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.layered.nodePlacement.bk.edgeStraightening': 'IMPROVE_STRAIGHTNESS',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'TAIL_LAYER',
  'elk.layered.mergeEdges': 'false',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.spacing.edgeNode': '20',
  'elk.layered.spacing.edgeNodeBetweenLayers': '20',
  'elk.spacing.edgeEdge': '14',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
  'elk.spacing.edgeLabel': '4',
  'elk.spacing.labelNode': '6',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
};

const TIDY_OPTIONS: LayoutOptions = {
  'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
  'elk.layered.layering.strategy': 'INTERACTIVE',
  // Semi-interactive: the author's vertical order constrains the sweep, but
  // edge dummies are still placed to avoid crossings.
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  'elk.layered.considerModelOrder.strategy': 'NONE',
};

export function buildElkGraph(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  mode: LayoutMode,
  direction: FlowDirection,
): ElkNode {
  const sides = flowSides(direction);
  const slots = outcomeSlots(edges);
  const outcomeCount = new Map<string, number>();
  for (const [edgeId, slot] of slots) {
    const edge = edges.find((e) => e.id === edgeId)!;
    outcomeCount.set(edge.source, slot.count);
  }
  const nodeIds = new Set(nodes.map((node) => node.id));

  const children: ElkNode[] = modelOrder(nodes, edges).map((node) => {
    const size = sizeOf(node);
    const port = (id: string, side: keyof typeof ELK_SIDE, at: Point): ElkPort => ({
      id,
      x: at.x,
      y: at.y,
      width: 0,
      height: 0,
      layoutOptions: { 'elk.port.side': ELK_SIDE[side] },
    });
    const ports: ElkPort[] = [
      port(inPort(node.id), sides.in, sidePoint(size, sides.in)),
      port(outPort(node.id), sides.out, sidePoint(size, sides.out)),
    ];
    const count = outcomeCount.get(node.id) ?? 0;
    for (let i = 0; i < count; i++) {
      ports.push(port(outcomePort(node.id, i), outcomeSide(direction), outcomePortPoint(size, direction, i, count)));
    }
    const label = outsideLabelSize(node);
    return {
      id: node.id,
      width: size.width,
      height: size.height,
      ...(mode === 'tidy' ? { x: node.x, y: node.y } : {}),
      ports,
      labels: label ? [{ id: `${node.id}::label`, text: node.title, width: label.width, height: label.height }] : [],
      layoutOptions: {
        'elk.portConstraints': 'FIXED_POS',
        'elk.nodeLabels.placement': direction === 'vertical'
          ? 'OUTSIDE V_CENTER H_RIGHT'
          : 'OUTSIDE V_BOTTOM H_CENTER',
        // Tidy: semi-interactive crossing minimisation reads the order from here.
        ...(mode === 'tidy' ? { 'elk.position': `(${node.x},${node.y})` } : {}),
      },
    };
  });

  const elkEdges: ElkExtendedEdge[] = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => {
      const kind = edgeKindOf(edge);
      const slot = slots.get(edge.id);
      const text = truncateLabel(cleanEdgeLabel(edge.label));
      const labelSize = text ? estimateLabelSize(text) : null;
      return {
        id: edge.id,
        sources: [slot ? outcomePort(edge.source, slot.index) : outPort(edge.source)],
        targets: [inPort(edge.target)],
        labels: labelSize ? [{ id: `${edge.id}::label`, text, ...labelSize }] : [],
        layoutOptions: {
          // Keep the happy path straight; outcome routes bend around it.
          'elk.layered.priority.straightness': isOutcomeKind(kind) ? '0' : '10',
          'elk.edgeLabels.placement': 'CENTER',
        },
      };
    });

  return {
    id: 'root',
    layoutOptions: {
      ...BASE_OPTIONS,
      'elk.direction': direction === 'vertical' ? 'DOWN' : 'RIGHT',
      ...(mode === 'tidy' ? TIDY_OPTIONS : {}),
    },
    children,
    edges: elkEdges,
  };
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function directionForMode(mode: LayoutMode, nodes: WorkflowNode[], edges: WorkflowEdge[]): FlowDirection {
  if (mode === 'vertical') return 'vertical';
  if (mode === 'horizontal') return 'horizontal';
  return inferDirection(nodes, edges);
}

export async function computeLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  mode: LayoutMode,
): Promise<LayoutResult> {
  const direction = directionForMode(mode, nodes, edges);
  if (nodes.length === 0) return { direction, positions: new Map(), routes: new Map() };

  const graph = await runWithTimeout(buildElkGraph(nodes, edges, mode, direction));

  // Tidy keeps the diagram where the author had it instead of snapping it to the origin.
  let offset: Point = { x: 0, y: 0 };
  if (mode === 'tidy') {
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const laidMinX = Math.min(...(graph.children ?? []).map((c) => c.x ?? 0));
    const laidMinY = Math.min(...(graph.children ?? []).map((c) => c.y ?? 0));
    offset = { x: Math.round(minX - laidMinX), y: Math.round(minY - laidMinY) };
  }
  const move = (p: { x: number; y: number }): Point => ({ x: p.x + offset.x, y: p.y + offset.y });

  const positions = new Map<string, Point>();
  for (const child of graph.children ?? []) {
    positions.set(child.id, { x: Math.round((child.x ?? 0) + offset.x), y: Math.round((child.y ?? 0) + offset.y) });
  }

  const routes = new Map<string, EdgeRoute>();
  for (const edge of (graph.edges ?? []) as ElkExtendedEdge[]) {
    const section = edge.sections?.[0];
    if (!section) continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(move);
    const label = edge.labels?.[0];
    routes.set(edge.id, {
      points,
      label: label && label.x !== undefined && label.y !== undefined
        ? move({ x: label.x + (label.width ?? 0) / 2, y: label.y + (label.height ?? 0) / 2 })
        : undefined,
    });
  }
  return { direction, positions, routes };
}

/** Applies layout positions to workflow nodes (nodes missing from the result keep theirs). */
export function applyPositions(nodes: WorkflowNode[], positions: Map<string, Point>): WorkflowNode[] {
  return nodes.map((node) => {
    const p = positions.get(node.id);
    return p ? { ...node, x: p.x, y: p.y } : node;
  });
}

/** True when every node sits (within `tolerance` px) where the layout would put it. */
export function matchesPositions(nodes: WorkflowNode[], positions: Map<string, Point>, tolerance = 1): boolean {
  if (nodes.length !== positions.size) return false;
  return nodes.every((node) => {
    const p = positions.get(node.id);
    return !!p && Math.abs(p.x - node.x) <= tolerance && Math.abs(p.y - node.y) <= tolerance;
  });
}
