import React from 'react';
import { Clock, Sparkles, User } from 'lucide-react';
import { ProcessInstanceDTO } from '@/api/engine';
import { StatusBadge } from '@/features/operations/ProcessOperations';
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
    <span className="text-[9px] font-semibold uppercase tracking-wider text-[#A89F91]/80">{label}</span>
    <span className="min-w-0 truncate text-[11px] text-[#EAE3D9]">{children}</span>
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
    <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#3A322E] bg-[#25201D] px-4 py-2.5">
      <div className="flex items-center gap-3">
        <StatusBadge instance={instance} />
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#9D4EDD]" />
          <span className="truncate text-xs font-semibold text-[#EAE3D9]">{label}</span>
          {source && (
            <span className="shrink-0 rounded border border-[#9D4EDD]/30 bg-[#9D4EDD]/10 px-1.5 py-px text-[9px] font-medium text-[#9D4EDD]">
              business key
            </span>
          )}
        </div>
        <span className="hidden font-mono text-[10px] text-[#A89F91] md:inline">{instance.id}</span>
      </div>

      <div className="hidden h-8 w-px bg-[#3A322E] sm:block" />

      <Stat label="Definition">
        {instance.processDefinitionName || instance.processDefinitionId}
        {definitionVersion ? <span className="text-[#9D4EDD]"> · v{definitionVersion}</span> : null}
      </Stat>

      <Stat label="Current activity">
        {instance.currentActivityId ? humanize(instance.currentActivityId) : '—'}
      </Stat>

      <Stat label="Duration">
        <span className="flex items-center gap-1 font-mono text-[#F4A261]">
          <Clock className="h-3 w-3" /> {formatDuration(instanceDurationMs(instance))}
        </span>
      </Stat>

      <Stat label="Started">
        <span className="font-mono">{formatWhen(instance.startDate)}</span>
      </Stat>

      <Stat label="Started by">
        <span className="flex items-center gap-1">
          <User className="h-3 w-3 text-[#A89F91]" /> {instance.startedBy || 'system'}
        </span>
      </Stat>

      <Stat label="Ended">
        {instance.endDate ? <span className="font-mono">{formatWhen(instance.endDate)}</span> : '—'}
      </Stat>

      <Stat label="Suspended">
        <span className={instance.suspended ? 'text-[#F4A261]' : 'text-[#90A955]'}>
          {instance.suspended ? 'Yes' : 'No'}
        </span>
      </Stat>
    </div>
  );
};
