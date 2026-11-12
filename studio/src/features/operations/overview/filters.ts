import type { InstanceStatus } from '@/lib/run/instanceFormat';

export type RangeFilter = 'ALL' | '24h' | '7d' | '30d';

export interface OverviewFilters {
  status: 'ALL' | InstanceStatus;
  /** A process key, or every process. */
  definitionId: 'ALL' | string;
  /** A version of the chosen process; filters the loaded rows (the list API has no version filter). */
  version: 'ALL' | number;
  range: RangeFilter;
  search: string;
}

export const DEFAULT_FILTERS: OverviewFilters = { status: 'ALL', definitionId: 'ALL', version: 'ALL', range: 'ALL', search: '' };

/** Filters and the cursor survive a visit to an instance and back (per page load and project). */
export const overviewMemory: { projectId?: string; filters: OverviewFilters; cursorId?: string } = { filters: DEFAULT_FILTERS };

/** Tests only: forget the remembered filters and cursor. */
export function resetOverviewMemory(): void {
  Object.assign(overviewMemory, { projectId: undefined, filters: DEFAULT_FILTERS, cursorId: undefined });
}
