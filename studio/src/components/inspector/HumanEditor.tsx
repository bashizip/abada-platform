import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { HumanConfig } from '@/types';
import { FormPicker } from '@/components/FormPicker';
import { issuesAt } from '@/lib/apl/issues';
import { NameListEditor, OutcomesEditor, RouteSelect, TimeoutEditor } from './RouteEditors';
import { Field, Note, NumberInput, Section } from './InspectorKit';
import { INPUT, MONO_INPUT } from './fieldStyles';
import type { NodeEditorProps } from './nodeEditor';

/** A human task: who does it, with which form, by when, and the decisions they can take. */
export const HumanEditor: React.FC<NodeEditorProps> = ({
  node, nodes, issues, update, routeTo, commitWithRoutes, nextTarget, projectId,
}) => {
  const config = node.humanConfig!;
  const set = (patch: Partial<HumanConfig>) => update({ ...node, humanConfig: { ...config, ...patch } });
  const isGate = config.kind === 'approval-gate';
  const reservedSignOff = node.aplExtras && 'requireDoubleSignOff' in node.aplExtras;
  return (
    <>
      {isGate && (
        <Note tone="warning">
          <p>
            Saved as <code className="font-mono">approval-gate</code>, a deprecated alias of a human task that cannot
            take a form. It still deploys.
          </p>
          <button type="button" onClick={() => set({ kind: undefined })}
            className="mt-1.5 rounded-md border border-hairline bg-mocha px-2 py-1 text-[10px] font-semibold text-linen hover:bg-mocha-hover">
            Convert to a human task
          </button>
        </Note>
      )}
      <Section id="assignment" title="Assignment"
        issues={['assignees', 'mode', 'formKey', 'formId'].flatMap((key) => issuesAt(issues, key))}>
        <Field label="Who can claim it" apl="assignees" issues={issuesAt(issues, 'assignees')}
          help="Groups or users; at least one.">
          <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-charcoal">
            {config.assignees.map((assignee, index) => (
              <div key={index} className="group flex items-center gap-1.5 px-2 py-1.5">
                <input aria-label={`Assignee ${index + 1}`} value={assignee} placeholder="risk-officers" className={MONO_INPUT}
                  onChange={(e) => set({ assignees: config.assignees.map((value, at) => (at === index ? e.target.value : value)) })} />
                <button type="button" aria-label={`Remove assignee ${index + 1}`} title="Remove assignee"
                  className="shrink-0 text-sand opacity-0 transition-opacity hover:text-desert-rose group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => set({ assignees: config.assignees.filter((_, at) => at !== index) })}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => set({ assignees: [...config.assignees, ''] })}
              className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-medium text-desert-rose hover:text-desert-rose-bright">
              <Plus className="h-3 w-3" /> Add assignee
            </button>
          </div>
        </Field>
        {config.assignees.length > 1 && (
          <Field label="Several assignees" apl="mode" issues={issuesAt(issues, 'mode')}
            help="A hint for people reading the process; the engine does not enforce serial or parallel sign-off.">
            <select aria-label="Assignment mode" value={config.mode ?? ''} className={INPUT}
              onChange={(e) => set({ mode: (e.target.value || undefined) as HumanConfig['mode'] })}>
              <option value="">Not stated</option>
              <option value="serial">One after another</option>
              <option value="parallel">At the same time</option>
            </select>
          </Field>
        )}
        {!isGate && (
          <Field label="Form" apl="formKey" issues={[...issuesAt(issues, 'formKey'), ...issuesAt(issues, 'formId')]}>
            <FormPicker projectId={projectId} value={config.formKey} onChange={(formKey) => set({ formKey })} />
          </Field>
        )}
        {reservedSignOff && (
          <Note><code className="font-mono">requireDoubleSignOff</code> is kept as written; it is reserved and has no effect at run time.</Note>
        )}
      </Section>

      <Section id="decisions" title="Decisions" issues={issuesAt(issues, 'outcomes')}
        summary="The choices a reviewer has. Each leads somewhere and may require a comment; without outcomes the task simply continues.">
        <OutcomesEditor outcomes={config.outcomes} nextTarget={nextTarget} nodes={nodes} excludeId={node.id}
          onChange={(outcomes) => commitWithRoutes({ ...node, humanConfig: { ...config, outcomes } }, !!outcomes)} />
      </Section>

      <Section id="deadline" title="Deadline and escalation"
        issues={['sla_hours', 'escalate_to', 'on_timeout', 'on_error'].flatMap((key) => issuesAt(issues, key))}>
        <Field label="Service level (hours)" apl="sla_hours" issues={issuesAt(issues, 'sla_hours')}
          help="Past it the open task is escalated in place: it stays open and the groups below become candidates.">
          <NumberInput label="SLA hours" value={config.slaHours} min={0} placeholder="No service level"
            onChange={(slaHours) => set({ slaHours, escalateTo: slaHours ? config.escalateTo : undefined })} />
        </Field>
        <NameListEditor label="Escalate to (groups added when the SLA is missed)" value={config.escalateTo ?? []}
          placeholder={config.slaHours ? 'managers' : 'Set a service level first'} disabled={!config.slaHours}
          onChange={(escalateTo) => set({ escalateTo: escalateTo.length ? escalateTo : undefined })} />
        <TimeoutEditor value={config.onTimeout} nodes={nodes} excludeId={node.id}
          onChange={(after, target) => routeTo({ kind: 'timeout', after }, target)} />
        <RouteSelect label="If the task is failed (on_error)"
          value={typeof config.onError === 'string' ? config.onError : undefined}
          nodes={nodes} excludeId={node.id} onChange={(target) => routeTo({ kind: 'error' }, target)} />
      </Section>
    </>
  );
};
