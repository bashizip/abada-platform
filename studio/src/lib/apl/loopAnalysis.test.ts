import { describe, expect, it } from 'vitest';
import reworkLoop from '../../../../engine/src/test/resources/apl/rework-loop.apl.yaml?raw';
import { aplToWorkflow, parseAPLYaml } from './parser';
import { analyzeLoops } from './loopAnalysis';

describe('loop analysis', () => {
  it('finds the rework loop and sees it is bounded', () => {
    const workflow = aplToWorkflow(parseAPLYaml(reworkLoop));
    const analysis = analyzeLoops(workflow);
    expect(analysis.backEdges.map((edge) => [edge.source, edge.target])).toEqual([['decide', 'draft']]);
    expect(analysis.targets.get('draft')).toBeNull();
  });

  it('flags a cycle without a bound, to the start, and to a parallel gateway', () => {
    const workflow = aplToWorkflow(parseAPLYaml(reworkLoop));
    const unbounded = { ...workflow, nodes: workflow.nodes.map((node) => (node.id === 'draft' ? { ...node, loop: undefined } : node)) };
    expect(analyzeLoops(unbounded).targets.get('draft')).toBe('unbounded');

    const toStart = { ...workflow, edges: [...workflow.edges, { id: 'back', source: 'done', target: 'request' }] };
    expect(analyzeLoops(toStart).targets.get('request')).toBe('start');

    const toJoin = {
      nodes: [
        { id: 's', type: 'event' as const, subtype: 'start' as const, title: 's', description: '', x: 0, y: 0 },
        { id: 'fork', type: 'gateway' as const, subtype: 'parallel' as const, title: 'f', description: '', x: 0, y: 0 },
        { id: 'a', type: 'engine-task' as const, title: 'a', description: '', x: 0, y: 0 },
      ],
      edges: [{ id: '1', source: 's', target: 'fork' }, { id: '2', source: 'fork', target: 'a' }, { id: '3', source: 'a', target: 'fork' }],
    };
    expect(analyzeLoops(toJoin).targets.get('fork')).toBe('join');
  });
});
