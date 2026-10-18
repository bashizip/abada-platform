import { describe, expect, it } from 'vitest';
import { aplToWorkflow, parseAPLYaml, workflowToAPL } from './parser';
import { branchProblem, edgeCondition, gatewayBranches, setBranchCondition, setBranchElse } from './gatewayRules';
import type { WorkflowEdge } from '@/types';

const doc = (type: 'condition' | 'inclusive') => parseAPLYaml(`
version: abada.io/v1
metadata:
  key: gate_demo
  name: Gate demo
flow:
  entry: start
  nodes:
    - id: start
      type: webhook
      next: gate
    - id: gate
      type: ${type}
      rules:
        - if: risk == "low"
          then: archive
        - else: escalate
    - id: archive
      type: end
    - id: escalate
      type: end
`);

const savedRules = (wf: ReturnType<typeof aplToWorkflow>) =>
  (workflowToAPL(wf).flow.nodes.find((n) => n.id === 'gate') as { rules: { if?: string; then?: string; else?: unknown }[] })
    .rules.map((r) => ({ if: r.if, then: r.then, else: r.else }));

const edgeTo = (wf: ReturnType<typeof aplToWorkflow>, target: string) =>
  gatewayBranches(wf, 'gate').find((e) => e.target === target)!;

describe('gateway branch rules', () => {
  it.each(['condition', 'inclusive'] as const)('saves an edited condition and its label on a %s node', (type) => {
    let wf = aplToWorkflow(doc(type));
    wf = setBranchCondition(wf, edgeTo(wf, 'archive').id, 'risk == "low" && amount < 100');

    expect(edgeTo(wf, 'archive').label).toBe('if risk == "low" && amount < 100');
    expect(savedRules(wf)[0]).toEqual({ if: 'risk == "low" && amount < 100', then: 'archive', else: undefined });
  });

  it('turns a branch into the else rule and back', () => {
    let wf = aplToWorkflow(doc('condition'));
    const archive = edgeTo(wf, 'archive').id;
    const escalate = edgeTo(wf, 'escalate').id;

    wf = setBranchElse(wf, escalate, false);
    wf = setBranchCondition(wf, escalate, 'risk == "high"');
    wf = setBranchElse(wf, archive, true);
    expect(edgeTo(wf, 'archive')).not.toHaveProperty('condition');
    expect(savedRules(wf)).toEqual([
      { if: undefined, then: 'archive', else: 'archive' },
      { if: 'risk == "high"', then: 'escalate', else: undefined },
    ]);
  });

  it('clearing a condition drops it instead of keeping a stale one', () => {
    let wf = aplToWorkflow(doc('condition'));
    wf = setBranchCondition(wf, edgeTo(wf, 'archive').id, '  ');
    expect(edgeCondition(edgeTo(wf, 'archive'))).toBeUndefined();
  });

  it('reads a legacy ${…} label but never free text as a condition', () => {
    expect(edgeCondition({ label: 'if ${score > 75}' })).toBe('${score > 75}');
    expect(edgeCondition({ label: 'Next Step' })).toBeUndefined();
    expect(edgeCondition({ label: 'if ${a}', condition: 'b > 1' })).toBe('b > 1');
  });

  it('flags what the engine would reject', () => {
    const edge = (id: string, extra: Partial<WorkflowEdge>): WorkflowEdge => ({ id, source: 'gate', target: id, ...extra });
    const missing = [edge('a', { label: 'Next Step' }), edge('b', { condition: 'x' }), edge('c', {})];
    expect(missing.map((e, i) => branchProblem(e, i, missing))).toEqual([
      'Needs a condition, or mark it as the else branch.', null, null,
    ]);
    const twoElse = [edge('a', { label: 'else' }), edge('b', { label: 'else' })];
    expect(twoElse.map((e, i) => branchProblem(e, i, twoElse))).toEqual([
      null, 'Only one branch can be the else branch; give this one a condition.',
    ]);
  });
});
