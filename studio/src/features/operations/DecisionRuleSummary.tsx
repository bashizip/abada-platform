import React from 'react';
import type { TrailDecision } from '@/lib/run/auditTrail';
import { formatValue } from '@/components/inspector/decisionTable';

/**
 * The rule(s) a decision table applied, as the instance's deployed definition
 * declares them: the condition and the outputs it set. Inputs are listed by
 * name only, because the engine never records their values.
 */
export const DecisionRuleSummary: React.FC<{ decision: TrailDecision; className?: string }> = ({ decision, className }) => (
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
    {decision.inputNames.length > 0 && (
      <p className="text-[10px] text-sand">
        Read <span className="font-mono text-linen">{decision.inputNames.join(', ')}</span>; input values are not recorded.
      </p>
    )}
  </div>
);
