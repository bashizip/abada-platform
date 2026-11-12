import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineAPI, ProcessInstanceDTO } from '@/api/engine';
import type { InstanceStatus } from '@/lib/run/instanceFormat';

export const PAGE_SIZE = 50;

const mergeUnique = (preferred: ProcessInstanceDTO[], extra: ProcessInstanceDTO[]): ProcessInstanceDTO[] => {
  const seen = new Set(preferred.map((item) => item.id));
  return [...preferred, ...extra.filter((item) => !seen.has(item.id))];
};

export interface InstanceListFilters {
  status: 'ALL' | InstanceStatus;
  definitionId: 'ALL' | string;
}

/**
 * The project's instances, newest first, a page at a time. State and process
 * filter on the server; `refresh` merges the fresh first page over what is
 * loaded, so a live update never drops the rows the user scrolled to.
 */
export function useInstanceList(projectId: string | undefined, filters: InstanceListFilters) {
  const [instances, setInstances] = useState<ProcessInstanceDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A slow, stale response never overwrites a newer one. */
  const requestSeq = useRef(0);
  const { status, definitionId } = filters;

  const fetchPage = useCallback(async (requestedPage: number, mode: 'replace' | 'append' | 'refresh') => {
    if (!projectId) return;
    const seq = ++requestSeq.current;
    try {
      setError(null);
      if (mode === 'replace') setLoading(true);
      if (mode === 'append') setLoadingMore(true);
      const result = await EngineAPI.getInstances(projectId, {
        status: status === 'ALL' ? undefined : status,
        processDefinitionId: definitionId === 'ALL' ? undefined : definitionId,
        page: requestedPage,
        size: PAGE_SIZE,
      });
      if (seq !== requestSeq.current) return;
      setTotal(result.total);
      if (mode !== 'refresh') setPage(result.page);
      setInstances((previous) => (mode === 'replace' ? result.items
        : mode === 'refresh' ? mergeUnique(result.items, previous) : mergeUnique(previous, result.items)));
    } catch (cause) {
      if (seq === requestSeq.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [projectId, status, definitionId]);

  useEffect(() => {
    setInstances([]);
    setTotal(0);
    setPage(0);
    if (!projectId) {
      setLoading(false);
      return;
    }
    void fetchPage(0, 'replace');
  }, [projectId, fetchPage]);

  const hasMore = instances.length < total;
  const loadMore = useCallback(() => {
    if (hasMore && !loading && !loadingMore) void fetchPage(page + 1, 'append');
  }, [hasMore, loading, loadingMore, fetchPage, page]);
  const refresh = useCallback(() => { void fetchPage(0, 'refresh'); }, [fetchPage]);

  return { instances, total, loading, loadingMore, error, hasMore, loadMore, refresh };
}
