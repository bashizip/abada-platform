import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History, Loader2, Undo2 } from 'lucide-react';
import { DefinitionVersionDTO, EngineAPI, VersionDiffDTO } from '@/api/engine';
import { formatWhen } from '@/lib/run/instanceFormat';

const ORIGIN: Record<DefinitionVersionDTO['origin'], string> = {
  DEPLOY: 'Deployed', ROLLBACK: 'Rolled back', INSIGHT: 'Adopted from Insight',
};

interface VersionsPanelProps {
  projectId?: string;
  /** The process keys of the project. */
  processKeys: string[];
  /** Operator, maintainer or owner; the engine still enforces it. */
  canRollBack: boolean;
  onRolledBack?: (processKey: string, version: number) => void;
  /** Inside a drawer: open, without the collapsible header. */
  embedded?: boolean;
  /** Marks the version an instance runs on. */
  instanceVersion?: number;
}

/**
 * Version history of a process with a source diff against the current version and a one-step rollback. A rollback
 * deploys the old source as the next version: running instances stay on the version they started on.
 */
export const VersionsPanel: React.FC<VersionsPanelProps> = ({
  projectId, processKeys, canRollBack, onRolledBack, embedded = false, instanceVersion,
}) => {
  const [collapsed, setCollapsed] = useState(!embedded);
  const [processKey, setProcessKey] = useState(processKeys[0] ?? '');
  const [versions, setVersions] = useState<DefinitionVersionDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<VersionDiffDTO | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!processKeys.includes(processKey)) setProcessKey(processKeys[0] ?? '');
  }, [processKeys, processKey]);

  const load = useCallback(async () => {
    if (!projectId || !processKey) return;
    setLoading(true);
    try {
      setVersions(await EngineAPI.getVersions(projectId, processKey));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Versions could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [projectId, processKey]);

  useEffect(() => {
    if (!collapsed) void load();
  }, [collapsed, load]);

  const current = versions.find((version) => version.current);

  const showDiff = async (version: number) => {
    if (!projectId || !current) return;
    try {
      setDiff(await EngineAPI.getVersionDiff(projectId, processKey, version, current.version));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The diff could not be loaded');
    }
  };

  const rollBack = async () => {
    if (!projectId || target === null || !current) return;
    setBusy(true);
    try {
      await EngineAPI.rollbackProcess(projectId, processKey, target, comment.trim(), current.version);
      onRolledBack?.(processKey, target);
      setTarget(null);
      setComment('');
      setDiff(null);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The rollback failed');
    } finally {
      setBusy(false);
    }
  };

  const content = (
        <div className={embedded ? 'space-y-3' : 'space-y-3 border-t border-hairline p-4'}>
          {processKeys.length > 1 && <select aria-label="Process" value={processKey} onChange={(event) => { setProcessKey(event.target.value); setDiff(null); setTarget(null); }}
            className="rounded-lg border border-hairline bg-charcoal px-2 py-1 text-xs text-linen">
            {processKeys.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-sand" />}
          {error && <p className="text-[11px] text-desert-rose">{error}</p>}
          <ul className="space-y-1.5">
            {versions.map((version) => (
              <li key={version.deploymentId} className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline px-3 py-2 text-[11px] text-linen">
                <span className="font-mono font-semibold">v{version.version}{version.current ? ' (current)' : ''}</span>
                {version.version === instanceVersion && (
                  <span className="rounded-full border border-amethyst/40 px-1.5 text-[10px] text-amethyst-light">this instance</span>
                )}
                <span>{ORIGIN[version.origin]}{version.rollbackOf ? ` v${version.rollbackOf}` : ''}</span>
                <span className="text-sand">{version.deployedBy ?? 'unknown'} · {formatWhen(version.createdAt)}</span>
                <span className="text-sand">{version.runningInstances} running</span>
                {version.comment && <span className="italic text-sand">“{version.comment}”</span>}
                {!version.current && (
                  <span className="ml-auto flex gap-2">
                    <button type="button" onClick={() => void showDiff(version.version)} className="text-amethyst hover:underline">
                      Diff vs current
                    </button>
                    {canRollBack && (
                      <button type="button" onClick={() => setTarget(version.version)}
                        className="inline-flex items-center gap-1 text-saffron hover:underline">
                        <Undo2 className="h-3 w-3" /> Roll back
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {diff && (
            <pre aria-label="Source diff" className="max-h-72 overflow-auto rounded-lg bg-charcoal p-3 font-mono text-[10px] text-linen">
              {diff.tooLarge ? 'The sources are too large to compare here.' : diff.identical ? 'The sources are identical.' : diff.unified}
            </pre>
          )}
          {target !== null && current && (
            <div className="space-y-2 rounded-lg border border-saffron/40 p-3">
              <p className="text-[11px] text-linen">
                Deploy the source of v{target} as v{current.version + 1}. {current.runningInstances} running
                instance{current.runningInstances === 1 ? '' : 's'} on v{current.version} keep running there; new starts use v{current.version + 1}.
              </p>
              <input type="text" aria-label="Reason" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000}
                placeholder="Why are you rolling back? (recorded in the audit history)"
                className="w-full rounded-lg border border-hairline bg-charcoal p-2 text-[11px] text-linen" />
              <div className="flex gap-2">
                <button type="button" disabled={busy || comment.trim() === ''} onClick={() => void rollBack()}
                  className="rounded-lg bg-saffron px-3 py-1 text-[11px] font-semibold text-charcoal disabled:opacity-50">
                  Roll back to v{target}
                </button>
                <button type="button" onClick={() => setTarget(null)} className="text-[11px] text-sand">Cancel</button>
              </div>
            </div>
          )}
        </div>
  );

  if (embedded) return <section aria-label="Versions">{content}</section>;

  return (
    <section className="mx-6 mt-4 rounded-xl border border-hairline bg-mocha">
      <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-semibold text-linen">
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        <History className="h-3.5 w-3.5 text-saffron" /> Versions and rollback
      </button>
      {!collapsed && content}
    </section>
  );
};
