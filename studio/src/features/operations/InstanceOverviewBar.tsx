import React from 'react';
import { Clock, Sparkles, User } from 'lucide-react';
import { ProcessInstanceDTO } from '@/api/engine';
import { formatUsd } from '@/api/evidence';
import { InstanceStatePill } from '@/features/operations/InstanceStatePill';
import {
  deriveBusinessLabel,
  formatDuration,
  formatWhen,
  humanize,
  instanceDurationMs,
} from '@/lib/run/instanceFormat';

interface InstanceOverviewBarProps {
  instance: ProcessInstanceDTO;
  definitionVersion?: string;
}

const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <span className="text-[9px] font-semibold uppercase tracking-wider text-sand/80">{label}</span>
    <span className="min-w-0 truncate text-[11px] text-linen">{children}</span>
  </div>
);

/**
 * Bottom panel shown while a live instance is open on the canvas: instance-wide
 * identity and lifecycle details. The right-side inspector is reserved for
 * per-node telemetry and execution context.
 */
export const InstanceOverviewBar: React.FC<InstanceOverviewBarProps> = ({
  instance,
  definitionVersion,
}) => {
  const { label, source } = deriveBusinessLabel(instance);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t border-hairline bg-mocha px-4 py-2.5">
      <div className="flex items-center gap-3">
        <InstanceStatePill instance={instance} />
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-amethyst" />
          <span className="truncate text-xs font-semibold text-linen">{label}</span>
          {source && (
            <span className="shrink-0 rounded border border-amethyst/30 bg-amethyst/10 px-1.5 py-px text-[9px] font-medium text-amethyst">
              business key
            </span>
          )}
        </div>
        <span className="hidden font-mono text-[10px] text-sand md:inline">{instance.id}</span>
      </div>

      <div className="hidden h-8 w-px bg-hairline sm:block" />

      <Stat label="Definition">
        {instance.processDefinitionName || instance.processDefinitionId}
        {definitionVersion ? <span className="text-amethyst"> · v{definitionVersion}</span> : null}
      </Stat>

      <Stat label="Current activity">
        {instance.currentActivityId ? humanize(instance.currentActivityId) : '—'}
      </Stat>

      <Stat label="Duration">
        <span className="flex items-center gap-1 font-mono text-saffron">
          <Clock className="h-3 w-3" /> {formatDuration(instanceDurationMs(instance))}
        </span>
      </Stat>

      <Stat label="Started">
        <span className="font-mono">{formatWhen(instance.startDate)}</span>
      </Stat>

      <Stat label="Started by">
        <span className="flex items-center gap-1">
          <User className="h-3 w-3 text-sand" /> {instance.startedBy || 'system'}
        </span>
      </Stat>

      <Stat label="Ended">
        {instance.endDate ? <span className="font-mono">{formatWhen(instance.endDate)}</span> : '—'}
      </Stat>

      {instance.agentCost && (
        <Stat label="Agent cost">
          <span className="font-mono" title={`${instance.agentCost.promptTokens} prompt + ${instance.agentCost.completionTokens} completion tokens`}>
            {formatUsd(instance.agentCost.usd)}
            {instance.agentCost.includesUnpriced && (
              <span className="ml-1 text-saffron" title="Some calls use a model without a price; the real cost is higher">+ unpriced</span>
            )}
            <span className="ml-1 text-sand">· {(instance.agentCost.promptTokens + instance.agentCost.completionTokens).toLocaleString()} tokens</span>
          </span>
        </Stat>
      )}

      <Stat label="Suspended">
        <span className={instance.suspended ? 'text-saffron' : 'text-sage-green'}>
          {instance.suspended ? 'Yes' : 'No'}
        </span>
      </Stat>
    </div>
  );
};
