import { useCallback, useMemo } from 'react';
import type { ProcessDefinitionDTO, ProcessInstanceDTO } from '@/api/engine';
import { deriveBusinessLabel, humanize, statusOf } from '@/lib/run/instanceFormat';
import type { OverviewFilters, RangeFilter } from './filters';

const RANGE_MS: Record<Exclude<RangeFilter, 'ALL'>, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
  '30d': 30 * 24 * 3_600_000,
};

const cleanKey = (key: string): string => key.replace(/^process[:_]/, '');

/**
 * The loaded instances the list shows: state and process are filtered by the
 * engine; version, start time and search filter the loaded rows here.
 */
export function useOverviewRows(instances: ProcessInstanceDTO[], definitions: ProcessDefinitionDTO[], filters: OverviewFilters) {
  const byDeployment = useMemo(() => new Map(definitions.map((item) => [item.deploymentId, item])), [definitions]);
  const latestByKey = useMemo(() => {
    const latest = new Map<string, ProcessDefinitionDTO>();
    for (const item of definitions) {
      const current = latest.get(item.id);
      if (!current || item.version > current.version) latest.set(item.id, item);
    }
    return latest;
  }, [definitions]);

  const definitionOf = useCallback((instance: ProcessInstanceDTO): ProcessDefinitionDTO | undefined =>
    (instance.processDefinitionDeploymentId ? byDeployment.get(instance.processDefinitionDeploymentId) : undefined)
      ?? latestByKey.get(instance.processDefinitionId), [byDeployment, latestByKey]);

  const processOf = useCallback((instance: ProcessInstanceDTO): { name: string; version: string } => {
    const exact = instance.processDefinitionDeploymentId ? byDeployment.get(instance.processDefinitionDeploymentId) : undefined;
    const definition = exact ?? latestByKey.get(instance.processDefinitionId);
    return {
      name: definition?.name || instance.processDefinitionName || cleanKey(instance.processDefinitionId),
      // Without the exact deployment the version is unknown: show none rather than the latest.
      version: exact ? `v${exact.version}` : '',
    };
  }, [byDeployment, latestByKey]);

  const rows = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    const since = filters.range === 'ALL' ? 0 : Date.now() - RANGE_MS[filters.range];
    return instances.filter((instance) => {
      if (since && new Date(instance.startDate).getTime() < since) return false;
      if (filters.version !== 'ALL') {
        const exact = instance.processDefinitionDeploymentId ? byDeployment.get(instance.processDefinitionDeploymentId) : undefined;
        if (exact?.version !== filters.version) return false;
      }
      if (!query) return true;
      return [deriveBusinessLabel(instance).label, instance.id, instance.processDefinitionId,
        instance.processDefinitionName ?? '', humanize(instance.currentActivityId ?? ''), statusOf(instance)]
        .join(' ').toLowerCase().includes(query);
    });
  }, [instances, filters.search, filters.range, filters.version, byDeployment]);

  return { rows, processOf, definitionOf };
}
