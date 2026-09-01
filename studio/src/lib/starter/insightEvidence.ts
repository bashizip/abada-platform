export interface InsightEvidenceInstance {
  status: string;
}

interface SequentialInsightEvidenceOptions {
  count: number;
  start: (index: number) => Promise<string>;
  get: (instanceId: string) => Promise<InsightEvidenceInstance>;
  wait: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  perRunTimeoutMs?: number;
  interRunDelayMs?: number;
}

/** Runs samples one at a time to avoid bursting the configured LLM provider. */
export async function runSequentialInsightEvidence({
  count,
  start,
  get,
  wait,
  pollIntervalMs = 2_000,
  perRunTimeoutMs = 180_000,
  interRunDelayMs = 65_000,
}: SequentialInsightEvidenceOptions): Promise<string[]> {
  const completed: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const instanceId = await start(index);
    const deadline = Date.now() + perRunTimeoutMs;
    while (Date.now() < deadline) {
      const instance = await get(instanceId);
      if (instance.status === 'COMPLETED') {
        completed.push(instanceId);
        break;
      }
      if (['FAILED', 'CANCELLED'].includes(instance.status)) {
        throw new Error(`LOW execution ${index + 1} did not complete successfully`);
      }
      await wait(pollIntervalMs);
    }
    if (completed.length !== index + 1) {
      throw new Error(`Timed out while waiting for LOW execution ${index + 1}`);
    }
    if (index + 1 < count) await wait(interRunDelayMs);
  }
  return completed;
}
