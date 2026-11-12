/** Helpers of the administration audit trail (S10). */

/** How often the first page asks for newer events. */
export const AUDIT_POLL_MS = 5000;

/** `2026-11-12` from a date input → the instant the day starts (or ends, for `to`) in UTC. */
export function dayBound(value: string, end: boolean): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const start = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return undefined;
  if (end) start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString();
}

const ACRONYMS = new Set(['ai', 'api', 'apl', 'csv', 'id']);

/** Readable action name: `project.member.put` → `Project member put`, `ai-provider.save` → `AI provider save`. */
export function actionLabel(action: string): string {
  const words = action.split(/[.-]+/).filter(Boolean)
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word)).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
