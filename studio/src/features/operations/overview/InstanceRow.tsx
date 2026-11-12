import React from 'react';
import { ArrowUpRight, Braces, OctagonX, PauseCircle, PlayCircle, XCircle } from 'lucide-react';
import type { ProcessInstanceDTO } from '@/api/engine';
import { deriveBusinessLabel, formatDuration, humanize, instanceDurationMs, statusOf } from '@/lib/run/instanceFormat';
import { InstanceStatePill } from '../InstanceStatePill';

export const ROW_HEIGHT = 52;
/** State · instance · process · now at · duration · started · actions. */
export const ROW_GRID = 'grid grid-cols-[112px_minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.5fr)_88px_120px_120px] items-center gap-3 px-4';

export type RowAction = 'open' | 'canvas' | 'variables' | 'suspend' | 'resume' | 'cancel' | 'fail';

const startedAgo = (iso: string, now: number): string => {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

const ActionButton: React.FC<{ label: string; onClick: () => void; children: React.ReactNode; tone?: 'danger' | 'warn' }> = ({
  label, onClick, children, tone,
}) => (
  <button type="button" aria-label={label} title={label}
    onClick={(event) => { event.stopPropagation(); onClick(); }}
    className={`flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-charcoal text-sand transition-colors hover:border-hairline-strong ${
      tone === 'danger' ? 'hover:text-desert-rose' : tone === 'warn' ? 'hover:text-saffron' : 'hover:text-linen'}`}>
    {children}
  </button>
);

/** One instance in the Operations list. Actions show on hover or on the keyboard cursor. */
export const InstanceRow = React.memo<{
  instance: ProcessInstanceDTO;
  index: number;
  process: { name: string; version: string };
  hasIncident: boolean;
  cursor: boolean;
  canOperate: boolean;
  now: number;
  onAction: (action: RowAction, instance: ProcessInstanceDTO, index: number) => void;
}>(({ instance, index, process, hasIncident, cursor, canOperate, now, onAction }) => {
  const status = statusOf(instance);
  const { label } = deriveBusinessLabel(instance);
  const step = instance.currentActivityId ? humanize(instance.currentActivityId) : null;
  const act = (action: RowAction) => onAction(action, instance, index);
  return (
    <div role="listitem" aria-current={cursor ? 'true' : undefined} onClick={() => act('open')}
      style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
      className={`group absolute inset-x-0 cursor-pointer border-b border-hairline/50 transition-colors duration-150 ${ROW_GRID} ${
        cursor ? 'bg-mocha shadow-[inset_2px_0_0_var(--color-saffron)]' : 'hover:bg-mocha-hover/60'}`}>
      <span><InstanceStatePill instance={instance} incident={hasIncident} /></span>
      <button type="button" onClick={(event) => { event.stopPropagation(); act('open'); }}
        className="min-w-0 text-left focus-visible:outline-none" title={`Open ${label}`}>
        <span className="block truncate text-[13px] font-semibold text-linen">{label}</span>
        <span className="block truncate font-mono text-[10.5px] text-sand">{instance.id}</span>
      </button>
      <span className="truncate text-xs text-linen-muted">
        {process.name}
        {process.version && (
          <span className="ml-1.5 rounded border border-amethyst/35 px-1 text-[10px] text-amethyst-light">{process.version}</span>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-sand">
        {status === 'RUNNING' && (
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasIncident ? 'bg-desert-rose' : 'bg-amethyst abada-live-outline'}`} />
        )}
        {status === 'RUNNING' ? <span className={`truncate ${hasIncident ? 'text-desert-rose' : ''}`}>{step ?? 'Waiting on a token'}</span>
          : status === 'FAILED' ? <span className="truncate text-desert-rose">{step ?? 'Failed'}</span>
            : status === 'SUSPENDED' ? <span className="truncate">paused{step ? ` at ${step}` : ''}</span>
              : <span className="text-sand">—</span>}
      </span>
      <span className="font-mono text-[11.5px] tabular-nums text-sand">{formatDuration(instanceDurationMs(instance))}</span>
      <span className="min-w-0 text-[11.5px] text-linen-muted">
        {startedAgo(instance.startDate, now)}
        <span className="block truncate text-[10.5px] text-sand">{instance.startedBy ? `by ${instance.startedBy}` : ' '}</span>
      </span>
      <span className={`flex justify-end gap-1 transition-opacity duration-150 ${cursor ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
        <ActionButton label="Open on the canvas" onClick={() => act('canvas')}><ArrowUpRight className="h-3.5 w-3.5" /></ActionButton>
        <ActionButton label="Variables" onClick={() => act('variables')}><Braces className="h-3.5 w-3.5" /></ActionButton>
        {canOperate && status === 'RUNNING' && (
          <>
            <ActionButton label="Suspend" tone="warn" onClick={() => act('suspend')}><PauseCircle className="h-3.5 w-3.5" /></ActionButton>
            <ActionButton label="Cancel" tone="danger" onClick={() => act('cancel')}><XCircle className="h-3.5 w-3.5" /></ActionButton>
            <ActionButton label="Force fail" tone="danger" onClick={() => act('fail')}><OctagonX className="h-3.5 w-3.5" /></ActionButton>
          </>
        )}
        {canOperate && status === 'SUSPENDED' && (
          <ActionButton label="Resume" onClick={() => act('resume')}><PlayCircle className="h-3.5 w-3.5" /></ActionButton>
        )}
      </span>
    </div>
  );
});
InstanceRow.displayName = 'InstanceRow';
