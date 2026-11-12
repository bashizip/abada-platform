import React, { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DecisionTableEditor } from './DecisionTableEditor';
import { displayOrder, formatValue, moveRule, outputColumns, parseValue, renameOutputColumn } from './decisionTable';
import { blur, byLabel, click, render, type } from '@/test/render';
import type { AplValidationIssue } from '@/api/apl';
import type { DMNConfig, DMNRule, WorkflowFile, WorkflowNode } from '@/types';
import { aplToWorkflow, parseAPLYaml, stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { record, undo, redo, emptyHistory, withContent } from '@/lib/history/workflowHistory';

const SOURCE = `version: abada.io/v1
metadata:
  key: loan_tier
  name: Loan tier
flow:
  entry: start
  nodes:
    - { id: start, type: webhook, next: tier }
    - id: tier
      type: decision-table
      decisionKey: LOAN_TIER
      hitPolicy: FIRST
      inputs:
        - { name: score, expr: "\${applicant.score}" }
        - { name: amount }
      rules:
        - when: score >= 750
          then: { tier: "A", auto_approve: true, limit: 50000 }
        - when: score >= 600
          then: { tier: "B", auto_approve: false }
        - otherwise:
            then: { tier: "C", auto_approve: false }
      next: done
    - { id: done, type: end }
`;

const load = (): WorkflowFile => ({ ...aplToWorkflow(parseAPLYaml(SOURCE)), id: 'wf', name: 'Loan tier' } as WorkflowFile);
const tableOf = (wf: WorkflowFile) => wf.nodes.find((node) => node.id === 'tier')!;

const show = (node: WorkflowNode, issues: AplValidationIssue[] = []) => {
  const update = vi.fn();
  const container = render(<DecisionTableEditor node={node} nodes={[node]} issues={issues} update={update}
    routeTo={vi.fn()} commitWithRoutes={vi.fn()} />);
  const last = (): DMNConfig => update.mock.calls.at(-1)![0].dmnConfig;
  return { container, update, last };
};

describe('decision-table editor', () => {
  it('shows the key, hit policy, inputs, outputs and the rules in order with the fallback last', () => {
    const { container } = show(tableOf(load()));
    expect(byLabel<HTMLInputElement>(container, 'Decision key').value).toBe('LOAN_TIER');
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain('First match');
    expect(byLabel<HTMLInputElement>(container, 'Input expression 1').value).toBe('${applicant.score}');
    expect(byLabel<HTMLInputElement>(container, 'Condition of rule 1').value).toBe('score >= 750');
    expect(byLabel<HTMLInputElement>(container, 'tier for rule otherwise').value).toBe('C');
    expect(byLabel<HTMLInputElement>(container, 'limit for rule 2').value).toBe('');
    expect([...container.querySelectorAll('[data-rule-index]')].map((row) => row.getAttribute('data-rule-index')))
      .toEqual(['0', '1', '2']);
  });

  it('edits conditions and typed outputs', () => {
    const { container, last } = show(tableOf(load()));
    type(byLabel(container, 'Condition of rule 2'), 'score >= 620');
    expect(last().rules[1].when).toBe('score >= 620');
    type(byLabel(container, 'limit for rule 2'), '20000');
    expect(last().rules[1].then).toEqual({ tier: 'B', auto_approve: false, limit: 20000 });
    type(byLabel(container, 'tier for rule 1'), '"42"');
    expect(last().rules[0].then.tier).toBe('42');
    type(byLabel(container, 'limit for rule 1'), '');
    expect(last().rules[0].then).not.toHaveProperty('limit');
  });

  it('changes the hit policy and explains it', () => {
    const { container, last } = show(tableOf(load()));
    click([...container.querySelectorAll('[role="radio"]')].find((radio) => radio.textContent?.includes('UNIQUE'))!);
    expect(last().hitPolicy).toBe('UNIQUE');
  });

  it('reorders rules by button, keyboard and drag; the fallback stays last', () => {
    const { container, last } = show(tableOf(load()));
    click(byLabel(container, 'Move rule 2 up'));
    expect(last().rules.map((rule) => rule.when ?? 'otherwise')).toEqual(['score >= 600', 'score >= 750', 'otherwise']);

    const handle = byLabel(container, 'Drag rule 1');
    act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true })); });
    expect(last().rules.map((rule) => rule.when ?? 'otherwise')).toEqual(['score >= 600', 'score >= 750', 'otherwise']);

    const drag = (target: Element, name: string) => {
      const event = new Event(name, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { effectAllowed: '' } });
      act(() => { target.dispatchEvent(event); });
    };
    drag(byLabel(container, 'Drag rule 2'), 'dragstart');
    const first = container.querySelector('[data-rule-index="0"]')!;
    drag(first, 'dragover');
    drag(first, 'drop');
    expect(last().rules.map((rule) => rule.when ?? 'otherwise')).toEqual(['score >= 600', 'score >= 750', 'otherwise']);
  });

  it('allows one fallback: the add button only shows without one', () => {
    const node = tableOf(load());
    const { container } = show(node);
    expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('Add fallback'))).toBe(false);
    const without = { ...node, dmnConfig: { ...node.dmnConfig!, rules: node.dmnConfig!.rules.filter((rule) => !rule.otherwise) } };
    const second = show(without);
    const add = [...second.container.querySelectorAll('button')].find((button) => button.textContent?.includes('Add fallback'))!;
    click(add);
    expect(second.last().rules.filter((rule) => rule.otherwise)).toHaveLength(1);
  });

  it('adds, duplicates and deletes rules; renames and removes outputs in every rule', () => {
    const { container, last } = show(tableOf(load()));
    click(byLabel(container, 'Duplicate rule 1'));
    expect(last().rules.map((rule) => rule.when ?? 'otherwise')).toEqual(['score >= 750', 'score >= 750', 'score >= 600', 'otherwise']);
    click(byLabel(container, 'Delete rule 2'));
    expect(last().rules).toHaveLength(2);
    const name = byLabel<HTMLInputElement>(container, 'Output name tier');
    type(name, 'grade');
    blur(name);
    expect(last().rules.every((rule) => 'grade' in rule.then && !('tier' in rule.then))).toBe(true);
    click(byLabel(container, 'Remove output auto_approve'));
    expect(last().rules.some((rule) => 'auto_approve' in rule.then)).toBe(false);
  });

  it('shows each engine issue on the rule it names', () => {
    const issues: AplValidationIssue[] = [
      { code: 'APL', severity: 'ERROR', path: '/flow/nodes/1/rules/1/when',
        message: "decision table 'tier' rule 2 reads income, which is not a declared input" },
      { code: 'APL', severity: 'ERROR', path: '/flow/nodes/1/rules/2',
        message: "decision table 'tier' declares a second otherwise rule" },
    ];
    const { container } = show(tableOf(load()), issues);
    expect(container.querySelector('[data-rule-index="1"]')?.textContent).toContain('reads income');
    expect(container.querySelector('[data-rule-index="0"]')?.textContent).not.toContain('reads income');
    expect(container.querySelector('[data-rule-index="2"]')?.textContent).toContain('second otherwise rule');
    expect(container.querySelector('[data-section="rules"]')?.textContent).toContain('2');
  });

  it('opens the full table in a drawer', () => {
    const { container } = show(tableOf(load()));
    click(byLabel(container, 'Expand the rule table'));
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(drawer.querySelector('table')).not.toBeNull();
    expect(drawer.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('round-trips edits to YAML, and undo/redo restore them', () => {
    const before = load();
    const { container, last } = show(tableOf(before));
    type(byLabel(container, 'Condition of rule 1'), 'score >= 760');
    const after: WorkflowFile = { ...before, nodes: before.nodes.map((node) => (node.id === 'tier' ? { ...node, dmnConfig: last() } : node)) };
    const yaml = stringifyAPLYaml(workflowToAPL(after));
    expect(yaml).toContain('when: score >= 760');
    const reread = parseAPLYaml(yaml).flow.nodes.find((node) => node.id === 'tier') as any;
    expect(reread.rules.map((rule: any) => rule.when ?? 'otherwise')).toEqual(['score >= 760', 'score >= 600', 'otherwise']);
    expect(reread.rules[2].otherwise.then).toEqual({ tier: 'C', auto_approve: false });
    expect(reread.inputs).toEqual({ score: '${applicant.score}', amount: '' });

    const history = record(emptyHistory(), before, after, 'node', 0);
    const undone = undo(history, after)!;
    expect(stringifyAPLYaml(workflowToAPL(withContent(after, undone.content)))).toContain('when: score >= 750');
    const redone = redo(undone.history, withContent(after, undone.content))!;
    expect(stringifyAPLYaml(workflowToAPL(withContent(after, redone.content)))).toContain('when: score >= 760');
  });
});

describe('decision-table helpers', () => {
  it('reads and writes typed values so each reads back the same', () => {
    expect(parseValue('true')).toBe(true);
    expect(parseValue('1.5')).toBe(1.5);
    expect(parseValue('"1.5"')).toBe('1.5');
    expect(parseValue('LOW')).toBe('LOW');
    expect(parseValue('  ')).toBeUndefined();
    for (const value of ['LOW', 'true', '42', '', ' a', true, 0, -3.25]) expect(parseValue(formatValue(value))).toBe(value);
  });

  it('derives columns, keeps the fallback last when moving, and renames in place', () => {
    const rules: DMNRule[] = [
      { id: 'a', otherwise: true, then: { x: 1 } },
      { id: 'b', when: 'p', then: { y: 2, x: 0 } },
      { id: 'c', when: 'q', then: {} },
    ];
    expect(displayOrder(rules).map((rule) => rule.id)).toEqual(['b', 'c', 'a']);
    expect(moveRule(rules, 1, 0).map((rule) => rule.id)).toEqual(['c', 'b', 'a']);
    expect(outputColumns(rules, ['z'])).toEqual(['x', 'y', 'z']);
    expect(Object.keys(renameOutputColumn(rules, 'y', 'w')[1].then)).toEqual(['w', 'x']);
  });
});
