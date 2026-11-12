import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, Download, PauseCircle, PlayCircle, XCircle } from 'lucide-react';
import type { IncidentDTO, ProcessDefinitionDTO, ProcessInstanceDTO } from '@/api/engine';
import { PlaybackControl } from '@/components/PlaybackControl';
import { UITooltip } from '@/components/ui';
import type { PlaybackPace } from '@/lib/run/playbackPace';
import { deriveBusinessLabel, formatDuration, humanize, statusOf } from '@/lib/run/instanceFormat';
import { InstanceStatePill } from '../InstanceStatePill';

/** Elapsed time, ticking once a second on its own so the rest of the view does not re-render with it. */
export const ElapsedTicker: React.FC<{ startDate: string; endDate?: string | null }> = ({ startDate, endDate }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endDate) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [endDate]);
  const start = new Date(startDate).getTime();
  const ms = endDate ? new Date(endDate).getTime() - start : Math.max(0, now - start);
  return <span className="font-mono tabular-nums">{formatDuration(ms)}</span>;
};

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex min-w-0 flex-col leading-tight">
    <span className="text-[9.5px] uppercase tracking-[0.12em] text-sand">{label}</span>
    <span className="truncate text-[11.5px] text-linen">{children}</span>
  </div>
);

const button = 'flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-[11px] font-semibold transition-colors';

/**
 * The instance at a glance, sticky above the canvas: what it is, its state,
 * version, who started it, how long it has run, the playback pace and the
 * actions the viewer may take (the engine enforces them too).
 */
export const InstanceHeader: React.FC<{
  instance: ProcessInstanceDTO;
  definition: ProcessDefinitionDTO | null;
  isTerminal: boolean;
  live: boolean;
  incidents: IncidentDTO[];
  nodeTitle: (nodeId: string) => string;
  playback: { pace: PlaybackPace; setPace: (pace: PlaybackPace) => void; lag: number; jumpToNow: () => void };
  canOperate: boolean;
  backLabel?: string;
  onBack: () => void;
  onOpenCanvas: () => void;
  onOpenIncident: (nodeId: string) => void;
  onToggleSuspend: () => void;
  onCancel: () => void;
  onExport: () => void;
}> = ({
  instance, definition, isTerminal, live, incidents, nodeTitle, playback, canOperate,
  backLabel = 'Operations', onBack, onOpenCanvas, onOpenIncident, onToggleSuspend, onCancel, onExport,
}) => {
  const status = statusOf(instance);
  const { label } = deriveBusinessLabel(instance);
  const first = incidents[0];
  return (
    <header className="sticky top-0 z-[var(--elevation-panel)] flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-mocha-deep px-4 py-2.5">
      <button type="button" onClick={onBack} title={`Back to ${backLabel} (Esc)`}
        className={`${button} border-hairline bg-charcoal text-sand hover:border-hairline-strong hover:text-linen`}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {backLabel}
      </button>
      <div className="flex min-w-0 max-w-xs flex-col">
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-linen">{label}</h1>
        <span className="truncate font-mono text-[10.5px] text-sand" title={instance.id}>{instance.id}</span>
      </div>
      <InstanceStatePill instance={instance} incident={incidents.length > 0} />
      <div className="flex min-w-0 items-center gap-4">
        <Fact label="Process">
          {instance.processDefinitionName || humanize(instance.processDefinitionId)}
          {definition && <span className="ml-1.5 rounded border border-amethyst/35 px-1 text-[10px] text-amethyst-light">v{definition.version}</span>}
        </Fact>
        <Fact label="Started by">{instance.startedBy || 'system'}</Fact>
        <Fact label="Elapsed"><ElapsedTicker startDate={instance.startDate} endDate={instance.endDate} /></Fact>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {first && (
          <button type="button" onClick={() => onOpenIncident(first.activityId)}
            className="flex items-center gap-1.5 rounded-full border border-desert-rose/40 bg-desert-rose/10 px-2.5 py-1 text-[11px] font-semibold text-desert-rose hover:bg-desert-rose/20">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {incidents.length === 1 ? `Incident · ${nodeTitle(first.activityId)}` : `${incidents.length} incidents`}
          </button>
        )}
        {(!isTerminal || playback.lag > 0) && (
          <PlaybackControl pace={playback.pace} onPaceChange={playback.setPace} lag={playback.lag} onJumpToNow={playback.jumpToNow} />
        )}
        {!isTerminal && (
          <span title={live ? 'Updates arrive from the event stream' : 'The event stream is not available; refreshing every 2 s'}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${live ? 'border-mineral-teal/40 text-mineral-teal' : 'border-hairline text-sand'}`}>
            {live ? 'Live' : 'Polling'}
          </span>
        )}
        <UITooltip content="Open on the canvas: the read-only live graph in the designer">
          <button type="button" onClick={onOpenCanvas} aria-label="Open on the canvas"
            className="flex h-8 w-8 items-center justify-center rounded-control border border-hairline bg-charcoal text-sand transition-colors hover:border-hairline-strong hover:text-linen">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </UITooltip>
        {canOperate && (status === 'RUNNING' || status === 'SUSPENDED') && (
          <button type="button" onClick={onToggleSuspend}
            className={`${button} ${status === 'SUSPENDED'
              ? 'border-mineral-teal/40 bg-mineral-teal/10 text-mineral-teal hover:bg-mineral-teal/20'
              : 'border-saffron/40 bg-saffron/10 text-saffron hover:bg-saffron/20'}`}>
            {status === 'SUSPENDED'
              ? <><PlayCircle className="h-3.5 w-3.5" aria-hidden="true" /> Resume</>
              : <><PauseCircle className="h-3.5 w-3.5" aria-hidden="true" /> Suspend</>}
          </button>
        )}
        {canOperate && status === 'RUNNING' && (
          <button type="button" onClick={onCancel} title="Stop the instance for good (audited)"
            className={`${button} border-desert-rose/40 bg-desert-rose/10 text-desert-rose hover:bg-desert-rose/20`}>
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
          </button>
        )}
        <button type="button" onClick={onExport} title="Export the full execution trace as JSON"
          className={`${button} border-hairline bg-charcoal text-sand hover:border-hairline-strong hover:text-linen`}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export
        </button>
      </div>
    </header>
  );
};
