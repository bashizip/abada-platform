import React from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { ProcessDefinitionDTO } from '@/api/engine';
import { InstanceStatus, STATUS_META } from '@/lib/run/instanceFormat';
import type { StateCounts } from './useOperationsKpis';
import type { OverviewFilters, RangeFilter } from './filters';

const STATE_CHIPS: ('ALL' | InstanceStatus)[] = ['ALL', 'RUNNING', 'SUSPENDED', 'FAILED', 'COMPLETED', 'CANCELLED'];
const STATE_DOT: Record<InstanceStatus, string> = {
  RUNNING: 'bg-amethyst', SUSPENDED: 'bg-saffron', FAILED: 'bg-desert-rose', COMPLETED: 'bg-sage-green', CANCELLED: 'bg-sand',
};
/** Up to this many processes show as chips; more fall back to a menu. */
const MAX_PROCESS_CHIPS = 5;

const Chip: React.FC<{ pressed: boolean; onClick: () => void; children: React.ReactNode }> = ({ pressed, onClick, children }) => (
  <button type="button" aria-pressed={pressed} onClick={onClick}
    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors duration-150 ${pressed
      ? 'border-hairline-strong bg-mocha-hover text-linen' : 'border-hairline text-sand hover:border-hairline-strong hover:text-linen'}`}>
    {children}
  </button>
);

const Divider = () => <span aria-hidden="true" className="h-4 w-px bg-hairline" />;

/** Filters as chips: state (with counts), process and its versions, start time and a search. */
export const FilterChips: React.FC<{
  filters: OverviewFilters;
  onChange: (next: OverviewFilters) => void;
  counts: StateCounts;
  /** Every deployed version of every process. */
  definitions: ProcessDefinitionDTO[];
  searchRef?: React.Ref<HTMLInputElement>;
}> = ({ filters, onChange, counts, definitions, searchRef }) => {
  const set = (patch: Partial<OverviewFilters>) => onChange({ ...filters, ...patch });
  const processes = [...new Map(definitions.map((item) => [item.id, item.name || item.id])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const versions = [...new Set(definitions.filter((item) => item.id === filters.definitionId).map((item) => item.version))]
    .sort((a, b) => b - a);

  return (
    <div role="group" aria-label="Filter instances" className="flex flex-wrap items-center gap-2">
      {STATE_CHIPS.map((status) => (
        <Chip key={status} pressed={filters.status === status} onClick={() => set({ status })}>
          {status !== 'ALL' && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[status]}`} />}
          {status === 'ALL' ? 'All' : STATUS_META[status].label}
          {counts[status] !== undefined && (
            <span className="text-[11px] tabular-nums text-sand">{counts[status]?.toLocaleString()}</span>
          )}
        </Chip>
      ))}
      {processes.length > 1 && <Divider />}
      {processes.length > 1 && processes.length <= MAX_PROCESS_CHIPS && (
        [['ALL', 'All processes'] as const, ...processes].map(([key, name]) => (
          <Chip key={key} pressed={filters.definitionId === key} onClick={() => set({ definitionId: key, version: 'ALL' })}>
            {name}
          </Chip>
        ))
      )}
      {processes.length > MAX_PROCESS_CHIPS && (
        <label className="relative">
          <span className="sr-only">Process</span>
          <select value={filters.definitionId} onChange={(event) => set({ definitionId: event.target.value, version: 'ALL' })}
            className="appearance-none rounded-full border border-hairline bg-charcoal py-1 pl-3 pr-7 text-xs text-sand outline-none hover:text-linen focus:border-saffron">
            <option value="ALL">All processes</option>
            {processes.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-sand" />
        </label>
      )}
      {versions.length > 1 && <Divider />}
      {versions.length > 1 && (['ALL', ...versions] as const).map((version) => (
        <Chip key={version} pressed={filters.version === version} onClick={() => set({ version })}>
          {version === 'ALL' ? 'Any version' : `v${version}`}
        </Chip>
      ))}
      <div className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-sm">
        <label className="relative">
          <span className="sr-only">Started</span>
          <select value={filters.range} onChange={(event) => set({ range: event.target.value as RangeFilter })}
            className="appearance-none rounded-control border border-hairline bg-charcoal py-1.5 pl-3 pr-7 text-xs text-sand outline-none hover:text-linen focus:border-saffron">
            <option value="ALL">Any time</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-sand" />
        </label>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search instances</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sand" />
          <input ref={searchRef} type="search" value={filters.search} onChange={(event) => set({ search: event.target.value })}
            placeholder="Business key, step or id   /"
            className="w-full rounded-control border border-hairline bg-charcoal py-1.5 pl-8 pr-7 text-xs text-linen placeholder-sand-dim outline-none focus:border-saffron focus:ring-2 focus:ring-saffron/15" />
          {filters.search && (
            <button type="button" aria-label="Clear search" onClick={() => set({ search: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-sand hover:text-linen">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </label>
      </div>
    </div>
  );
};
