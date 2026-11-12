import React from 'react';
import { Trash2 } from 'lucide-react';
import type { WorkflowNode } from '@/types';
import { gatewayBranches, setBranchCondition, setBranchElse } from '@/lib/apl/gatewayRules';
import { issuesAt } from '@/lib/apl/issues';
import { kindSpec, type NodeKind } from '@/features/designer/nodes/nodeCatalog';
import { NodeGlyph } from '@/features/designer/nodes/shapes';
import { GatewayBranchesEditor } from './GatewayBranchesEditor';
import { Field, Note, Section } from './InspectorKit';
import { INPUT, MONO_INPUT } from './fieldStyles';
import type { NodeEditorProps } from './nodeEditor';

type CatchKind = 'message' | 'timer' | 'signal';

const CATCH: Record<CatchKind, { label: string; apl: string; placeholder: string; help: string }> = {
  message: {
    label: 'Message name', apl: 'message', placeholder: 'PaymentReceived',
    help: 'The instance waits on a durable subscription until a message with this name is correlated against its correlationKey.',
  },
  timer: {
    label: 'Wait for (ISO-8601 duration)', apl: 'duration', placeholder: 'PT1H',
    help: 'For example PT15M, PT1H or P2D. The durable job scheduler resumes the instance when it elapses.',
  },
  signal: {
    label: 'Signal name', apl: 'signal', placeholder: 'MarketClosed',
    help: 'The instance waits on a durable subscription until this signal is broadcast.',
  },
};

/** Start and end events have nothing to configure beyond their name; say so instead of an empty panel. */
export const PlainEventEditor: React.FC<NodeEditorProps> = ({ node }) => (
  <Note>
    {node.subtype === 'start'
      ? 'A process starts here when it is started through the API or Studio. Its variables are the start payload.'
      : 'A path finishes here. The instance completes when every path has finished.'}
  </Note>
);

/** A catch event: what it waits for. */
export const CatchEventEditor: React.FC<NodeEditorProps> = ({ node, issues, update }) => {
  const kind = node.subtype as CatchKind;
  const spec = CATCH[kind];
  return (
    <Section id="wait" title="Waits for" issues={issuesAt(issues, spec.apl)}>
      <Field label={spec.label} apl={spec.apl} help={spec.help} issues={issuesAt(issues, spec.apl)}>
        <input aria-label={spec.label} value={node.catchEventConfig?.definitionRef ?? ''} placeholder={spec.placeholder}
          className={MONO_INPUT} onChange={(e) => update({ ...node, catchEventConfig: { definitionRef: e.target.value } })} />
      </Field>
    </Section>
  );
};

