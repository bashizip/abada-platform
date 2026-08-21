import { describe, it, expect } from 'vitest';
import { aplToWorkflow, workflowToAPL } from './parser';
import { APLDocument } from './types';

describe('aplToWorkflow', () => {
  it('parses canonical human-input type', () => {
    const apl: APLDocument = {
      version: 'abada.io/v1',
      metadata: { key: 'test', name: 'Test' },
      flow: {
        entry: 'start',
        nodes: [
          { id: 'start', type: 'webhook', next: 'review' },
          {
            id: 'review',
            type: 'human-input',
            description: 'Review',
            assignees: ['managers'],
            formKey: 'form-v1',
            next: 'end',
          },
          { id: 'end', type: 'end' },
        ],
      },
    };

    const wf = aplToWorkflow(apl);
    const reviewNode = wf.nodes.find((n) => n.id === 'review');
    expect(reviewNode).toBeDefined();
    expect(reviewNode!.type).toBe('human');
    expect(reviewNode!.humanConfig).toMatchObject({
      assignees: ['managers'],
      formKey: 'form-v1',
    });
  });

  it('accepts deprecated approval-gate alias', () => {
    const apl: APLDocument = {
      version: 'abada.io/v1',
      metadata: { key: 'test', name: 'Test' },
      flow: {
        entry: 'start',
        nodes: [
          { id: 'start', type: 'webhook', next: 'gate' },
          {
            id: 'gate',
            type: 'approval-gate',
            description: 'Gate',
            assignees: ['reviewers'],
            next: 'end',
          },
          { id: 'end', type: 'end' },
        ],
      },
    };

    const wf = aplToWorkflow(apl);
    const gateNode = wf.nodes.find((n) => n.id === 'gate');
    expect(gateNode).toBeDefined();
    expect(gateNode!.type).toBe('human');
    expect(gateNode!.humanConfig!.assignees).toEqual(['reviewers']);
  });
});

describe('workflowToAPL', () => {
  it('emits canonical human-input type for human nodes', () => {
    const wf = {
      id: '1',
      name: 'Test',
      category: 'custom' as const,
      fileType: 'apl' as const,
      version: '1',
      updatedAt: new Date().toISOString(),
      processKey: 'test',
      nodes: [
        {
          id: 'review',
          type: 'human' as const,
          name: 'Review',
          title: 'Review',
          description: 'Review task',
          x: 0,
          y: 0,
          humanConfig: {
            assignees: ['managers'],
            formKey: 'form-v1',
            slaHours: 24,
            requireDoubleSignOff: false,
            formFields: [],
          },
        },
      ],
      edges: [],
    };

    const apl = workflowToAPL(wf);
    const reviewNode = apl.flow.nodes.find((n) => n.id === 'review');
    expect(reviewNode).toBeDefined();
    expect(reviewNode!.type).toBe('human-input');
    expect((reviewNode as any).assignees).toEqual(['managers']);
    expect((reviewNode as any).formKey).toBe('form-v1');
  });
});
