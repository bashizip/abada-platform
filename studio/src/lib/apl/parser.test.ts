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

describe('inclusive gateway', () => {
  const apl: APLDocument = {
    version: 'abada.io/v1',
    metadata: { key: 'incl', name: 'Inclusive' },
    flow: {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'webhook', next: 'fork' },
        {
          id: 'fork',
          type: 'inclusive',
          rules: [
            { if: "${path == 'C'}", then: 'taskC' },
            { if: "${path == 'D'}", then: 'taskD' },
          ],
        },
        { id: 'taskC', type: 'engine-task', service: 'c', next: 'join' },
        { id: 'taskD', type: 'engine-task', service: 'd', next: 'join' },
        { id: 'join', type: 'inclusive', next: 'end' },
        { id: 'end', type: 'end' },
      ],
    },
  };

  it('draws every fork rule as a labelled branch edge', () => {
    const wf = aplToWorkflow(apl);
    const branches = wf.edges.filter((e) => e.source === 'fork');
    expect(branches.map((e) => [e.target, e.label])).toEqual([
      ['taskC', "if ${path == 'C'}"],
      ['taskD', "if ${path == 'D'}"],
    ]);
  });

  it('round-trips the fork rules and the join through the canvas model', () => {
    const back = workflowToAPL(aplToWorkflow(apl));
    const fork = back.flow.nodes.find((n) => n.id === 'fork') as { rules?: { if?: string; then: string }[] };
    expect(fork.rules?.map((r) => [r.if, r.then])).toEqual([
      ["${path == 'C'}", 'taskC'],
      ["${path == 'D'}", 'taskD'],
    ]);
    expect(back.flow.nodes.find((n) => n.id === 'join')?.next).toBe('end');
  });
});

describe('canvas positions', () => {
  const doc = (ui: boolean): APLDocument => ({
    version: 'abada.io/v1',
    metadata: { key: 'pos', name: 'Positions' },
    flow: {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'webhook', next: 'wait', ...(ui ? { ui: { x: 40, y: 100 } } : {}) },
        {
          id: 'wait',
          type: 'event-gateway',
          events: [
            { type: 'message-catch', message: 'paid', next: 'done' },
            { type: 'timer', duration: 'PT1H', next: 'done' },
          ],
          ...(ui ? { ui: { x: 200, y: 96 } } : {}),
        } as APLDocument['flow']['nodes'][number],
        { id: 'done', type: 'end', ...(ui ? { ui: { x: 600, y: 100 } } : {}) },
      ],
    },
  });

  it('keeps saved ui positions and does not ask for a layout', () => {
    const wf = aplToWorkflow(doc(true));
    expect(wf.layoutPending).toBeUndefined();
    expect(wf.nodes.find((n) => n.id === 'start')).toMatchObject({ x: 40, y: 100 });
    expect(wf.nodes.find((n) => n.id === 'done')).toMatchObject({ x: 600, y: 100 });
  });

  it('seeds event-gateway catch children between the gateway and their target, without overlap', () => {
    const wf = aplToWorkflow(doc(true));
    const children = wf.nodes.filter((n) => n.id.startsWith('wait_e'));
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.x).toBeGreaterThan(200);
      expect(child.x).toBeLessThan(600);
    }
    expect(Math.abs(children[0].y - children[1].y)).toBeGreaterThanOrEqual(44);
  });

  it('asks for an auto-layout when no node has a saved position', () => {
    const wf = aplToWorkflow(doc(false));
    expect(wf.layoutPending).toBe(true);
    // A legible seeded grid until the layout runs: distinct cells, flow left to right.
    const x = (id: string) => wf.nodes.find((n) => n.id === id)!.x;
    expect(x('start')).toBeLessThan(x('wait'));
    expect(x('wait')).toBeLessThan(x('done'));
    expect(workflowToAPL(wf)).not.toHaveProperty('layoutPending');
  });
});

describe('APL → workflow: condition else shorthand', () => {
  it('routes `else: <node id>` (no then) to that node, as the engine does', () => {
    const doc: APLDocument = {
      version: 'abada.io/v1',
      metadata: { name: 'Else shorthand', key: 'else_shorthand' },
      flow: {
        entry: 'start',
        nodes: [
          { id: 'start', type: 'webhook', next: 'gate' },
          { id: 'gate', type: 'condition', rules: [{ if: '${score > 80}', then: 'fast' }, { else: 'slow' }] },
          { id: 'fast', type: 'end' },
          { id: 'slow', type: 'end' },
        ],
      },
    };

    const workflow = aplToWorkflow(doc);

    expect(workflow.edges.filter((edge) => edge.source === 'gate').map((edge) => edge.target))
      .toEqual(['fast', 'slow']);
    expect(workflow.edges.some((edge) => edge.target === undefined || edge.id.endsWith('_undefined'))).toBe(false);
  });
});

