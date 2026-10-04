import { describe, expect, it } from 'vitest';
import { aplToWorkflow, workflowToAPL } from './parser';
import { dropNodeReferences, removeEdge, routesFor, setRoute, timeoutError } from './routes';
import type { APLDocument } from './types';
import type { WorkflowFile } from '@/types';

const doc: APLDocument = {
  version: 'abada.io/v1',
  metadata: { key: 'routes', name: 'Routes' },
  flow: {
    entry: 'start',
    nodes: [
      { id: 'start', type: 'webhook', next: 'draft' },
      { id: 'draft', type: 'agent', model: 'gemini-3.6-flash', prompt: 'Draft', loop: { max_iterations: 3 }, next: 'review' },
      {
        id: 'review',
        type: 'human-input',
        assignees: ['reviewers'],
        outcomes: { approve: { next: 'done' }, reject: { next: 'draft', comment: 'required' } },
      },
      { id: 'sync', type: 'engine-task', service: 'crm', next: 'done' },
      { id: 'manual', type: 'human-input', assignees: ['operators'], next: 'done' },
      { id: 'done', type: 'end' },
    ],
  },
};

const fresh = (): WorkflowFile => aplToWorkflow(structuredClone(doc));
const saved = (workflow: WorkflowFile, id: string) =>
  workflowToAPL(workflow).flow.nodes.find((node) => node.id === id) as unknown as Record<string, unknown>;
const routesFrom = (workflow: WorkflowFile, id: string) =>
  workflow.edges.filter((edge) => edge.source === id).map((edge) => [edge.target, edge.label ?? null]);

describe('route editing', () => {
  it('draws a route as soon as it is set and saves it to APL', () => {
    let workflow = setRoute(fresh(), 'draft', { kind: 'timeout', after: 'PT2H' }, 'manual');
    workflow = setRoute(workflow, 'draft', { kind: 'error', code: 'QUOTA' }, 'manual');
    workflow = setRoute(workflow, 'draft', { kind: 'error' }, 'done');
    workflow = setRoute(workflow, 'draft', { kind: 'low_confidence' }, 'manual');
    workflow = setRoute(workflow, 'draft', { kind: 'exhausted' }, 'manual');

    expect(routesFrom(workflow, 'draft')).toEqual([
      ['review', null],
      ['manual', 'on_low_confidence'],
      ['manual', 'on_error: QUOTA'],
      ['done', 'on_error'],
      ['manual', 'on_timeout'],
      ['manual', 'on_exhausted'],
    ]);
    expect(saved(workflow, 'draft')).toMatchObject({
      next: 'review',
      on_timeout: { after: 'PT2H', then: 'manual' },
      on_error: [{ code: 'QUOTA', then: 'manual' }, { then: 'done' }],
      on_low_confidence: 'manual',
      loop: { max_iterations: 3, on_exhausted: 'manual' },
    });
    // The saved APL reads back to the same edges.
    expect(routesFrom(aplToWorkflow(workflowToAPL(workflow)), 'draft')).toEqual(routesFrom(workflow, 'draft'));
  });

  it('replaces the normal successor instead of keeping two', () => {
    const workflow = setRoute(fresh(), 'sync', { kind: 'next' }, 'manual');
    expect(routesFrom(workflow, 'sync')).toEqual([['manual', null]]);
    expect(saved(workflow, 'sync').next).toBe('manual');
  });

  it('points a review outcome at a new target', () => {
    const workflow = setRoute(fresh(), 'review', { kind: 'outcome', name: 'reject' }, 'manual');
    expect(saved(workflow, 'review').outcomes).toEqual({
      approve: { next: 'done' },
      reject: { next: 'manual', comment: 'required' },
    });
  });

  it('deleting a route edge clears the config it came from', () => {
    let workflow = setRoute(fresh(), 'sync', { kind: 'error' }, 'manual');
    workflow = setRoute(workflow, 'draft', { kind: 'exhausted' }, 'manual');
    const errorEdge = workflow.edges.find((edge) => edge.source === 'sync' && edge.label === 'on_error')!;
    const exhaustedEdge = workflow.edges.find((edge) => edge.label === 'on_exhausted')!;

    workflow = removeEdge(removeEdge(workflow, errorEdge.id), exhaustedEdge.id);

    expect(saved(workflow, 'sync').on_error).toBeUndefined();
    expect(saved(workflow, 'draft').loop).toEqual({ max_iterations: 3 });
    expect(workflow.edges.some((edge) => edge.label === 'on_exhausted' || edge.label === 'on_error')).toBe(false);
  });

  it('deleting a node leaves no route pointing at it', () => {
    let workflow = setRoute(fresh(), 'draft', { kind: 'timeout', after: 'PT1H' }, 'manual');
    workflow = setRoute(workflow, 'review', { kind: 'outcome', name: 'reject' }, 'manual');
    workflow = dropNodeReferences(workflow, 'manual');

    expect(workflow.edges.some((edge) => edge.target === 'manual' || edge.source === 'manual')).toBe(false);
    expect(saved(workflow, 'draft').on_timeout).toBeUndefined();
    expect(saved(workflow, 'review').outcomes).toEqual({ approve: { next: 'done' } });
  });

  it('offers the routes each kind of step supports', () => {
    const workflow = fresh();
    const kinds = (id: string) => routesFor(workflow.nodes.find((node) => node.id === id)!)
      .map((route) => (route.kind === 'outcome' ? `outcome:${route.name}` : route.kind));
    expect(kinds('draft')).toEqual(['next', 'error', 'timeout', 'low_confidence', 'invalid_output', 'exhausted']);
    expect(kinds('review')).toEqual(['outcome:approve', 'outcome:reject', 'error', 'timeout']);
    expect(kinds('sync')).toEqual(['next', 'error', 'timeout']);
    expect(kinds('start')).toEqual(['next']);
  });

  it('accepts only timeouts the engine accepts', () => {
    expect(timeoutError('PT2H')).toBeNull();
    expect(timeoutError('p3d')).toBeNull();
    expect(timeoutError('PT0S')).toContain('between');
    expect(timeoutError('P400D')).toContain('between');
    expect(timeoutError('two hours')).toContain('ISO-8601');
    expect(timeoutError('P1M')).toContain('ISO-8601');
  });
});
