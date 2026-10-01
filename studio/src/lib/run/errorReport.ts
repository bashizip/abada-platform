import type { ActivityHistoryDTO, JobError } from '@/api/engine';

/** What Studio already knows about a failed attempt before it loads the stack trace. */
export interface FailureContext {
  activityTitle?: string;
  errorType?: string;
  attempt?: number;
  provider?: string;
  model?: string;
  workerId?: string;
  occurredAt?: string;
}

/** Plain-text report for the Copy button: context first, then the stack trace. */
export function formatErrorReport(context: FailureContext, error: JobError | null): string {
  const lines = [
    context.activityTitle ? `Activity: ${context.activityTitle}` : null,
    error ? `Job: ${error.jobId}` : null,
    context.errorType ? `Error type: ${context.errorType}` : null,
    error?.errorMessage ? `Message: ${error.errorMessage}` : null,
    context.attempt !== undefined ? `Attempt: ${context.attempt}` : null,
    context.provider || context.model ? `Model: ${[context.provider, context.model].filter(Boolean).join(' / ')}` : null,
    context.workerId ? `Worker: ${context.workerId}` : null,
    error?.status ? `Status: ${error.status}${error.retries !== null && error.retries !== undefined ? ` (${error.retries} retries left)` : ''}` : null,
    context.occurredAt ? `Time: ${context.occurredAt}` : null,
  ].filter((line): line is string => line !== null);
  const trace = error?.errorDetails?.trim();
  return trace ? `${lines.join('\n')}\n\n${trace}\n` : `${lines.join('\n')}\n`;
}

/** The first line of a stack trace is the exception and its message. */
export const traceHeadline = (details: string | null | undefined): string | null =>
  details?.split('\n', 1)[0]?.trim() || null;

/** Job id and attempt context of a recorded `EXTERNAL_TASK_FAILED` event. */
export const failureOf = (event: ActivityHistoryDTO, activityTitle: string, workerIds: string[]):
  { jobId: string; context: FailureContext } | null => {
  if (event.eventType !== 'EXTERNAL_TASK_FAILED') return null;
  const details = (event.details ?? {}) as Record<string, unknown>;
  if (typeof details.externalTaskId !== 'string' || !details.externalTaskId) return null;
  const agent = (details.agent ?? {}) as Record<string, unknown>;
  return {
    jobId: details.externalTaskId,
    context: {
      activityTitle,
      errorType: typeof agent.errorType === 'string' && agent.errorType ? agent.errorType : undefined,
      attempt: typeof agent.attempt === 'number' ? agent.attempt : undefined,
      provider: typeof agent.provider === 'string' && agent.provider ? agent.provider : undefined,
      model: typeof agent.model === 'string' && agent.model ? agent.model : undefined,
      workerId: workerIds[workerIds.length - 1],
      occurredAt: event.occurredAt,
    },
  };
};