describe('APL round trip: loops and keys Studio does not edit', () => {
  const rework: APLDocument = {
    version: 'abada.io/v1',
    metadata: {
      key: 'rework',
      name: 'Rework',
      description: 'Draft, review, redo',
      variables: [{ name: 'brief', type: 'object', required: true }],
    },
    flow: {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'webhook', next: 'draft' },
        {
          id: 'draft',
          type: 'engine-task',
          service: 'draft',
          loop: { max_iterations: 3, on_exhausted: 'escalate' },
          next: 'decide',
        },
        { id: 'decide', type: 'condition', rules: [{ if: '${approved == true}', then: 'done' }, { else: 'draft' }] },
        { id: 'escalate', type: 'end' },
        { id: 'done', type: 'end' },
      ],
    },
  };

  it('keeps a loop bound and draws on_exhausted as a route edge', () => {
    const workflow = aplToWorkflow(rework);

    expect(workflow.nodes.find((node) => node.id === 'draft')?.loop)
      .toEqual({ maxIterations: 3, onExhausted: 'escalate' });
    expect(workflow.edges.filter((edge) => edge.source === 'draft').map((edge) => [edge.target, edge.label]))
      .toEqual([['decide', undefined], ['escalate', 'on_exhausted']]);

    const draft = workflowToAPL(workflow).flow.nodes.find((node) => node.id === 'draft');
    expect(draft).toMatchObject({ next: 'decide', loop: { max_iterations: 3, on_exhausted: 'escalate' } });
  });

  it('keeps metadata variables and description through a save', () => {
    expect(workflowToAPL(aplToWorkflow(rework)).metadata).toMatchObject({
      key: 'rework',
      description: 'Draft, review, redo',
      variables: [{ name: 'brief', type: 'object', required: true }],
    });
  });

  it('keeps node keys Studio does not edit instead of dropping them', () => {
    const withUnknown = structuredClone(rework);
    (withUnknown.flow.nodes[1] as unknown as Record<string, unknown>).future_field = { keep: true };

    const draft = workflowToAPL(aplToWorkflow(withUnknown)).flow.nodes.find((node) => node.id === 'draft');

    expect(draft).toMatchObject({ future_field: { keep: true }, service: 'draft' });
  });

  it('does not resurrect a field Studio edits when it is removed on the canvas', () => {
    const withRoute = structuredClone(rework);
    (withRoute.flow.nodes[1] as unknown as Record<string, unknown>).on_error = 'escalate';
    const workflow = aplToWorkflow(withRoute);
    const draft = workflow.nodes.find((node) => node.id === 'draft')!;
    expect(draft.engineTaskConfig?.onError).toBe('escalate');
    draft.engineTaskConfig = { ...draft.engineTaskConfig!, onError: undefined };
    delete draft.loop;

    const saved = workflowToAPL(workflow).flow.nodes.find((node) => node.id === 'draft') as unknown as
      Record<string, unknown>;

    expect(saved.loop).toBeUndefined();
    expect(saved.on_error).toBeUndefined();
  });
});

describe('APL round trip: boundaries, service level and fallback models', () => {
  const boundaries: APLDocument = {
    version: 'abada.io/v1',
    metadata: { key: 'boundaries', name: 'Boundaries' },
    flow: {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'webhook', next: 'draft' },
        {
          id: 'draft',
          type: 'agent',
          model: 'gemini-3.6-flash',
          prompt: 'Draft a reply',
          fallback_models: ['gemini-3.7-flash'],
          on_timeout: { after: 'PT1H', then: 'manual' },
          on_error: 'manual',
          next: 'review',
        },
        {
          id: 'review',
          type: 'human-input',
          assignees: ['reviewers'],
          sla_hours: 4,
          escalate_to: ['managers'],
          on_timeout: { after: 'P3D', then: 'done' },
          next: 'done',
        },
        { id: 'manual', type: 'human-input', assignees: ['operators'], next: 'done' },
        { id: 'done', type: 'end' },
      ],
    },
  };

  it('draws on_timeout as a route edge and keeps every boundary field through a save', () => {
    const workflow = aplToWorkflow(boundaries);
    expect(workflow.edges.filter((edge) => edge.source === 'draft').map((edge) => edge.label))
      .toEqual(expect.arrayContaining(['on_error', 'on_timeout']));
    expect(workflow.edges.find((edge) => edge.source === 'review' && edge.label === 'on_timeout')?.target)
      .toBe('done');

    const saved = workflowToAPL(workflow).flow.nodes;
    expect(saved.find((node) => node.id === 'draft')).toMatchObject({
      fallback_models: ['gemini-3.7-flash'],
      on_timeout: { after: 'PT1H', then: 'manual' },
      on_error: 'manual',
      next: 'review',
    });
    expect(saved.find((node) => node.id === 'review')).toMatchObject({
      sla_hours: 4,
      escalate_to: ['managers'],
      on_timeout: { after: 'P3D', then: 'done' },
      next: 'done',
    });
  });

  it('never invents a service level for a task that declares none', () => {
    const manual = workflowToAPL(aplToWorkflow(boundaries)).flow.nodes.find((node) => node.id === 'manual') as
      unknown as Record<string, unknown>;
    expect(manual.sla_hours).toBeUndefined();
  });
});

