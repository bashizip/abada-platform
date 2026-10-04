/**
 * Review decisions on human tasks that declare `outcomes` (APL) or
 * `abada:outcomes` (BPMN). The engine validates the decision; these helpers
 * only give the reviewer the same rules before submitting.
 */
export interface TaskOutcome {
  name: string;
  commentRequired: boolean;
}

export interface TaskDecision {
  outcome: string;
  comment?: string;
  variables?: Record<string, unknown>;
}

/** Longest comment the engine keeps in `<task>_comment`. */
export const MAX_COMMENT_LENGTH = 4000;

/** Why this decision cannot be submitted yet, or null when it can. */
export function decisionError(outcome: TaskOutcome, comment: string): string | null {
  const trimmed = comment.trim();
  if (outcome.commentRequired && !trimmed) return `A comment is required to ${humanize(outcome.name)}.`;
  if (trimmed.length > MAX_COMMENT_LENGTH) return `Comments are limited to ${MAX_COMMENT_LENGTH} characters.`;
  return null;
}

/**
 * The decision body. Form values are limited to the form's own fields: the
 * inbox seeds the form from every process variable, and re-posting those
 * would overwrite data the reviewer never touched.
 */
export function decisionPayload(
  outcome: TaskOutcome,
  comment: string,
  formValues: Record<string, unknown> = {},
  formFieldIds: string[] = [],
): TaskDecision {
  const trimmed = comment.trim();
  const variables = Object.fromEntries(
    formFieldIds.filter((id) => id in formValues).map((id) => [id, formValues[id]]),
  );
  return {
    outcome: outcome.name,
    ...(trimmed ? { comment: trimmed } : {}),
    ...(Object.keys(variables).length > 0 ? { variables } : {}),
  };
}

/** `request_changes` → `request changes`. */
export function humanize(name: string): string {
  return name.replace(/_/g, ' ');
}
