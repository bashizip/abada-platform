import { ProcessInstanceDTO } from '@/api/engine';

export type InstanceStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SUSPENDED' | 'CANCELLED';

export const statusOf = (instance: ProcessInstanceDTO): InstanceStatus => {
  const raw = (instance.status || 'RUNNING').toUpperCase() as InstanceStatus;
  return raw === 'RUNNING' && instance.suspended === true ? 'SUSPENDED' : raw;
};

export const STATUS_META: Record<InstanceStatus, { label: string; dot: string; chip: string; text: string }> = {
  RUNNING: { label: 'Running', dot: 'bg-[#90A955]', chip: 'bg-[#90A955]/10 border-[#90A955]/30', text: 'text-[#90A955]' },
  COMPLETED: { label: 'Completed', dot: 'bg-[#9D4EDD]', chip: 'bg-[#9D4EDD]/10 border-[#9D4EDD]/30', text: 'text-[#9D4EDD]' },
  FAILED: { label: 'Failed', dot: 'bg-[#E76F51]', chip: 'bg-[#E76F51]/10 border-[#E76F51]/30', text: 'text-[#E76F51]' },
  SUSPENDED: { label: 'Suspended', dot: 'bg-[#F4A261]', chip: 'bg-[#F4A261]/10 border-[#F4A261]/30', text: 'text-[#F4A261]' },
  CANCELLED: { label: 'Cancelled', dot: 'bg-[#A89F91]', chip: 'bg-[#A89F91]/10 border-[#A89F91]/30', text: 'text-[#A89F91]' },
};

/** Turns `Analyze-Lead` / `senior_review` into `Analyze Lead` / `Senior Review`. */
export const humanize = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();

/**
 * Extracts a business-meaningful label from workflow variables (CASE-7,
 * Lead: Acme Corp, ...) instead of showing a raw instance hash. Falls back to
 * the process definition name when the instance carries no candidate variable.
 */
const BUSINESS_KEYS = [
  'businessKey', 'business_key', 'caseId', 'case_id', 'caseNumber', 'case_number',
  'leadId', 'lead_id', 'leadName', 'lead_name', 'customerName', 'customer_name',
  'customer', 'company', 'companyName', 'company_name', 'orderId', 'order_id',
  'invoiceId', 'invoice_id', 'applicationId', 'application_id', 'ticketId', 'ticket_id',
  'reference', 'ref', 'name', 'email', 'subject', 'title',
];

export const deriveBusinessLabel = (instance: ProcessInstanceDTO): { label: string; source?: string } => {
  const vars: Record<string, unknown> = instance.variables ?? {};
  for (const key of BUSINESS_KEYS) {
    const raw = vars[key];
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof raw === 'object') continue;
    const value = String(raw);
    const isCaseLike = /^case/i.test(key);
    if (isCaseLike && /^\d+$/.test(value)) return { label: `CASE-${value}`, source: key };
    if (isCaseLike || /^(case-?\d+)$/i.test(value)) return { label: value.toUpperCase(), source: key };
    return { label: value, source: key };
  }
  const fallback = instance.processDefinitionName
    || instance.processDefinitionId.split(':')[0]
    || 'Process';
  return { label: humanize(fallback) };
};

export const formatDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

export const instanceDurationMs = (instance: ProcessInstanceDTO): number => {
  const start = new Date(instance.startDate).getTime();
  const end = instance.endDate ? new Date(instance.endDate).getTime() : Date.now();
  return Math.max(0, end - start);
};

export const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

/**
 * Recursively strips the engine's typed `{ value, type }` wrappers so the
 * variables views show plain, readable values.
 */
export const unwrapVariable = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(unwrapVariable);
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if ('value' in record && 'type' in record) return unwrapVariable(record.value);
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, unwrapVariable(value)]));
  }
  return node;
};
