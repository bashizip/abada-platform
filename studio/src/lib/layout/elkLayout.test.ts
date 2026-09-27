import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';
import { INITIAL_WORKFLOWS } from '@/data/sampleWorkflows';
import type { WorkflowFile, WorkflowNode } from '@/types';
import {
  type LayoutMode,
  type LayoutResult,
  applyPositions,
  computeLayout,
  matchesPositions,
  setLayoutEngineFactory,
} from './elkLayout';
import { modelOrder } from './graphOrder';
import { edgeKindOf, isOutcomeKind, outcomeSlots } from './edgeGeometry';
import {
  type FlowDirection,
  type Point,
  type Rect,
  OUTSIDE_LABEL_GAP,
  flowSides,
  outcomePortPoint,
  outsideLabelSize,
  sidePoint,
  sizeOf,
} from './nodeGeometry';

import kitchenSink from '../../../../engine/src/test/resources/apl/kitchen-sink.apl.yaml?raw';
import parallelForkJoin from '../../../../engine/src/test/resources/apl/parallel-fork-join.apl.yaml?raw';
import eventGateway from '../../../../engine/src/test/resources/apl/event-gateway.apl.yaml?raw';
import inclusiveRouter from '../../../../engine/src/test/resources/apl/inclusive-router.apl.yaml?raw';
import conditionRouter from '../../../../engine/src/test/resources/apl/condition-router.apl.yaml?raw';
import agentContract from '../../../../engine/src/test/resources/apl/agent-contract.apl.yaml?raw';
import kycOnboarding from '../../../../examples/apl/kyc-onboarding.apl.yaml?raw';
import leadTriageDemo from '../../../../examples/apl/lead-triage-demo.apl.yaml?raw';

const apl = (source: string): WorkflowFile => aplToWorkflow(parseAPLYaml(source));

const LOOP_APL = `version: abada.io/v1
metadata: { key: loop, name: Review loop }
flow:
  entry: start
  nodes:
    - id: start
      type: webhook
      next: draft
    - id: draft
      type: agent
      description: Draft the contract
      next: review
      on_low_confidence: legal
    - id: review
      type: approval-gate
      description: Manager review
      next: decide
    - id: decide
      type: condition
      rules:
        - if: \${approved == true}
          then: send
        - else: true
          then: draft
    - id: legal
      type: approval-gate
      description: Legal escalation
      next: review
    - id: send
      type: engine-task
      service: mail.send
      next: done
    - id: done
      type: end
`;

const FIXTURES: Record<string, () => WorkflowFile> = {
  'kitchen-sink': () => apl(kitchenSink),
  'parallel-fork-join': () => apl(parallelForkJoin),
  'event-gateway': () => apl(eventGateway),
  'inclusive-router': () => apl(inclusiveRouter),
  'condition-router': () => apl(conditionRouter),
  'agent-contract': () => apl(agentContract),
  'kyc-onboarding': () => apl(kycOnboarding),
  'lead-triage-demo': () => apl(leadTriageDemo),
  loop: () => apl(LOOP_APL),
  ...Object.fromEntries(INITIAL_WORKFLOWS.map((wf) => [`sample:${wf.name}`, () => structuredClone(wf)])),
};

beforeAll(() => setLayoutEngineFactory(async () => new ELK()));
afterAll(() => setLayoutEngineFactory(null));

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function nodeRect(node: WorkflowNode, at: Point): Rect {
  return { x: at.x, y: at.y, ...sizeOf(node) };
}

/** Shape plus its outside label (events and gateways). */
function footprint(node: WorkflowNode, at: Point, direction: FlowDirection): Rect[] {
  const shape = nodeRect(node, at);
  const label = outsideLabelSize(node);
  if (!label) return [shape];
  const box = direction === 'vertical'
    ? { x: shape.x + shape.width + OUTSIDE_LABEL_GAP, y: shape.y + shape.height / 2 - label.height / 2, ...label }
    : { x: shape.x + shape.width / 2 - label.width / 2, y: shape.y + shape.height + OUTSIDE_LABEL_GAP, ...label };
  return [shape, box];
}

const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });

const close = (a: Point, b: Point) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;

async function layout(wf: WorkflowFile, mode: LayoutMode): Promise<LayoutResult> {
  return computeLayout(wf.nodes, wf.edges, mode);
}

/* ------------------------------------------------------------------ */
/* Invariants on every fixture                                         */
/* ------------------------------------------------------------------ */

