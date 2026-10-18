import React, { useState } from 'react';
import type { TrailDecision } from '@/lib/run/auditTrail';
import { formatValue } from '@/components/inspector/decisionTable';
import { EvidenceAPI, type DecisionInputs } from '@/api/evidence';

const inputValue = (value: unknown): string =>
  typeof value === 'string' ? value : value === undefined ? '—' : JSON.stringify(value);

/**
 * The rule(s) a decision table applied, as the instance's deployed definition
 * declares them: the condition and the outputs it set. The values the table
 * read are evidence: kept under the project's evidence policy and opened on
 * demand by evidence readers, each read recorded in the instance history.
 * History recorded before they were kept lists the inputs by name only.
 */
export const DecisionRuleSummary: React.FC<{
  decision: TrailDecision;
  projectId?: string;
  instanceId?: string;
  className?: string;
}> = ({ decision, projectId, instanceId, className }) => {
  const [inputs, setInputs] = useState<DecisionInputs | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const readable = !!(decision.evidenceId && projectId && instanceId);

  const showInputs = async () => {
    if (!decision.evidenceId || !projectId || !instanceId) return;
    setLoading(true);
    setDenied(null);
    try {
      setInputs(await EvidenceAPI.decisionInputs(projectId, instanceId, decision.evidenceId));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setDenied(message.startsWith('403')
        ? 'Reading input values needs the abada-evidence-reader role (or the agent-evidence:read scope).'
        : message.startsWith('410') ? 'These input values were purged after the retention period.' : message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`space-y-1.5 ${className ?? ''}`} aria-label="Decision">
      {decision.rules.length === 0 && <p className="text-[10px] text-sand">No rule matched.</p>}
      {decision.rules.map((rule) => (
        <div key={rule.number} className="rounded-lg border border-mineral-teal/30 bg-charcoal p-2 text-[10px]">
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-mono font-semibold text-mineral-teal">Rule {rule.number}</span>
            {rule.otherwise
              ? <span className="text-sand">otherwise · no other rule matched</span>
              : <span className="min-w-0 break-words font-mono text-linen"><span className="text-sand">when </span>{rule.when ?? '—'}</span>}
          </p>
          {Object.keys(rule.then).length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1" aria-label={`Outputs of rule ${rule.number}`}>
              {Object.entries(rule.then).map(([name, value]) => (
                <li key={name} className="rounded border border-hairline bg-mocha px-1.5 py-0.5 font-mono text-linen">
                  <span className="text-sand">{name} = </span>{formatValue(value)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {decision.inputNames.length > 0 && !readable && (
        <p className="text-[10px] text-sand">
          Read <span className="font-mono text-linen">{decision.inputNames.join(', ')}</span>; input values are not recorded.
        </p>
      )}
      {decision.inputNames.length > 0 && readable && !inputs && (
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-[10px] text-sand">
          <span>Read <span className="font-mono text-linen">{decision.inputNames.join(', ')}</span></span>
          <button type="button" onClick={() => void showInputs()} disabled={loading}
            className="underline hover:text-linen disabled:opacity-60">
            {loading ? 'Loading input values…' : 'Show input values'}
          </button>
        </p>
      )}
      {denied && <p className="text-[10px] text-saffron" role="alert">{denied}</p>}
      {inputs && (inputs.payloadMode === 'none' || !inputs.inputs ? (
        <p className="text-[10px] text-sand">
          Read <span className="font-mono text-linen">{decision.inputNames.join(', ')}</span>; this project keeps
          no input values (evidence policy: none).
        </p>
      ) : (
        <div className="text-[10px]">
          <ul className="flex flex-wrap gap-1" aria-label="Input values">
            {Object.entries(inputs.inputs).map(([name, value]) => (
              <li key={name} className="rounded border border-hairline bg-mocha px-1.5 py-0.5 font-mono text-linen">
                <span className="text-sand">{name} = </span>{inputValue(value)}
              </li>
            ))}
          </ul>
          {inputs.redacted && <p className="mt-1 text-sand">Sensitive values are redacted.</p>}
        </div>
      ))}
    </div>
  );
};
