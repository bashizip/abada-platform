import { useState } from 'react';
import type { PathView } from '@/lib/run/instancePath';

/**
 * What the last path update added (M5 S3): the edges taken once more and the
 * nodes entered once more. `seq` changes with every new arrival so the canvas
 * replays the one-shot animation even when the same edge is taken again (a loop).
 */
export interface PathArrivals {
  edges: ReadonlySet<string>;
  nodes: ReadonlySet<string>;
  seq: number;
}

const NONE: PathArrivals = { edges: new Set(), nodes: new Set(), seq: 0 };

export function pathArrivals(previous: PathView, next: PathView): { edges: Set<string>; nodes: Set<string> } {
  const edges = new Set(Object.keys(next.edgeCounts)
    .filter((edgeId) => next.edgeCounts[edgeId] > (previous.edgeCounts[edgeId] ?? 0)));
  const nodes = new Set(Object.keys(next.visits)
    .filter((nodeId) => next.visits[nodeId].length > (previous.visits[nodeId]?.length ?? 0)));
  return { edges, nodes };
}

/**
 * Arrivals between consecutive paths drawn by one canvas. The first path is
 * the state at opening: it arrives all at once, without animation.
 */
export function usePathArrivals(path: PathView | undefined, enabled: boolean): PathArrivals {
  const [state, setState] = useState<{ path: PathView | undefined; arrivals: PathArrivals }>({ path, arrivals: NONE });
  if (state.path === path) return state.arrivals;
  let arrivals = path ? state.arrivals : NONE;
  if (enabled && state.path && path && state.path.source === path.source) {
    const diff = pathArrivals(state.path, path);
    if (diff.edges.size > 0 || diff.nodes.size > 0) arrivals = { ...diff, seq: state.arrivals.seq + 1 };
  }
  setState({ path, arrivals });
  return arrivals;
}