describe('APL round trip: review outcomes', () => {
  const review: APLDocument = {
    version: 'abada.io/v1',
    metadata: { key: 'review', name: 'Review' },
    flow: {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'webhook', next: 'draft' },
        { id: 'draft', type: 'engine-task', service: 'draft', loop: { max_iterations: 3 }, next: 'review' },
        {
          id: 'review',
          type: 'human-input',
          assignees: ['reviewers'],
          outcomes: { approve: { next: 'done' }, reject: { next: 'draft', comment: 'required' } },
        },
        { id: 'done', type: 'end' },
      ],
    },
  };

  it('draws one edge per outcome and keeps outcomes without inventing a next', () => {
    const workflow = aplToWorkflow(review);
    expect(workflow.edges.filter((edge) => edge.source === 'review').map((edge) => [edge.target, edge.label]))
      .toEqual([['done', 'outcome: approve'], ['draft', 'outcome: reject']]);

    const saved = workflowToAPL(workflow).flow.nodes.find((node) => node.id === 'review') as unknown as
      Record<string, unknown>;
    expect(saved.outcomes).toEqual({ approve: { next: 'done' }, reject: { next: 'draft', comment: 'required' } });
    expect(saved.next).toBeUndefined();
  });
});

describe('APL round trip: tool references', () => {
  it('keeps <server>/<tool> refs and tightened policies through a save', () => {
    const document: APLDocument = {
      version: 'abada.io/v1',
      metadata: { key: 'tools', name: 'Tools' },
      flow: {
        entry: 'start',
        nodes: [
          { id: 'start', type: 'webhook', next: 'triage' },
          {
            id: 'triage',
            type: 'agent',
            model: 'gemini-3.6-flash',
            prompt: 'Triage the request',
            tools: ['crm/get_customer', { ref: 'crm/refund', policy: 'approval_required', approvers: ['finance'] }],
            next: 'done',
          },
          { id: 'done', type: 'end' },
        ],
      },
    };
    const saved = workflowToAPL(aplToWorkflow(document)).flow.nodes.find((node) => node.id === 'triage');
    expect(saved).toMatchObject({
      tools: ['crm/get_customer', { ref: 'crm/refund', policy: 'approval_required', approvers: ['finance'] }],
    });
  });
});

describe('APL round trip: call-process', () => {
  it('keeps the called process, inputs, outputs, depth and routes through a save', () => {
    const document: APLDocument = {
      version: 'abada.io/v1',
      metadata: { key: 'refund', name: 'Refund' },
      flow: {
        entry: 'start',
        nodes: [
          { id: 'start', type: 'webhook', next: 'check' },
          {
            id: 'check',
            type: 'call-process',
            process: 'fraud_check',
            inputs: { case_id: '${case_id}' },
            outputs: { fraud_verdict: 'verdict' },
            max_depth: 2,
            on_error: 'manual',
            on_timeout: { after: 'PT1H', then: 'manual' },
            next: 'done',
          },
          { id: 'manual', type: 'human-input', assignees: ['finance'], next: 'done' },
          { id: 'done', type: 'end' },
        ],
      },
    };
    const workflow = aplToWorkflow(document);
    expect(workflow.nodes.find((node) => node.id === 'check')?.type).toBe('call-process');
    expect(workflow.edges.filter((edge) => edge.source === 'check').map((edge) => edge.label))
      .toEqual(expect.arrayContaining(['on_error', 'on_timeout']));
    const saved = workflowToAPL(workflow).flow.nodes.find((node) => node.id === 'check');
    expect(saved).toMatchObject({
      type: 'call-process',
      process: 'fraud_check',
      inputs: { case_id: '${case_id}' },
      outputs: { fraud_verdict: 'verdict' },
      max_depth: 2,
      on_error: 'manual',
      on_timeout: { after: 'PT1H', then: 'manual' },
      next: 'done',
    });
  });
});
