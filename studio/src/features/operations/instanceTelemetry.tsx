import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Braces,
  CheckCircle2,
  Circle,
  Clock,
  Code2,
  GitCompare,
  GitFork,
  GitMerge,
  Loader2,
  PlayCircle,
  Radio,
  Search,
  Table,
  UserCheck,
  XCircle,
  Zap,
} from 'lucide-react';
import { ActivityHistoryDTO, ProjectJob } from '@/api/engine';
import { WorkflowFile } from '@/types';
import { aggregateNodeTelemetry, eventMeta } from '@/lib/run/instanceDetail';
import { formatDuration, humanize, unwrapVariable } from '@/lib/run/instanceFormat';

/* ------------------------------------------------------------------ */
/* Tone / event metadata                                               */
/* ------------------------------------------------------------------ */

export const TONE_TEXT: Record<string, string> = {
  success: 'text-[#90A955]',
  failure: 'text-[#E76F51]',
  running: 'text-[#9D4EDD]',
  warning: 'text-[#F4A261]',
  info: 'text-[#A89F91]',
  external: 'text-[#2A9D8F]',
};

export const EVENT_ICON: Record<string, React.ElementType> = {
  PROCESS_STARTED: PlayCircle,
  PROCESS_COMPLETED: CheckCircle2,
  PROCESS_FAILED: XCircle,
  PROCESS_CANCELLED: AlertTriangle,
  PROCESS_DEFINITION_DEPLOYED: GitCompare,
  VARIABLES_UPDATED: Braces,
  EVENT_CORRELATED: Radio,
  DECISION_TABLE_APPLIED: Table,
  TASK_CREATED: UserCheck,
  TASK_ASSIGNED: UserCheck,
  TASK_CLAIMED: UserCheck,
  TASK_UNCLAIMED: UserCheck,
  TASK_COMPLETED: UserCheck,
  TASK_FAILED: UserCheck,
  TIMER_JOB_COMPLETED: Clock,
  TIMER_JOB_FAILED: Clock,
  EXTERNAL_TASK_LOCKED: Zap,
  EXTERNAL_TASK_COMPLETED: Zap,
  EXTERNAL_TASK_FAILED: Zap,
  EXTERNAL_TASK_LOCK_EXTENDED: Zap,
  EXTERNAL_TASK_RETRIES_SET: Zap,
  EXTERNAL_TASK_BPMN_ERROR: Zap,
};

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const isPrimitive = (value: unknown): boolean => value === null || typeof value !== 'object';

const VariableValue: React.FC<{ value: unknown }> = ({ value }) => {
  if (value === null) return <span className="text-[#A89F91] italic">null</span>;
  if (typeof value === 'boolean' || typeof value === 'number') {
    return <span className="text-[#F4A261]">{String(value)}</span>;
  }
  return <span className="text-[#EAE3D9]">{String(value)}</span>;
};