describe.each(Object.keys(FIXTURES))('auto-layout of %s', (name) => {
  const wf = FIXTURES[name]();
  const byId = new Map(wf.nodes.map((node) => [node.id, node]));

  describe.each(['horizontal', 'vertical'] as const)('%s', (mode) => {
    it('is deterministic', async () => {
      const a = await layout(wf, mode);
      const b = await layout(wf, mode);
      expect([...b.positions]).toEqual([...a.positions]);
      expect([...b.routes]).toEqual([...a.routes]);
    });

    it('places every node, with no shapes or outside labels overlapping', async () => {
      const result = await layout(wf, mode);
      expect(result.positions.size).toBe(wf.nodes.length);
      const boxes = wf.nodes.map((node) => ({ id: node.id, rects: footprint(node, result.positions.get(node.id)!, result.direction) }));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const clash = boxes[i].rects.some((a) => boxes[j].rects.some((b) => overlap(a, b)));
          expect(clash, `${boxes[i].id} overlaps ${boxes[j].id}`).toBe(false);
        }
      }
    });

    it('routes every edge orthogonally from its source port to its target port', async () => {
      const result = await layout(wf, mode);
      const sides = flowSides(result.direction);
      const slots = outcomeSlots(wf.edges);
      for (const edge of wf.edges) {
        const route = result.routes.get(edge.id);
        expect(route, `route for ${edge.id}`).toBeDefined();
        const points = route!.points;
        for (let i = 1; i < points.length; i++) {
          const axisAligned = Math.abs(points[i].x - points[i - 1].x) < 0.5 || Math.abs(points[i].y - points[i - 1].y) < 0.5;
          expect(axisAligned, `${edge.id} segment ${i}`).toBe(true);
        }
        const source = byId.get(edge.source)!;
        const target = byId.get(edge.target)!;
        const sAt = result.positions.get(source.id)!;
        const tAt = result.positions.get(target.id)!;
        const slot = slots.get(edge.id);
        const start = slot
          ? add(sAt, outcomePortPoint(sizeOf(source), result.direction, slot.index, slot.count))
          : add(sAt, sidePoint(sizeOf(source), sides.out));
        const end = add(tAt, sidePoint(sizeOf(target), sides.in));
        expect(close(points[0], start), `${edge.id} starts on its port`).toBe(true);
        expect(close(points[points.length - 1], end), `${edge.id} ends on its port`).toBe(true);
      }
    });

    it('lays every forward sequence flow out in the flow direction', async () => {
      const result = await layout(wf, mode);
      const order = new Map(modelOrder(wf.nodes, wf.edges).map((node, index) => [node.id, index]));
      for (const edge of wf.edges) {
        if (isOutcomeKind(edgeKindOf(edge))) continue;
        if (order.get(edge.target)! <= order.get(edge.source)!) continue; // a loop
        const s = result.positions.get(edge.source)!;
        const t = result.positions.get(edge.target)!;
        if (mode === 'horizontal') expect(t.x, edge.id).toBeGreaterThan(s.x);
        else expect(t.y, edge.id).toBeGreaterThan(s.y);
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/* Specific behaviour                                                  */
/* ------------------------------------------------------------------ */

describe('auto-layout behaviour', () => {
  it('treats the loop back to an earlier step as the only back edge', async () => {
    const wf = FIXTURES.loop();
    const order = modelOrder(wf.nodes, wf.edges).map((node) => node.id);
    const back = wf.edges.filter((edge) => order.indexOf(edge.target) <= order.indexOf(edge.source));
    expect(back.map((edge) => `${edge.source}->${edge.target}`)).toEqual(['decide->draft']);

    const result = await layout(wf, 'horizontal');
    const draft = result.positions.get('draft')!;
    const decide = result.positions.get('decide')!;
    expect(draft.x).toBeLessThan(decide.x);
    // The loop leaves the flow and comes back around it, never straight backwards through nodes.
    expect(result.routes.get(back[0].id)!.points.length).toBeGreaterThan(3);
  });

  it('keeps the happy path on one straight line', async () => {
    const wf = FIXTURES['agent-contract']();
    const result = await layout(wf, 'horizontal');
    const centreY = (id: string) => result.positions.get(id)!.y + sizeOf(wf.nodes.find((n) => n.id === id)!).height / 2;
    const main = wf.edges.find((edge) => edge.source === 'classify' && !edge.label)!;
    expect(centreY(main.source)).toBeCloseTo(centreY(main.target), 0);
  });

  it('puts the branches of a gateway in one layer, side by side across the flow', async () => {
    const wf = FIXTURES['condition-router']();
    const desks = wf.edges.filter((edge) => edge.source === wf.nodes.find((n) => n.type === 'gateway')!.id).map((e) => e.target);
    for (const mode of ['horizontal', 'vertical'] as const) {
      const result = await layout(wf, mode);
      const along = desks.map((id) => (mode === 'horizontal' ? result.positions.get(id)!.x : result.positions.get(id)!.y));
      const across = desks.map((id) => (mode === 'horizontal' ? result.positions.get(id)!.y : result.positions.get(id)!.x));
      expect(new Set(along).size).toBe(1);
      expect(new Set(across).size).toBe(desks.length);
    }
  });

  it('tidy keeps the author’s order within a layer', async () => {
    const wf = FIXTURES['condition-router']();
    const laid = await layout(wf, 'horizontal');
    const nodes = applyPositions(wf.nodes, laid.positions);
    const gateway = nodes.find((n) => n.type === 'gateway')!.id;
    const desks = wf.edges.filter((e) => e.source === gateway).map((e) => e.target);
    const byY = (list: WorkflowNode[]) => desks.slice().sort((a, b) =>
      list.find((n) => n.id === a)!.y - list.find((n) => n.id === b)!.y);

    // The author drags the last desk to the top.
    const [first, , last] = byY(nodes);
    const moved = nodes.map((n) => (n.id === last ? { ...n, y: nodes.find((m) => m.id === first)!.y - 150 } : n));
    const tidied = await computeLayout(moved, wf.edges, 'tidy');
    expect(tidied.direction).toBe('horizontal');
    expect(byY(applyPositions(moved, tidied.positions))).toEqual(byY(moved));
  });

  it('recognises an untouched auto-layout from its saved positions', async () => {
    const wf = FIXTURES['kyc-onboarding']();
    const laid = await layout(wf, 'horizontal');
    const saved = applyPositions(wf.nodes, laid.positions);
    expect(matchesPositions(saved, (await layout({ ...wf, nodes: saved }, 'horizontal')).positions)).toBe(true);
    const nudged = saved.map((n, i) => (i === 1 ? { ...n, x: n.x + 30 } : n));
    expect(matchesPositions(nudged, laid.positions)).toBe(false);
  });

  it('lays out an empty process without calling the engine', async () => {
    const result = await computeLayout([], [], 'horizontal');
    expect(result.positions.size).toBe(0);
  });
});
