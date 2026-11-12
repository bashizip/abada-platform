/**
 * How urgent an open incident is, for the Operations attention cards (M5 S6).
 * Severity follows what it takes to unblock the run, not how old it is:
 *
 * - `decision`: only a person can say what happened (an interrupted write).
 * - `blocked`: work used up its attempts or a called process failed.
 * - `waiting`: the run waits on data or a limit; a retry usually suffices.
 */
export type IncidentSeverity = 'decision' | 'blocked' | 'waiting';

export const SEVERITY_ORDER: Record<IncidentSeverity, number> = { decision: 0, blocked: 1, waiting: 2 };

export const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  decision: 'Needs a decision',
  blocked: 'Blocked',
  waiting: 'Waiting',
};

export function incidentSeverity(kind: string): IncidentSeverity {
  if (kind === 'TOOL_OUTCOME_UNKNOWN') return 'decision';
  if (kind === 'WORK_FAILED' || kind === 'CHILD_FAILED') return 'blocked';
  return 'waiting';
}

/** Most severe first, then newest first. */
export function bySeverity<T extends { type: string; createdAt: string }>(incidents: readonly T[]): T[] {
  return [...incidents].sort((a, b) =>
    SEVERITY_ORDER[incidentSeverity(a.type)] - SEVERITY_ORDER[incidentSeverity(b.type)]
    || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