export const VariableTree: React.FC<{ data: unknown }> = ({ data }) => {
  if (isPrimitive(data)) return <VariableValue value={data} />;
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-[#A89F91] italic">[]</span>;
    return (
      <div className="mt-0.5 space-y-1 border-l border-[#3A322E] pl-2.5">
        {data.map((item, index) => (
          <div key={index} className="flex gap-1.5">
            <span className="shrink-0 font-mono text-[10px] text-[#A89F91]/70">[{index}]</span>
            <VariableTree data={item} />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-[#A89F91] italic">{'{ }'}</span>;
  return (
    <div className="mt-0.5 space-y-1.5 border-l border-[#3A322E] pl-2.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-col gap-0.5">
          <div className="flex gap-1.5">
            <span className="shrink-0 font-mono text-[11px] text-[#F4A261]">{key}</span>
            <span className="text-[#A89F91]">:</span>
            <span className="min-w-0 break-words">
              {isPrimitive(value) ? <VariableValue value={value} /> : null}
            </span>
          </div>
          {!isPrimitive(value) && <VariableTree data={value} />}
        </div>
      ))}
    </div>
  );
};

export const InfoRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3 py-1.5">
    <span className="shrink-0 text-[11px] text-[#A89F91]">{label}</span>
    <span className="min-w-0 break-words text-right text-[11px] text-[#EAE3D9]">{children}</span>
  </div>
);

/** Achieved confidence vs the APL threshold, rendered as a gauge with a marker. */
export const ConfidenceGauge: React.FC<{ achieved: number; threshold: number | undefined }> = ({
  achieved,
  threshold,
}) => {
  const passed = threshold === undefined || achieved >= threshold;
  const clamped = Math.min(100, Math.max(0, achieved));
  const thresholdClamped = threshold === undefined ? null : Math.min(100, Math.max(0, threshold));
  const barColor = passed ? 'bg-[#90A955]' : 'bg-[#E76F51]';
  return (
    <div className="mt-2 rounded-xl border border-[#3A322E] bg-[#25201D]/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#A89F91]">
          Achieved confidence
        </span>
        <span className={`font-mono text-[11px] font-semibold tabular-nums ${passed ? 'text-[#90A955]' : 'text-[#E76F51]'}`}>
          {achieved.toFixed(1)}%
          {threshold !== undefined && <span className="text-[#A89F91]"> / {threshold}%</span>}
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-[#1A1614]">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${clamped}%` }}
        />
        {thresholdClamped !== null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-[#EAE3D9]/80"
            style={{ left: `${thresholdClamped}%` }}
            title={`APL threshold: ${threshold}%`}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-[#A89F91]">
        <span>0%</span>
        {thresholdClamped !== null && <span className="font-mono">threshold {threshold}%</span>}
        <span>100%</span>
      </div>
      {!passed && (
        <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[#E76F51]">
          <AlertTriangle className="h-3 w-3" /> Below the APL threshold — this attempt would be rejected.
        </p>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Variables tab (searchable tree)                                     */
/* ------------------------------------------------------------------ */

export const VariablesTab: React.FC<{ variables: Record<string, unknown> | null }> = ({ variables }) => {
  const [variableSearch, setVariableSearch] = useState('');

  const filteredVariables = useMemo(() => {
    if (!variables) return null;
    const unwrapped = unwrapVariable(variables) as Record<string, unknown>;
    const query = variableSearch.trim().toLowerCase();
    if (!query) return unwrapped;
    const pick = (value: unknown, key: string): boolean =>
      key.toLowerCase().includes(query)
      || (typeof value === 'string' && value.toLowerCase().includes(query));
    const walk = (value: unknown, key: string): unknown => {
      if (isPrimitive(value)) return pick(value, key) ? value : undefined;
      if (Array.isArray(value)) {
        const mapped = value.map((item, index) => walk(item, `${key}[${index}]`));
        return mapped.some((item) => item !== undefined) ? mapped : undefined;
      }
      const entries = Object.entries(value as Record<string, unknown>);
      const kept = entries
        .map(([childKey, child]) => [childKey, walk(child, childKey)] as const)
        .filter(([, child]) => child !== undefined);
      return kept.length ? Object.fromEntries(kept) : undefined;
    };
    const result = walk(unwrapped, '');
    return result === undefined ? {} : (result as Record<string, unknown>);
  }, [variables, variableSearch]);

  return (
    <div className="p-4">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#A89F91]" />
        <input
          type="text"
          value={variableSearch}
          onChange={(event) => setVariableSearch(event.target.value)}
          placeholder="Search variables…"
          className="w-full rounded-lg border border-[#3A322E] bg-[#1A1614] py-1.5 pl-8 pr-3 text-[11px] text-[#EAE3D9] placeholder-[#A89F91] outline-none transition-all focus:border-[#F4A261]"
        />
      </div>
      <div className="rounded-xl border border-[#3A322E] bg-[#1A1614] p-3">
        {variables === null ? (
          <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-[#A89F91]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2A9D8F]" /> Reading variables…
          </div>
        ) : Object.keys(filteredVariables ?? {}).length === 0 ? (
          <p className="text-[11px] text-[#A89F91]">
            {variableSearch ? 'No variables match the search.' : 'No variables available.'}
          </p>
        ) : (
          <VariableTree data={filteredVariables} />
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Audit trail                                                         */
/* ------------------------------------------------------------------ */

export const AuditTimeline: React.FC<{ history: ActivityHistoryDTO[] }> = ({ history }) => {
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  if (history.length === 0) {
    return <p className="p-4 text-[11px] text-[#A89F91]">No audit events recorded yet.</p>;
  }

  return (
    <ol className="relative space-y-1 border-l border-[#3A322E] pl-4 p-4">
      {history.map((event) => {
        const meta = eventMeta(event.eventType);
        const Icon = EVENT_ICON[event.eventType] ?? Activity;
        const details = (event.details ?? {}) as Record<string, unknown>;
        const workerId = typeof details.workerId === 'string' ? details.workerId : undefined;
        const expanded = expandedEvent === event.id;
        return (
          <li key={event.id} className="relative pb-3">
            <span className={`absolute -left-[21px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-[#3A322E] bg-[#1A1614] ${TONE_TEXT[meta.tone]}`}>
              <Icon className="h-2.5 w-2.5" />
            </span>
            <button
              type="button"
              onClick={() => setExpandedEvent(expanded ? null : event.id)}
              className="w-full rounded-md px-2 py-1 text-left transition-colors hover:bg-[#2F2926]/60"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold text-[#EAE3D9]">{meta.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-[#A89F91]">
                  {new Date(event.occurredAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[#A89F91]">
                {event.activityId && <span className="font-mono">{humanize(event.activityId)}</span>}
                {workerId && <span className="font-mono text-[#2A9D8F]">worker {workerId}</span>}
                {event.actor && <span>by {event.actor}</span>}
                {event.traceId && <span className="font-mono text-[#A89F91]/70">trace {event.traceId.slice(0, 10)}</span>}
              </div>
            </button>
            {expanded && (
              <pre className="mt-1 overflow-x-auto rounded-lg border border-[#3A322E] bg-[#1A1614] p-2 font-mono text-[10px] leading-relaxed text-[#C9BFAF]">
                {JSON.stringify(details, null, 2)}
              </pre>
            )}
          </li>
        );
      })}
    </ol>
  );
};

/* ------------------------------------------------------------------ */
/* Node telemetry                                                      */
/* ------------------------------------------------------------------ */

export const failedJobsFor = (activityId: string, jobs: ProjectJob[]): ProjectJob[] =>
  jobs.filter((job) => job.activityId === activityId);

export const NodeIcon: React.FC<{ type: WorkflowFile['nodes'][number]['type']; subtype?: string }> = ({ type, subtype }) => {
  switch (type) {
    case 'agent': return <Bot className="h-4 w-4 text-[#9D4EDD]" />;
    case 'engine-task': return <Zap className="h-4 w-4 text-[#90A955]" />;
    case 'human': return <UserCheck className="h-4 w-4 text-[#E76F51]" />;
    case 'dmn': return <Table className="h-4 w-4 text-[#2A9D8F]" />;
    case 'gateway': return subtype === 'parallel'
      ? <GitMerge className="h-4 w-4 text-[#F4A261]" />
      : <GitFork className="h-4 w-4 text-[#F4A261]" />;
    case 'event': return <Circle className="h-4 w-4 text-[#F4A261]" />;
    default: return <Code2 className="h-4 w-4 text-[#F4A261]" />;
  }
};

/** Per-node telemetry card: config, AI attempt metadata, jobs and events. */
export const NodeTelemetry: React.FC<{
  nodeId: string;
  workflow: WorkflowFile;
  history: ActivityHistoryDTO[];
  jobs: ProjectJob[];
  variables: Record<string, unknown> | null;
  onRetry: (job: ProjectJob) => void;
}> = ({ nodeId, workflow, history, jobs, variables, onRetry }) => {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  const telemetry = aggregateNodeTelemetry(history, nodeId, jobs);
  if (!node) return <p className="text-[11px] text-[#A89F91]">Unknown node.</p>;

  const nodeEvents = history.filter((event) => event.activityId === nodeId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-lg border border-[#3A322E] bg-[#1A1614] p-1.5">
            <NodeIcon type={node.type} subtype={node.subtype} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-[#EAE3D9]">{node.title}</div>
            <div className="font-mono text-[10px] text-[#A89F91]">{node.id}</div>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-[#3A322E] bg-[#1A1614] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#A89F91]">
          {node.type}
        </span>
      </div>

      {/* AI agent telemetry */}
      {node.type === 'agent' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#9D4EDD]/30 bg-[#1A1614] p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9D4EDD]">
              <Bot className="h-3.5 w-3.5" /> Agent configuration
            </div>
            {node.agentConfig && (
              <>
                <InfoRow label="Model">
                  <span className="font-mono text-[#9D4EDD]">{node.agentConfig.model}</span>
                </InfoRow>
                <InfoRow label="Confidence threshold">{node.agentConfig.confidenceThreshold}%</InfoRow>
                <InfoRow label="Temperature">{node.agentConfig.temperature}</InfoRow>
                <InfoRow label="Result variable">
                  <span className="font-mono">{node.agentConfig.resultVariable ?? '—'}</span>
                </InfoRow>
                <InfoRow label="Tools">
                  {node.agentConfig.tools?.length ? node.agentConfig.tools.join(', ') : '—'}
                </InfoRow>
                {node.agentConfig.maxTokens !== undefined && <InfoRow label="Max tokens">{node.agentConfig.maxTokens}</InfoRow>}
                {node.agentConfig.maxAttempts !== undefined && <InfoRow label="Max attempts">{node.agentConfig.maxAttempts}</InfoRow>}
              </>
            )}
          </div>

          {telemetry.agent && (
            <div className="rounded-xl border border-[#2A9D8F]/30 bg-[#1A1614] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#2A9D8F]">
                <Activity className="h-3.5 w-3.5" /> Attempt telemetry
              </div>
              {telemetry.agent.confidence !== undefined && (
                <ConfidenceGauge
                  achieved={telemetry.agent.confidence}
                  threshold={telemetry.agent.confidenceThreshold
                    ?? node.agentConfig?.confidenceThreshold}
                />
              )}
              {telemetry.agent.model && <InfoRow label="Executed model"><span className="font-mono">{telemetry.agent.model}</span></InfoRow>}
              {telemetry.agent.provider && <InfoRow label="Provider">{telemetry.agent.provider}</InfoRow>}
              {telemetry.agent.attempt !== undefined && <InfoRow label="Attempt">{telemetry.agent.attempt}</InfoRow>}
              {telemetry.agent.durationMs !== undefined && <InfoRow label="Latency">{formatDuration(telemetry.agent.durationMs)}</InfoRow>}
              {telemetry.agent.resultVariable && <InfoRow label="Result variable"><span className="font-mono">{telemetry.agent.resultVariable}</span></InfoRow>}
              {telemetry.agent.errorType && <InfoRow label="Error type"><span className="text-[#E76F51]">{telemetry.agent.errorType}</span></InfoRow>}
              {telemetry.agent.promptHash && <InfoRow label="Prompt hash"><span className="font-mono text-[10px]">{telemetry.agent.promptHash.slice(0, 16)}…</span></InfoRow>}
              {telemetry.workerIds.length > 0 && <InfoRow label="Workers">{telemetry.workerIds.join(', ')}</InfoRow>}
              {telemetry.retries > 0 && <InfoRow label="Retries left">{telemetry.retries}</InfoRow>}
            </div>
          )}

          <p className="rounded-xl border border-dashed border-[#3A322E] bg-[#1A1614] p-3 text-[10px] leading-relaxed text-[#A89F91]">
            The engine persists model/tool metadata only — prompts, request/response payloads and token counts are not stored (privacy by design). The APL-declared prompt is available in the definition source.
          </p>
        </div>
      )}

      {/* Human task */}
      {node.type === 'human' && (
        <div className="space-y-3">
          {node.humanConfig && (
            <div className="rounded-xl border border-[#E76F51]/30 bg-[#1A1614] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#E76F51]">
                <UserCheck className="h-3.5 w-3.5" /> Human task
              </div>
              <InfoRow label="Assignee role">{node.humanConfig.assigneeRole}</InfoRow>
              <InfoRow label="SLA">{node.humanConfig.slaHours}h</InfoRow>
              {node.humanConfig.escalationRole && <InfoRow label="Escalation">{node.humanConfig.escalationRole}</InfoRow>}
            </div>
          )}
          {nodeEvents.length === 0 && (
            <p className="text-[11px] text-[#A89F91]">No task events recorded for this node yet.</p>
          )}
        </div>
      )}

      {/* Engine task */}
      {node.type === 'engine-task' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#90A955]/30 bg-[#1A1614] p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#90A955]">
              <Zap className="h-3.5 w-3.5" /> External job
            </div>
            <InfoRow label="Topic"><span className="font-mono">{node.engineTaskConfig?.service ?? '—'}</span></InfoRow>
            {telemetry.workerIds.length > 0 && <InfoRow label="Workers">{telemetry.workerIds.join(', ')}</InfoRow>}
            <InfoRow label="Retries left">{telemetry.retries}</InfoRow>
            {telemetry.errorMessage && (
              <div className="mt-2 rounded-lg border border-[#E76F51]/30 bg-[#E76F51]/10 p-2 text-[10px] text-[#E76F51]">
                {telemetry.errorMessage}
              </div>
            )}
          </div>

          {failedJobsFor(nodeId, jobs).map((job) => (
            <div key={job.id} className="flex items-center justify-between gap-2 rounded-xl border border-[#E76F51]/30 bg-[#1A1614] p-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] text-[#A89F91]">{job.id.slice(0, 12)}…</div>
                {job.exceptionMessage && (
                  <div className="mt-0.5 truncate text-[10px] text-[#E76F51]" title={job.exceptionMessage}>
                    {job.exceptionMessage}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRetry(job)}
                className="shrink-0 rounded-lg border border-[#90A955]/40 bg-[#90A955]/10 px-2.5 py-1 text-[10px] font-semibold text-[#90A955] transition-all hover:bg-[#90A955]/20"
                title="Requeue this job for execution"
              >
                Retry
              </button>
            </div>
          ))}
        </div>
      )}

      {/* DMN */}
      {node.type === 'dmn' && (
        <div className="space-y-3">
          {node.dmnConfig && (
            <div className="rounded-xl border border-[#2A9D8F]/30 bg-[#1A1614] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#2A9D8F]">
                <Table className="h-3.5 w-3.5" /> Decision table
              </div>
              <InfoRow label="Decision key"><span className="font-mono">{node.dmnConfig.decisionKey}</span></InfoRow>
              <InfoRow label="Hit policy">{node.dmnConfig.hitPolicy}</InfoRow>
              <InfoRow label="Rules">{node.dmnConfig.rules.length}</InfoRow>
            </div>
          )}
          {variables && node.dmnConfig && (
            <div className="rounded-xl border border-[#3A322E] bg-[#1A1614] p-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#A89F91]">Applied outputs</div>
              {node.dmnConfig.outputs.map((output) => {
                const unwrapped = unwrapVariable(variables);
                const value = unwrapped && typeof unwrapped === 'object'
                  ? (unwrapped as Record<string, unknown>)[output.name]
                  : undefined;
                return (
                  <InfoRow key={output.name} label={output.name}>
                    {value === undefined ? '—' : String(value)}
                  </InfoRow>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Gateway / event / default */}
      {(node.type === 'gateway' || node.type === 'event') && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#3A322E] bg-[#1A1614] p-3">
            <InfoRow label="Description">{node.description}</InfoRow>
            {node.type === 'gateway' && node.subtype && <InfoRow label="Kind">{node.subtype}</InfoRow>}
          </div>
          {nodeEvents.length === 0 && (
            <p className="text-[11px] text-[#A89F91]">No execution events recorded for this node.</p>
          )}
        </div>
      )}

      {/* Events for this node */}
      {nodeEvents.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#A89F91]">Events</div>
          <div className="space-y-1">
            {nodeEvents.map((event) => {
              const meta = eventMeta(event.eventType);
              return (
                <div key={event.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#3A322E] bg-[#1A1614] px-2.5 py-1.5">
                  <span className={`text-[10px] font-semibold ${TONE_TEXT[meta.tone]}`}>{meta.label}</span>
                  <span className="font-mono text-[10px] text-[#A89F91]">
                    {new Date(event.occurredAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
