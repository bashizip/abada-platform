import React from 'react';
import type { CallProcessConfig, ForEachConfig } from '@/types';
import { forEachProblem } from '@/lib/apl/agentFields';
import { issuesAt } from '@/lib/apl/issues';
import { CallProcessEditor } from './AgentEditors';
import { ErrorRoutesEditor, TimeoutEditor } from './RouteEditors';
import { Field, FieldIssues, Note, NumberInput, Section } from './InspectorKit';
import { INPUT, MONO_INPUT, TEXTAREA } from './fieldStyles';
import type { NodeEditorProps } from './nodeEditor';

/** The `on_error` and `on_timeout` boundaries every kind of work shares. */
export const FailureRoutes: React.FC<NodeEditorProps & {
  onError?: Parameters<typeof ErrorRoutesEditor>[0]['value'];
  onTimeout?: Parameters<typeof TimeoutEditor>[0]['value'];
  summary?: string;
}> = ({ node, nodes, issues, routeTo, onError, onTimeout, summary }) => (
  <Section id="failures" title="Errors and timeouts" summary={summary}
    issues={[...issuesAt(issues, 'on_error'), ...issuesAt(issues, 'on_timeout')]}>
    <ErrorRoutesEditor value={onError} nodes={nodes} excludeId={node.id}
      onSetRule={(code, target) => routeTo({ kind: 'error', ...(code ? { code } : {}) }, target)} />
    <TimeoutEditor value={onTimeout} nodes={nodes} excludeId={node.id}
      onChange={(after, target) => routeTo({ kind: 'timeout', after }, target)} />
  </Section>
);

/** An engine task: the topic an external worker picks up. */
export const EngineTaskEditor: React.FC<NodeEditorProps> = (props) => {
  const { node, issues, update } = props;
  const config = node.engineTaskConfig ?? { service: '' };
  return (
    <>
      <Section id="work" title="Work" issues={issuesAt(issues, 'service')}>
        <Field label="Service topic" apl="service" issues={issuesAt(issues, 'service')}
          help="Workers subscribed to this topic acquire the job with a durable lease and report back.">
          <input aria-label="Service topic" value={config.service} placeholder="crm.sync" className={MONO_INPUT}
            onChange={(e) => update({ ...node, engineTaskConfig: { ...config, service: e.target.value } })} />
        </Field>
      </Section>
      <FailureRoutes {...props} onError={config.onError} onTimeout={config.onTimeout}
        summary="Where the instance goes when the worker reports an error or the job takes too long. Without a route a failure opens an incident." />
    </>
  );
};

/** A script: the in-transaction code and its language. */
export const ScriptEditor: React.FC<NodeEditorProps> = ({ node, issues, update }) => {
  const config = node.scriptConfig ?? { script: '', format: 'javascript' };
  return (
    <Section id="script" title="Script" issues={[...issuesAt(issues, 'script'), ...issuesAt(issues, 'format')]}>
      <Note tone="warning">
        Runs inside the workflow transaction, with no CPU limit. Deployable only when the operator enables
        scripts. Prefer a decision table or an engine task for anything slow or external.
      </Note>
      <Field label="Code" apl="script" issues={issuesAt(issues, 'script')}
        help={<>Instance variables are available by name and in the <span className="font-mono text-mineral-teal">variables</span> map; changed values are written back.</>}>
        <textarea aria-label="Script" rows={9} value={config.script} className={`${TEXTAREA} font-mono`}
          placeholder="variables.total = variables.amount * 1.2;"
          onChange={(e) => update({ ...node, scriptConfig: { ...config, script: e.target.value } })} />
      </Field>
      <Field label="Language" apl="format" issues={issuesAt(issues, 'format')}>
        <select aria-label="Script language" value={config.format || 'javascript'} className={INPUT}
          onChange={(e) => update({ ...node, scriptConfig: { ...config, format: e.target.value } })}>
          <option value="javascript">JavaScript</option>
        </select>
      </Field>
    </Section>
  );
};

const DEFAULT_LOOP: ForEachConfig = { items: '', itemInput: 'item', maxItems: 100, results: 'results' };

/** A call process or for each: the child process, its inputs and outputs, and for a for each the list it runs over. */
export const CallProcessNodeEditor: React.FC<NodeEditorProps> = (props) => {
  const { node, issues, update } = props;
  const config: CallProcessConfig = node.callProcessConfig ?? { process: '' };
  const loop = config.forEach;
  const set = (callProcessConfig: CallProcessConfig) => update({ ...node, callProcessConfig });
  const setLoop = (patch: Partial<ForEachConfig>) => set({ ...config, forEach: { ...(loop ?? DEFAULT_LOOP), ...patch } });
  const loopIssues = ['items', 'item_input', 'max_items', 'max_parallel', 'results'].flatMap((key) => issuesAt(issues, key));
  const problem = forEachProblem(config);
  return (
    <>
      {loop && (
        <Section id="for-each" title="For each item" issues={loopIssues}
          summary="One child instance per item, a bounded number at a time. Item values never enter the audit history, only counts.">
          <Field label="Items" apl="items" issues={issuesAt(issues, 'items')} help="An expression that evaluates to a list.">
            <input aria-label="Items" value={loop.items} placeholder="${documents}" className={MONO_INPUT}
              onChange={(e) => setLoop({ items: e.target.value })} />
          </Field>
          <Field label="Each item goes to child variable" apl="item_input" issues={issuesAt(issues, 'item_input')}>
            <input aria-label="Item variable" value={loop.itemInput} placeholder="document" className={MONO_INPUT}
              onChange={(e) => setLoop({ itemInput: e.target.value.trim() })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max items" apl="max_items" issues={issuesAt(issues, 'max_items')} help="A longer list fails before any child starts.">
              <NumberInput label="Max items" value={loop.maxItems} min={1} max={1000} placeholder="100"
                onChange={(value) => setLoop({ maxItems: value ?? 0 })} />
            </Field>
            <Field label="At a time" apl="max_parallel" issues={issuesAt(issues, 'max_parallel')} help="Default 1.">
              <NumberInput label="Max parallel" value={loop.maxParallel} min={1} max={50} placeholder="1"
                onChange={(maxParallel) => setLoop({ maxParallel })} />
            </Field>
          </div>
          <Field label="Results variable" apl="results" issues={issuesAt(issues, 'results')}
            help="Receives one entry per item, in order: { index, ok, outputs } or { index, ok: false, error }.">
            <input aria-label="Results variable" value={loop.results} placeholder="check_results" className={MONO_INPUT}
              onChange={(e) => setLoop({ results: e.target.value.trim() })} />
          </Field>
          {problem && <p className="text-[10px] text-desert-rose">{problem}</p>}
        </Section>
      )}
      <Section id="child" title={loop ? 'Child process per item' : 'Child process'}
        issues={['process', 'inputs', 'outputs', 'max_depth'].flatMap((key) => issuesAt(issues, key))}
        summary={loop
          ? 'Outputs name the fields of each result entry and the child variable each is copied from.'
          : 'The child runs as its own governed instance; only the declared outputs come back.'}>
        <CallProcessEditor config={config} onChange={set} />
        <FieldIssues issues={['process', 'inputs', 'outputs', 'max_depth'].flatMap((key) => issuesAt(issues, key))} />
      </Section>
      <FailureRoutes {...props} onError={config.onError} onTimeout={config.onTimeout}
        summary={loop
          ? 'A failed item is recorded and the others run to the end; then the error route is taken once. Without one an incident opens.'
          : 'Where the instance goes when the child fails or takes too long. Without a route an incident opens.'} />
    </>
  );
};