/** Exclusive, parallel and inclusive gateways: the kind and, when conditional, each branch's condition. */
export const GatewayEditor: React.FC<NodeEditorProps> = ({ node, workflow, update, updateWorkflow, issues }) => {
  const kinds: NodeKind[] = ['exclusive', 'parallel', 'inclusive'];
  const help = node.subtype === 'parallel'
    ? 'Fork: every outgoing flow runs at once. Join: flows converging here wait for each other, then continue along the single outgoing flow.'
    : node.subtype === 'inclusive'
      ? 'Fork: every flow whose condition holds runs; when none does the else flow runs, or the step fails loudly. Join: continues along its single outgoing flow.'
      : 'Conditions are checked in order; the first that holds is taken. The else flow runs when none does.';
  return (
    <Section id="routing" title="Routing" issues={issuesAt(issues, 'rules')}>
      <div role="radiogroup" aria-label="Gateway kind" className="grid grid-cols-3 gap-1.5">
        {kinds.map((kind) => {
          const selected = (node.subtype ?? 'exclusive') === kind;
          return (
            <button key={kind} type="button" role="radio" aria-checked={selected}
              onClick={() => update({ ...node, subtype: kindSpec(kind).subtype })}
              className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] transition-colors duration-[var(--duration-fast)] ${selected
                ? 'border-saffron bg-saffron/10 text-linen' : 'border-hairline bg-charcoal text-sand hover:text-linen'}`}>
              <NodeGlyph kind={kind} size={22} />
              {kindSpec(kind).label.replace(' gateway', '')}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] leading-relaxed text-sand">{help}</p>
      {node.subtype !== 'parallel' && workflow && updateWorkflow && (
        <GatewayBranchesEditor branches={gatewayBranches(workflow, node.id)} nodes={workflow.nodes}
          inclusive={node.subtype === 'inclusive'}
          onConditionChange={(edgeId, condition) => updateWorkflow((wf) => setBranchCondition(wf, edgeId, condition))}
          onElseChange={(edgeId, isElse) => updateWorkflow((wf) => setBranchElse(wf, edgeId, isElse))} />
      )}
    </Section>
  );
};

/**
 * The event gateway: its competing catch events are canvas nodes (gateway →
 * catch → next), so this editor reads and writes the workflow directly.
 */
export const EventGatewayEditor: React.FC<NodeEditorProps> = ({ node, workflow, updateWorkflow, issues }) => {
  if (!workflow || !updateWorkflow) return null;
  const children = workflow.edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => workflow.nodes.find((candidate) => candidate.id === edge.target))
    .filter((child): child is WorkflowNode => !!child && child.type === 'event'
      && (child.subtype === 'message' || child.subtype === 'timer' || child.subtype === 'signal'));
  const childIds = new Set(children.map((child) => child.id));
  const nextOf = (childId: string) => workflow.edges.find((edge) => edge.source === childId)?.target;
  const targets = workflow.nodes.filter((candidate) => candidate.id !== node.id && !childIds.has(candidate.id));
  const ready = children.filter((child) => (child.catchEventConfig?.definitionRef ?? '').trim() && nextOf(child.id)).length;

  const setChild = (childId: string, patch: Partial<WorkflowNode>) => updateWorkflow((wf) => ({
    ...wf, nodes: wf.nodes.map((candidate) => (candidate.id === childId ? { ...candidate, ...patch } : candidate)),
  }));
  const setNext = (childId: string, target: string) => updateWorkflow((wf) => {
    const existing = wf.edges.find((edge) => edge.source === childId);
    if (!target) return { ...wf, edges: wf.edges.filter((edge) => edge.source !== childId) };
    if (existing) return { ...wf, edges: wf.edges.map((edge) => (edge.id === existing.id ? { ...edge, target } : edge)) };
    return { ...wf, edges: [...wf.edges, { id: `e-${Date.now()}`, source: childId, target, label: 'Next' }] };
  });
  const add = (kind: CatchKind) => updateWorkflow((wf) => {
    const childId = `${node.id}_e${Date.now()}`;
    const child: WorkflowNode = {
      id: childId, type: 'event', subtype: kind, title: kindSpec(kind).label, description: '',
      x: node.x + 260, y: node.y + children.length * 84, catchEventConfig: { definitionRef: kind === 'timer' ? 'PT1H' : '' },
    };
    return { ...wf, nodes: [...wf.nodes, child], edges: [...wf.edges, { id: `e-${Date.now()}`, source: node.id, target: childId, label: 'Race' }] };
  });
  const remove = (childId: string) => updateWorkflow((wf) => ({
    ...wf,
    nodes: wf.nodes.filter((candidate) => candidate.id !== childId),
    edges: wf.edges.filter((edge) => edge.source !== childId && edge.target !== childId),
  }));

  return (
    <Section id="events" title={`Competing events · ${children.length}`} issues={issuesAt(issues, 'events')}
      summary="The instance waits on every event below. The first to fire continues; the engine cancels the others in the same transaction.">
      {children.length === 0 && (
        <p className="rounded-lg border border-dashed border-hairline bg-charcoal p-3 text-[11px] leading-relaxed text-sand">
          No competing events yet. Add at least two.
        </p>
      )}
      {children.map((child) => {
        const kind = child.subtype as CatchKind;
        return (
          <div key={child.id} className="space-y-2 rounded-xl border border-hairline bg-charcoal p-3">
            <div className="flex items-center gap-2">
              <NodeGlyph kind={kind} size={20} />
              <select aria-label={`Event kind of ${child.id}`} value={kind} className={INPUT}
                onChange={(e) => setChild(child.id, { subtype: e.target.value as CatchKind, catchEventConfig: { definitionRef: '' } })}>
                <option value="message">Message</option>
                <option value="timer">Timer</option>
                <option value="signal">Signal</option>
              </select>
              <button type="button" onClick={() => remove(child.id)} aria-label="Remove competing event"
                title="Remove this event (deletes its canvas node and flows)"
                className="shrink-0 rounded-lg border border-desert-rose/30 p-1.5 text-desert-rose transition-colors hover:bg-desert-rose/15">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <Field label={CATCH[kind].label} apl={CATCH[kind].apl}>
              <input aria-label={`${CATCH[kind].label} of ${child.id}`} value={child.catchEventConfig?.definitionRef ?? ''}
                placeholder={CATCH[kind].placeholder} className={MONO_INPUT}
                onChange={(e) => setChild(child.id, { catchEventConfig: { definitionRef: e.target.value } })} />
            </Field>
            <Field label="Then continue to" apl="next">
              <select aria-label={`Next of ${child.id}`} value={nextOf(child.id) ?? ''} className={INPUT}
                onChange={(e) => setNext(child.id, e.target.value)}>
                <option value="">Choose the next step (required)</option>
                {targets.map((target) => <option key={target.id} value={target.id}>{target.title || target.id}</option>)}
              </select>
            </Field>
          </div>
        );
      })}
      <div className="flex gap-2">
        {(['message', 'timer', 'signal'] as const).map((kind) => (
          <button key={kind} type="button" onClick={() => add(kind)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline bg-charcoal py-1.5 text-[11px] font-semibold text-linen transition-colors hover:border-saffron">
            <NodeGlyph kind={kind} size={16} /> {kind === 'message' ? 'Message' : kind === 'timer' ? 'Timer' : 'Signal'}
          </button>
        ))}
      </div>
      <p className={`rounded-lg border p-2.5 text-[10px] leading-relaxed ${ready >= 2
        ? 'border-sage-green/30 bg-sage-green/10 text-sage-green' : 'border-desert-rose/30 bg-desert-rose/10 text-desert-rose'}`}>
        {ready >= 2
          ? `Ready: ${ready} events have a name and a next step. The first to fire wins.`
          : `${ready} of ${children.length} events have a name and a next step; the engine needs at least two.`}
      </p>
    </Section>
  );
};
