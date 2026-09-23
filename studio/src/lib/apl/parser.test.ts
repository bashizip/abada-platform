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

describe('agent outcome routes', () => {
  const apl: APLDocument = {
    version: 'abada.io/v1',
    metadata: { key: 'routes', name: 'Routes' },
    flow: {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'webhook', next: 'classify' },
        {
          id: 'classify',
          type: 'agent',
          prompt: 'Classify ${lead.companySize}',
          result_variable: 'lead_priority',
          output_schema: { type: 'object' },
          confidence_threshold: 85,
          on_low_confidence: 'review',
          on_invalid_output: 'review',
          on_error: [{ code: 'CANNOT_DECIDE', then: 'review' }, { then: 'fallback' }],
          next: 'crm',
        },
        { id: 'review', type: 'human-input', assignees: ['sales'], next: 'end' },
        { id: 'fallback', type: 'engine-task', service: 'fallback', on_error: 'end', next: 'end' },
        { id: 'crm', type: 'engine-task', service: 'crm', next: 'end' },
        { id: 'end', type: 'end' },
      ],
    },
  };

  it('draws routes as labelled edges and keeps next as the normal successor', () => {
    const wf = aplToWorkflow(apl);
    const labels = wf.edges.filter((e) => e.source === 'classify').map((e) => e.label ?? 'next');
    expect(labels).toEqual(['next', 'on_low_confidence', 'on_invalid_output', 'on_error: CANNOT_DECIDE', 'on_error']);
    expect(wf.edges.find((e) => e.source === 'fallback' && e.label === 'on_error')?.target).toBe('end');
  });

  it('round-trips routes, thresholds and next without loss', () => {
    const back = workflowToAPL(aplToWorkflow(apl));
    const classify = back.flow.nodes.find((n) => n.id === 'classify') as unknown as Record<string, unknown>;
    expect(classify.next).toBe('crm');
    expect(classify.on_low_confidence).toBe('review');
    expect(classify.on_invalid_output).toBe('review');
    expect(classify.on_error).toEqual([{ code: 'CANNOT_DECIDE', then: 'review' }, { then: 'fallback' }]);
    expect(classify.confidence_threshold).toBe(85);
    const fallback = back.flow.nodes.find((n) => n.id === 'fallback') as unknown as Record<string, unknown>;
    expect(fallback.next).toBe('end');
    expect(fallback.on_error).toBe('end');
  });

  it('does not invent a confidence threshold for agents that declare none', () => {
    const plain: APLDocument = {
      ...apl,
      flow: {
        entry: 'start',
        nodes: [
          { id: 'start', type: 'webhook', next: 'summarize' },
          { id: 'summarize', type: 'agent', prompt: 'Summarize ${text}', next: 'end' },
          { id: 'end', type: 'end' },
        ],
      },
    };
    const summarize = workflowToAPL(aplToWorkflow(plain)).flow.nodes.find((n) => n.id === 'summarize') as unknown as Record<string, unknown>;
    expect(summarize.confidence_threshold).toBeUndefined();
  });
});
