import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { AnimatedNumber, Skeleton } from '@/components/ui';
import { Sparkline } from '@/components/Sparkline';
import { palette } from '@/lib/tokens';
import { formatDuration } from '@/lib/run/instanceFormat';
import type { OperationsKpis } from './useOperationsKpis';

interface Tile {
  id: string;
  label: string;
  value: number;
  format?: (value: number) => string;
  note: string;
  series: readonly (number | null)[];
  colour: string;
  alert?: boolean;
  /** Where the number comes from, shown on demand. */
  source: string;
}

const count = (value: number) => Math.round(value).toLocaleString();

function tiles(kpis: OperationsKpis, openIncidents: number, incidentSeries: number[], decisions: number): Tile[] {
  const floor = kpis.capped ? '≥ ' : '';
  return [
    { id: 'running', label: 'Running', value: kpis.running, note: 'right now', series: kpis.runningSeries,
      colour: palette.amethystLight,
      source: 'Exact count of running instances. The line is the number running at the end of each hour, rebuilt from the instances started in the last 24 h.' },
    { id: 'completed', label: 'Completed', value: kpis.completed, format: (v) => floor + count(v),
      note: kpis.capped ? 'last 24 h · first 1 000 started' : 'last 24 h', series: kpis.completedSeries,
      colour: palette.sageGreen,
      source: 'Instances started in the last 24 h that have completed, read newest first up to 1 000 (then shown as ≥). Refreshed every minute.' },
    { id: 'incidents', label: 'Open incidents', value: openIncidents,
      format: (v) => (openIncidents >= 100 ? '100+' : count(v)),
      note: decisions > 0 ? `${decisions} need${decisions === 1 ? 's' : ''} a decision` : openIncidents ? 'retry from the step' : 'nothing stuck',
      series: incidentSeries, colour: palette.desertRose, alert: openIncidents > 0,
      source: 'Open incidents of the project (the engine lists up to 100). The line shows when each open incident was raised.' },
    { id: 'waiting', label: 'Waiting on you', value: kpis.waitingOnYou, note: 'tasks you can claim',
      series: kpis.waitingSeries, colour: palette.saffron,
      source: 'Available tasks you may claim. The engine lists only the tasks of your users and groups, so this is not every human step in the project.' },
    { id: 'p95', label: 'p95 duration', value: kpis.p95Ms ?? 0,
      format: (v) => (kpis.p95Ms === null ? '—' : formatDuration(v)), note: 'last 100 completed',
      series: kpis.p95Series, colour: palette.mineralTealBright,
      source: '95th percentile of the run time of the 100 most recently started completed instances. An hour with fewer than five completions has no point.' },
    { id: 'cost', label: 'AI cost', value: kpis.costUsd,
      format: (v) => `$${v.toFixed(2)}${kpis.costIncludesUnpriced ? '+' : ''}`,
      note: kpis.costIncludesUnpriced ? 'last 24 h · some calls unpriced' : 'last 24 h · priced calls',
      series: kpis.costSeries, colour: palette.linenMuted,
      source: 'Sum of the priced agent calls of the instances started in the last 24 h. “+” means some calls have no price, so the real cost is higher.' },
  ];
}

const KpiTile: React.FC<{ tile: Tile; loading: boolean }> = ({ tile, loading }) => {
  const [showSource, setShowSource] = useState(false);
  return (
    <div className="relative flex min-w-0 flex-col gap-0.5 bg-mocha-deep px-4 pb-2.5 pt-3.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sand">
        {tile.label}
        <button type="button" aria-label={`Where “${tile.label}” comes from`} aria-expanded={showSource}
          onClick={() => setShowSource((open) => !open)} onBlur={() => setShowSource(false)}
          className="ml-auto rounded-full text-sand transition-colors hover:text-linen">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {showSource && (
        <p role="note" className="absolute right-2.5 top-9 z-10 w-60 rounded-card border border-hairline-strong bg-mocha p-3 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-linen-muted shadow-warm-lg">
          {tile.source}
        </p>
      )}
      {loading ? (
        <div className="mt-1 space-y-2"><Skeleton className="h-7 w-2/3" label={`Loading ${tile.label}`} /><Skeleton className="h-8 w-full" /></div>
      ) : (
        <>
          <AnimatedNumber value={tile.value} format={tile.format}
            className={`text-[26px] font-semibold leading-tight tracking-tight ${tile.alert ? 'text-desert-rose' : 'text-linen'}`} />
          <span className="truncate text-[10.5px] text-sand">{tile.note}</span>
          <Sparkline values={tile.series} colour={tile.colour} label={`${tile.label}, last 24 hours`} className="mt-1.5 h-8 w-full" />
        </>
      )}
    </div>
  );
};

/** Six headline numbers with their last 24 h, calm: they count to new values instead of jumping. */
export const KpiBand: React.FC<{
  kpis: OperationsKpis;
  openIncidents: number;
  incidentSeries: number[];
  decisions: number;
}> = ({ kpis, openIncidents, incidentSeries, decisions }) => (
  <section aria-label="Key figures"
    className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-hairline bg-hairline md:grid-cols-3 xl:grid-cols-6">
    {tiles(kpis, openIncidents, incidentSeries, decisions).map((tile) => (
      <KpiTile key={tile.id} tile={tile} loading={!kpis.loaded} />
    ))}
  </section>
);
