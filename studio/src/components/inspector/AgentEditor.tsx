import React from 'react';
import { Plus, ShieldAlert, Trash2 } from 'lucide-react';
import type { AgentConfig, AgentEvidence } from '@/types';
import { agentModelOptions, getDefaultAgentModel } from '@/lib/agentModels';
import { useAplContract } from '@/lib/aplContract';
import { issuesAt } from '@/lib/apl/issues';
import { AgentRoutesEditor, ErrorRoutesEditor, OrderedPickList, RouteSelect, TimeoutEditor } from './RouteEditors';
import { AgentToolsEditor } from './AgentToolsEditor';
import { AgentLimitsEditor, DelegatesEditor, ReviewedByEditor } from './AgentEditors';
import { Field, Note, NumberInput, Section } from './InspectorKit';
import { INPUT, MONO_INPUT, TEXTAREA } from './fieldStyles';
import type { NodeEditorProps } from './nodeEditor';

/** An agent: the model and prompt, the contract the engine enforces, its routes, limits and evidence. */
export const AgentEditor: React.FC<NodeEditorProps> = ({
  node, nodes, issues, update, routeTo, commitWithRoutes, nextTarget, projectId,
}) => {
  const contract = useAplContract();
  const config = node.agentConfig!;
  const bound = (field: string, side: 'min' | 'max', fallback: number): number =>
    contract?.agentBounds[field]?.[side] ?? fallback;
  const set = <K extends keyof AgentConfig>(field: K, value: AgentConfig[K]) =>
    update({ ...node, agentConfig: { ...config, [field]: value } });

  // The engine's allowed models, joined by the current one when it is not among them.
  const currentModel = config.model || getDefaultAgentModel();
  const allowedModels = agentModelOptions(contract?.allowedAgentModels ?? []);
  const modelOptions = allowedModels.includes(currentModel) ? allowedModels : [currentModel, ...allowedModels];
  const inputs = config.inputs ?? {};
  const evidence = config.evidence ?? {};
  const setEvidence = (patch: Partial<AgentEvidence>) => {
    const next = { ...evidence, ...patch };
    const empty = next.payloads === undefined && next.retentionDays === undefined;
    set('evidence', empty ? undefined : next);
  };

  return (
    <>
      <Section id="model" title="Model and prompt" issues={[...issuesAt(issues, 'model'), ...issuesAt(issues, 'prompt'), ...issuesAt(issues, 'temperature')]}>
        <Field label="Model" apl="model" issues={issuesAt(issues, 'model')}
          help="Only models the engine allows are listed; a model already in the YAML stays selected.">
          <select aria-label="Model" value={currentModel} onChange={(e) => set('model', e.target.value)} className={INPUT}>
            {modelOptions.map((model) => (
              <option key={model} value={model}>{model}{model === getDefaultAgentModel() ? ' (default)' : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Prompt" apl="prompt" issues={issuesAt(issues, 'prompt')}>
          <textarea aria-label="Prompt" rows={5} value={config.systemPrompt} className={`${TEXTAREA} font-mono`}
            placeholder="Read the claim and decide whether it needs a human review."
            onChange={(e) => set('systemPrompt', e.target.value)} />
        </Field>
        <Field label={`Temperature · ${config.temperature}`} apl="temperature" issues={issuesAt(issues, 'temperature')}
          help="Lower is more repeatable.">
          <input type="range" aria-label="Temperature" min={bound('temperature', 'min', 0)} max={bound('temperature', 'max', 2)}
            step="0.05" value={config.temperature} onChange={(e) => set('temperature', Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer rounded-lg bg-charcoal accent-saffron" />
        </Field>
        <Field label="Worker profile" apl="profile">
          <div className="flex items-center gap-2 rounded-lg border border-hairline bg-charcoal px-2.5 py-1.5 text-xs">
            <span className="font-mono text-linen">{config.profileVersion || 'abada.agent/v1'}</span>
            <span className="text-[10px] text-sand">the only supported profile</span>
          </div>
        </Field>
      </Section>

      <Section id="contract" title="Output contract"
        summary="What the engine checks before a result enters the process. The model never writes state directly."
        issues={['confidence_threshold', 'inputs', 'result_variable', 'output_schema'].flatMap((key) => issuesAt(issues, key))}>
        <div className="space-y-2 rounded-xl border border-amethyst/30 bg-charcoal p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 font-medium text-linen">
              <ShieldAlert className="h-3.5 w-3.5 text-amethyst" aria-hidden="true" />
              Confidence threshold
            </span>
            <span className="font-mono font-bold text-amethyst">{config.confidenceThreshold}%</span>
          </div>
          <input type="range" aria-label="Confidence threshold" min={bound('confidence_threshold', 'min', 0)}
            max={bound('confidence_threshold', 'max', 100)} value={config.confidenceThreshold ?? 0}
            onChange={(e) => set('confidenceThreshold', Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer rounded-lg bg-mocha accent-amethyst" />
          <p className="text-[10px] leading-relaxed text-sand">
            {config.confidenceThreshold
              ? <>The model must report <code>_confidence</code> of at least <strong className="text-amethyst">{config.confidenceThreshold}%</strong> (declare an output schema). A missing or lower score takes the low-confidence route; without one the attempt is retried and then becomes an incident.</>
              : <>0% means no confidence gate.</>}
          </p>
        </div>
        <Field label="Prompt inputs" apl="inputs" issues={issuesAt(issues, 'inputs')}
          help={<>Named expressions bound into the prompt, e.g. <span className="font-mono text-amethyst">{'${payload}'}</span>.</>}>
          <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-charcoal">
            {Object.entries(inputs).map(([name, expr]) => (
              <div key={name} className="group flex items-center gap-1.5 px-2 py-1.5">
                <input aria-label={`Input name ${name}`} value={name} className={`${MONO_INPUT} w-28`}
                  onChange={(e) => {
                    const next = { ...inputs };
                    delete next[name];
                    set('inputs', { ...next, [e.target.value]: expr });
                  }} />
                <input aria-label={`Input expression ${name}`} value={expr} placeholder="${payload}" className={MONO_INPUT}
                  onChange={(e) => set('inputs', { ...inputs, [name]: e.target.value })} />
                <button type="button" aria-label={`Remove input ${name}`} title="Remove input"
                  className="shrink-0 text-sand opacity-0 transition-opacity hover:text-desert-rose group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => {
                    const next = { ...inputs };
                    delete next[name];
                    set('inputs', Object.keys(next).length ? next : undefined);
                  }}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button type="button" className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-medium text-amethyst hover:text-amethyst-bright"
              onClick={() => {
                let name = 'input';
                for (let n = 2; name in inputs; n++) name = `input_${n}`;
                set('inputs', { ...inputs, [name]: '${payload}' });
              }}>
              <Plus className="h-3 w-3" /> Add input
            </button>
          </div>
        </Field>
        <Field label="Result variable" apl="result_variable" issues={issuesAt(issues, 'result_variable')}
          help="Where the checked result is written. Empty uses the engine default.">
          <input aria-label="Result variable" placeholder={`${node.id}_result`} value={config.resultVariable ?? ''}
            className={MONO_INPUT} onChange={(e) => set('resultVariable', e.target.value || undefined)} />
        </Field>
        <Field label="Output schema (JSON)" apl="output_schema" issues={issuesAt(issues, 'output_schema')}
          help="The JSON shape every result must match before it is stored.">
          <textarea key={node.id} aria-label="Output schema" rows={4} className={`${TEXTAREA} font-mono text-[10px]`}
            defaultValue={JSON.stringify(config.outputSchema ?? {}, null, 2)} placeholder='{"type": "object"}'
            onChange={(e) => {
              try {
                set('outputSchema', e.target.value.trim() ? JSON.parse(e.target.value) : undefined);
              } catch {
                // Keep the last valid schema while the JSON is being typed.
              }
            }} />
        </Field>
      </Section>

      <Section id="routing" title="Routing"
        summary="Where the instance goes when the engine rejects a result. Without a route a rejected result counts as a failed attempt."
        issues={['routes', 'on_low_confidence', 'on_invalid_output'].flatMap((key) => issuesAt(issues, key))}>
        <AgentRoutesEditor routes={config.routes} nextTarget={nextTarget} nodes={nodes} excludeId={node.id}
          onChange={(routes) => commitWithRoutes({ ...node, agentConfig: { ...config, routes } }, !!routes)} />
        <RouteSelect label="Low confidence (on_low_confidence)" value={config.onLowConfidence}
          nodes={nodes} excludeId={node.id} onChange={(target) => routeTo({ kind: 'low_confidence' }, target)} />
        <RouteSelect label="Invalid output (on_invalid_output)" value={config.onInvalidOutput}
          nodes={nodes} excludeId={node.id} onChange={(target) => routeTo({ kind: 'invalid_output' }, target)} />
      </Section>

      <Section id="failures" title="Retries, errors and timeouts"
        issues={['on_error', 'on_timeout', 'fallback_models', 'max_attempts', 'retry_backoff_ms', 'timeout_ms', 'max_tokens']
          .flatMap((key) => issuesAt(issues, key))}>
        <ErrorRoutesEditor value={config.onError} nodes={nodes} excludeId={node.id}
          onSetRule={(code, target) => routeTo({ kind: 'error', ...(code ? { code } : {}) }, target)} />
        <TimeoutEditor value={config.onTimeout} nodes={nodes} excludeId={node.id}
          onChange={(after, target) => routeTo({ kind: 'timeout', after }, target)} />
        <OrderedPickList label="Fallback models (only while the model before is rate-limited or unavailable)"
          value={config.fallbackModels ?? []} options={allowedModels.filter((model) => model !== currentModel)} max={3}
          onChange={(fallbackModels) => set('fallbackModels', fallbackModels.length ? fallbackModels : undefined)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max attempts" apl="max_attempts" help="Durable retries before the step fails.">
            <NumberInput label="Max attempts" value={config.maxAttempts} min={bound('max_attempts', 'min', 1)}
              max={bound('max_attempts', 'max', 20)} onChange={(value) => set('maxAttempts', value)} />
          </Field>
          <Field label="Retry pause (ms)" apl="retry_backoff_ms" help="Default 2 000.">
            <NumberInput label="Retry backoff" value={config.retryBackoffMs} step={100} placeholder="2000"
              min={bound('retry_backoff_ms', 'min', 0)} max={bound('retry_backoff_ms', 'max', 3600000)}
              onChange={(value) => set('retryBackoffMs', value)} />
          </Field>
          <Field label="Call timeout (ms)" apl="timeout_ms" help="Default 60 000.">
            <NumberInput label="Timeout" value={config.timeoutMs} step={1000} placeholder="60000"
              min={bound('timeout_ms', 'min', 1)} max={bound('timeout_ms', 'max', 3600000)}
              onChange={(value) => set('timeoutMs', value)} />
          </Field>
          <Field label="Max tokens per call" apl="max_tokens">
            <NumberInput label="Max tokens" value={config.maxTokens} min={bound('max_tokens', 'min', 1)}
              max={bound('max_tokens', 'max', 1000000)} onChange={(value) => set('maxTokens', value)} />
          </Field>
        </div>
      </Section>

      <Section id="tools" title="Tools and limits" defaultOpen={false}
        issues={['tools', 'max_turns', 'max_tokens_total', 'budget_usd'].flatMap((key) => issuesAt(issues, key))}>
        <AgentToolsEditor projectId={projectId} tools={config.tools ?? []} onChange={(tools) => set('tools', tools)} />
        <AgentLimitsEditor limits={{ maxTurns: config.maxTurns, maxTokensTotal: config.maxTokensTotal, budgetUsd: config.budgetUsd }}
          onChange={(patch) => update({ ...node, agentConfig: { ...config, ...patch } })} />
      </Section>

      <Section id="review" title="Review and delegation" defaultOpen={false}
        issues={['reviewed_by', 'delegates'].flatMap((key) => issuesAt(issues, key))}>
        <ReviewedByEditor
          reviewers={nodes.filter((candidate) => candidate.type === 'human' && candidate.humanConfig?.outcomes
            && Object.keys(candidate.humanConfig.outcomes).length > 0)
            .map((candidate) => ({ id: candidate.id, label: candidate.title || candidate.id,
              outcomes: Object.keys(candidate.humanConfig!.outcomes!) }))}
          value={config.reviewedBy} onChange={(reviewedBy) => set('reviewedBy', reviewedBy)} />
        <DelegatesEditor delegates={config.delegates ?? []} onChange={(delegates) => set('delegates', delegates)} />
      </Section>

      <Section id="evidence" title="Evidence" defaultOpen={false} issues={issuesAt(issues, 'evidence')}
        summary="What the step journal keeps of this agent's prompts, tool arguments and results. A node can only tighten the project's evidence policy: the engine applies the stricter of the two.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payloads" apl="evidence.payloads">
            <select aria-label="Evidence payloads" value={evidence.payloads ?? ''} className={INPUT}
              onChange={(e) => setEvidence({ payloads: (e.target.value || undefined) as AgentEvidence['payloads'] })}>
              <option value="">Project policy</option>
              <option value="none">None</option>
              <option value="redacted">Redacted</option>
              <option value="full">Full</option>
            </select>
          </Field>
          <Field label="Keep for (days)" apl="evidence.retention_days">
            <NumberInput label="Evidence retention days" value={evidence.retentionDays} min={1} max={3650}
              placeholder="Project policy" onChange={(retentionDays) => setEvidence({ retentionDays })} />
          </Field>
        </div>
        {evidence.payloads === 'full' && (
          <Note tone="warning">Full keeps prompts and results as sent (encrypted at rest). It takes effect only when the project policy is also full.</Note>
        )}
      </Section>
    </>
  );
};
