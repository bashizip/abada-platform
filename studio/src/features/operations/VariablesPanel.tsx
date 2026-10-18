import React, { useMemo } from 'react';
import type { ActivityHistoryDTO } from '@/api/engine';
import { JsonViewer } from '@/components/json/JsonViewer';
import { useVariableChanges } from '@/hooks/useVariableChanges';
import { unwrapVariable } from '@/lib/run/instanceFormat';

/** With more top-level variables than this, the tree opens collapsed. */
const OPEN_FIRST_LEVEL_UP_TO = 50;

/**
 * An instance's execution variables (M5 S11): the shared JSON viewer, plus
 * the variables that changed in the last update. While the playback is
 * behind, the changes wait for it (`useVariableChanges`) and a note says the
 * values are the current ones.
 */
export const VariablesPanel: React.FC<{
  variables: Record<string, unknown> | null;
  /** The facts on screen (the playback frame), for the changes they name. */
  visibleFacts?: ActivityHistoryDTO[];
  /** Steps the playback is behind the real state. */
  lag?: number;
  onJumpToNow?: () => void;
  /** A different instance: start over, nothing flashes. */
  resetKey?: string;
  height?: number;
  className?: string;
}> = ({ variables, visibleFacts, lag = 0, onJumpToNow, resetKey, height, className = '' }) => {
  const plain = useMemo(
    () => (variables ? (unwrapVariable(variables) as Record<string, unknown>) : null),
    [variables],
  );
  const changes = useVariableChanges(plain, { visibleFacts, lag, resetKey });
  const topLevel = plain ? Object.keys(plain).length : 0;
  const notice = lag > 0 ? (
    <>
      The diagram is replaying {lag} {lag === 1 ? 'step' : 'steps'} behind. These are the current values; their
      changes show when the replay catches up.
      {onJumpToNow && (
        <button type="button" onClick={onJumpToNow} className="ml-1.5 font-semibold text-linen underline underline-offset-2">
          Jump to now
        </button>
      )}
    </>
  ) : null;

  // The drawers give their body a definite height; the viewer fills it and windows its rows.
  return (
    <div className={`flex h-full min-h-[240px] flex-col ${className}`}>
      <JsonViewer key={resetKey} data={plain} loading={variables === null} label="variables" height={height}
        defaultDepth={topLevel > OPEN_FIRST_LEVEL_UP_TO ? 0 : 1}
        changedPaths={changes.changed} changeKey={changes.key} notice={notice} />
    </div>
  );
};
