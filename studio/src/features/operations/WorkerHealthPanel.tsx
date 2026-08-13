import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, ChevronDown, ChevronRight, RadioTower } from 'lucide-react';
import { EngineAPI, WorkerHealthDTO } from '@/api/engine';

const POLL_MS = 5000;

const timeAgo = (iso: string | null | undefined): string => {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const STATUS_META = {
  ONLINE: { label: 'Online', dot: 'bg-[#90A955]', chip: 'border-[#90A955]/40 bg-[#90A955]/10 text-[#90A955]' },
  OFFLINE: { label: 'Offline', dot: 'bg-[#A89F91]', chip: 'border-[#3A322E] bg-[#1A1614] text-[#A89F91]' },
  ERROR: { label: 'Error', dot: 'bg-[#E76F51]', chip: 'border-[#E76F51]/50 bg-[#E76F51]/10 text-[#E76F51]' },
} as const;

/**
 * Agent-worker liveness strip for the operations view. Polls the engine's
 * worker-health endpoint so a worker that is unreachable, misconfigured or
 * flooding rejections shows up here immediately instead of only in its own
 * container logs.
 */
export const WorkerHealthPanel: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const [rows, setRows] = useState<WorkerHealthDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef(0);

  const refresh = useCallback(async (project: string) => {
    const seq = ++pollRef.current;
    try {
      const health = await EngineAPI.getWorkerHealth(project);
      if (seq !== pollRef.current) return;
      setRows(health);
      setError(null);
    } catch (cause) {
      if (seq !== pollRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (seq === pollRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    void refresh(projectId);
    const timer = window.setInterval(() => { void refresh(projectId); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [projectId, refresh]);

  const failing = rows.filter((row) => row.status === 'ERROR');
  const online = rows.filter((row) => row.status === 'ONLINE');
  const offline = rows.filter((row) => row.status === 'OFFLINE');

  return (
    <div className="shrink-0 border-b border-[#3A322E] bg-[#25201D]">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-6 py-2.5 text-left"
        title={collapsed ? 'Expand agent workers panel' : 'Collapse agent workers panel'}
      >
        <span className="flex items-center gap-2.5">
          <RadioTower className={`h-3.5 w-3.5 ${failing.length > 0 ? 'text-[#E76F51]' : 'text-[#2A9D8F]'}`} />
          <span className="text-[11px] font-semibold tracking-wide text-[#EAE3D9]">AGENT WORKERS</span>
          {!loading && (
            <span className="flex items-center gap-2 text-[10px] text-[#A89F91]">
              {failing.length > 0 && (
                <span className="flex items-center gap-1 font-semibold text-[#E76F51]">
                  <AlertTriangle className="h-3 w-3" /> {failing.length} error
                </span>
              )}
              {failing.length === 0 && online.length > 0 && (
                <span className="flex items-center gap-1 font-semibold text-[#90A955]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#90A955]" /> {online.length} online
                </span>
              )}
              {failing.length === 0 && online.length === 0 && rows.length > 0 && (
                <span className="font-semibold text-[#A89F91]">{offline.length} offline</span>
              )}
              {rows.length === 0 && !error && <span>no workers yet</span>}
            </span>
          )}
        </span>
        {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-[#A89F91]" /> : <ChevronDown className="h-3.5 w-3.5 text-[#A89F91]" />}
      </button>

      {!collapsed && (
        <div className="space-y-2 px-6 pb-3">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-[#E76F51]/40 bg-[#E76F51]/10 px-3 py-2 text-[11px] text-[#E76F51]">
              <AlertTriangle className="h-3.5 w-3.5" /> Worker health unavailable: {error}
            </div>
          )}
          {rows.length === 0 && !error && (
            <div className="flex items-center gap-2 rounded-lg border border-[#3A322E] bg-[#1A1614] px-3 py-2 text-[11px] text-[#A89F91]">
              <Bot className="h-3.5 w-3.5" />
              No bound or attempted workers in this project. Bind a service principal to a project topic to monitor it here.
            </div>
          )}
          {rows.map((row) => {
            const meta = STATUS_META[row.status];
            return (
              <div
                key={`${row.principalId}-${row.topic}`}
                className={`flex items-center gap-3 rounded-lg border bg-[#1A1614] px-3 py-2 ${
                  row.status === 'ERROR'
                    ? 'border-[#E76F51]/40'
                    : row.status === 'ONLINE'
                      ? 'border-[#90A955]/30'
                      : 'border-[#3A322E]'
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot} ${row.status === 'ONLINE' ? 'animate-pulse' : ''}`} />
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${meta.chip}`}>
                  {meta.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[11px] font-semibold text-[#EAE3D9]">
                    <span className="truncate">{row.principalUsername}</span>
                    {!row.bound && (
                      <span className="shrink-0 rounded border border-[#F4A261]/40 bg-[#F4A261]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#F4A261]">
                        NOT BOUND
                      </span>
                    )}
                    <span className="shrink-0 rounded-full border border-[#3A322E] bg-[#25201D] px-2 py-0.5 font-mono text-[10px] text-[#A89F91]">
                      {row.topic}
                    </span>
                  </p>
                  {row.status === 'ERROR' && row.lastErrorMessage && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#E76F51]" title={row.lastErrorMessage}>
                      <span className="truncate">{row.lastErrorMessage}</span>
                      <span className="shrink-0 text-[#A89F91]">· {timeAgo(row.lastErrorAt)}</span>
                      {row.consecutiveFailures > 1 && (
                        <span className="shrink-0 rounded border border-[#E76F51]/40 bg-[#E76F51]/10 px-1 py-0.5 text-[9px] font-bold">
                          {row.consecutiveFailures}×
                        </span>
                      )}
                    </p>
                  )}
                  {row.status !== 'ERROR' && (
                    <p className="mt-0.5 text-[10px] text-[#A89F91]">
                      {row.status === 'ONLINE' ? 'Heartbeat ' : 'Last heartbeat '}
                      {timeAgo(row.lastSeenAt)}
                      {row.lastWorkerId ? ` · ${row.lastWorkerId}` : ''}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};