import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle,
  Clock,
  FileText,
  Inbox,
  Loader2,
  RotateCcw,
  ShieldAlert,
  User,
  XCircle,
} from 'lucide-react';
import { EngineAPI, EngineUserTaskDTO } from '@/api/engine';
import { ProjectAPI } from '@/api/projects';
import { useToast } from '@/components/ToastContext';
import {
  FormRenderer,
} from '@/features/inbox/FormRenderer';
import {
  FormSchema,
  formValuesFromSchema,
  validateForm,
} from '@/features/inbox/formSchema';

type Filter = 'all' | 'AVAILABLE' | 'CLAIMED';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'AVAILABLE', label: 'Available' },
  { key: 'CLAIMED', label: 'Claimed' },
];

const STATUS_META: Record<string, { label: string; chip: string; dot: string }> = {
  AVAILABLE: { label: 'Available', chip: 'bg-[#F4A261]/10 text-[#F4A261] border-[#F4A261]/30', dot: 'bg-[#F4A261]' },
  CLAIMED: { label: 'Claimed', chip: 'bg-[#9D4EDD]/10 text-[#9D4EDD] border-[#9D4EDD]/30', dot: 'bg-[#9D4EDD]' },
  COMPLETED: { label: 'Completed', chip: 'bg-[#2A9D8F]/10 text-[#2A9D8F] border-[#2A9D8F]/30', dot: 'bg-[#2A9D8F]' },
  FAILED: { label: 'Failed', chip: 'bg-[#E76F51]/10 text-[#E76F51] border-[#E76F51]/30', dot: 'bg-[#E76F51]' },
};

function decodeBase64(content: string): string {
  try {
    return decodeURIComponent(escape(atob(content)));
  } catch {
    return atob(content);
  }
}

export const TaskInbox: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<EngineUserTaskDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedTask, setSelectedTask] = useState<EngineUserTaskDTO | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await EngineAPI.getTasks(filter === 'all' ? undefined : filter, projectId);
      setTasks(data);
      setSelectedTask((current) => (current && data.some((t) => t.id === current.id) ? current : null));
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, showToast]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const loadForm = useCallback(async (task: EngineUserTaskDTO) => {
    setSchema(null);
    setFormValues({});
    setFormErrors({});
    if (!task.formKey || !task.projectId) return;
    setFormLoading(true);
    try {
      const resource = await ProjectAPI.resolveForm(task.projectId, task.formKey);
      const parsed = JSON.parse(decodeBase64(resource.contentBase64)) as FormSchema;
      if (parsed && Array.isArray(parsed.fields)) {
        setSchema(parsed);
        setFormValues(formValuesFromSchema(parsed, task.variables ?? {}));
      } else {
        showToast('error', `Form '${task.formKey}' is not a valid form schema`);
      }
    } catch (err) {
      showToast('error', `Could not load form '${task.formKey}': ${
        err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setFormLoading(false);
    }
  }, [showToast]);

  const selectTask = (task: EngineUserTaskDTO) => {
    setSelectedTask(task);
    void loadForm(task);
  };

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setActionLoading(true);
    try {
      await action();
      showToast('success', success);
      if (selectedTask) setSelectedTask(null);
      await fetchTasks();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClaim = () => {
    if (!selectedTask?.projectId) return;
    void runAction(() => EngineAPI.claimTask(selectedTask.id, selectedTask.projectId!), 'Task claimed');
  };

  const handleUnclaim = () => {
    if (!selectedTask?.projectId) return;
    void runAction(() => EngineAPI.unclaimTask(selectedTask.id, selectedTask.projectId!), 'Task unclaimed');
  };

  const handleFail = () => {
    if (!selectedTask?.projectId) return;
    void runAction(() => EngineAPI.failTask(selectedTask.id, selectedTask.projectId!), 'Task failed');
  };

  const handleComplete = () => {
    if (!selectedTask?.projectId) return;
    let variables: Record<string, unknown> = {};
    if (schema) {
      const errors = validateForm(schema, formValues);
      setFormErrors(errors);
      if (Object.keys(errors).length > 0) {
        showToast('error', 'Please fix the highlighted form fields');
        return;
      }
      variables = { ...formValues };
    } else {
      variables = { decision: 'APPROVED', notes: 'Completed from the Studio Task Inbox' };
    }
    void runAction(() => EngineAPI.completeTask(selectedTask.id, variables, selectedTask.projectId!), 'Task completed');
  };

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '')),
    [tasks],
  );

  const meta = selectedTask ? STATUS_META[selectedTask.status ?? ''] : null;

  return (
    <div className="flex flex-1 overflow-hidden bg-[#1A1614] text-[#EAE3D9]">
      {/* Task list */}
      <div className="w-80 border-r border-[#3A322E] flex flex-col bg-[#25201D] shrink-0">
        <div className="p-4 border-b border-[#3A322E]">
          <h2 className="text-lg font-semibold text-[#EAE3D9] flex items-center gap-2">
            <Inbox className="text-[#2A9D8F]" />
            Human Inbox
          </h2>
          <p className="text-xs text-[#A89F91]">Review, decide and complete your tasks</p>
          <div className="flex items-center gap-1 mt-3 bg-[#1A1614] rounded-full border border-[#3A322E] p-0.5">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                className={`flex-1 text-[11px] px-2 py-1 rounded-full transition-all font-medium ${
                  filter === item.key
                    ? 'bg-[#25201D] text-[#EAE3D9] border border-[#3A322E]'
                    : 'text-[#A89F91] hover:text-[#EAE3D9] border border-transparent'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-[#9D4EDD] animate-spin" />
            </div>
          ) : sortedTasks.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#A89F91]">
              <Inbox className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No tasks here.
            </div>
          ) : (
            sortedTasks.map((task) => {
              const m = STATUS_META[task.status ?? ''];
              return (
                <button
                  key={task.id}
                  onClick={() => selectTask(task)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedTask?.id === task.id
                      ? 'bg-[#1A1614] border-[#F4A261]/50 shadow-warm-md'
                      : 'bg-[#25201D] border-[#3A322E] hover:bg-[#2F2926]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">{task.name || 'Unnamed task'}</span>
                    {m && (
                      <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0 ${m.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                        {m.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#A89F91] mt-1.5">
                    <span className="flex items-center gap-1 truncate">
                      <FileText className="w-3 h-3 shrink-0" />
                      <span className="truncate">{task.processDefinitionName || task.processDefinitionId || 'Process'}</span>
                    </span>
                    {task.startDate && (
                      <span className="flex items-center gap-1 shrink-0">
                        <Clock className="w-3 h-3" />
                        {new Date(task.startDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {task.formKey && (
                    <div className="mt-1.5 text-[10px] font-mono text-[#2A9D8F]">form: {task.formKey}</div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Task detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedTask ? (
          <div className="flex-1 overflow-y-auto">
            <div className="p-8 max-w-3xl mx-auto w-full space-y-5">
              <div className="flex items-start justify-between gap-4 pb-5 border-b border-[#3A322E]">
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold text-[#EAE3D9]">{selectedTask.name || 'Unnamed task'}</h1>
                    {meta && (
                      <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${meta.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#A89F91] mt-1 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    {selectedTask.processDefinitionName || selectedTask.processDefinitionId}
                    {selectedTask.processDefinitionId && (
                      <span className="font-mono">· {selectedTask.processDefinitionId}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedTask.status === 'AVAILABLE' && (
                    <button
                      onClick={handleClaim}
                      disabled={actionLoading}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] disabled:opacity-40 transition-all"
                    >
                      <User className="w-3.5 h-3.5" />
                      Claim
                    </button>
                  )}
                  {selectedTask.status === 'CLAIMED' && (
                    <>
                      <button
                        onClick={handleUnclaim}
                        disabled={actionLoading}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-[#3A322E] text-[#A89F91] hover:text-[#EAE3D9] disabled:opacity-40 transition-all"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Unclaim
                      </button>
                      <button
                        onClick={handleComplete}
                        disabled={actionLoading}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] disabled:opacity-40 transition-all"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Complete
                      </button>
                    </>
                  )}
                  {(selectedTask.status === 'AVAILABLE' || selectedTask.status === 'CLAIMED') && (
                    <button
                      onClick={handleFail}
                      disabled={actionLoading}
                      title="Mark the task as failed"
                      className="flex items-center justify-center h-8 w-8 rounded-lg border border-[#E76F51]/40 text-[#E76F51] hover:bg-[#2F2926] disabled:opacity-40 transition-all"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <InfoTile label="Assignee" value={selectedTask.assignee || 'Unassigned'} />
                <InfoTile label="Created" value={selectedTask.startDate ? new Date(selectedTask.startDate).toLocaleString() : '—'} />
                <InfoTile label="Candidates" value={selectedTask.candidateGroups?.join(', ') || selectedTask.candidateUsers?.join(', ') || '—'} />
                <InfoTile label="Project" value={selectedTask.projectId ? selectedTask.projectId.slice(0, 8) : '—'} mono />
              </div>

              {formLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 text-[#9D4EDD] animate-spin" />
                </div>
              ) : schema ? (
                <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl p-5 shadow-warm-md">
                  <h3 className="text-sm font-semibold text-[#F4A261] mb-4 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Task Form
                    <span className="ml-auto text-[10px] font-mono text-[#A89F91]">{selectedTask.formKey}</span>
                  </h3>
                  <FormRenderer
                    schema={schema}
                    values={formValues}
                    onChange={setFormValues}
                    errors={formErrors}
                    readOnly={selectedTask.status !== 'CLAIMED'}
                  />
                  {selectedTask.status === 'CLAIMED' && (
                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={handleComplete}
                        disabled={actionLoading}
                        className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] disabled:opacity-40 transition-all"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Submit
                      </button>
                    </div>
                  )}
                </div>
              ) : selectedTask.formKey ? (
                <div className="flex flex-col items-center justify-center py-12 text-[#A89F91] rounded-2xl border border-dashed border-[#3A322E]">
                  <ShieldAlert className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-sm">Could not load form <span className="font-mono text-[#E76F51]">{selectedTask.formKey}</span></p>
                </div>
              ) : (
                <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl p-5 shadow-warm-md">
                  <h3 className="text-sm font-semibold text-[#F4A261] mb-3">Decision</h3>
                  <div className="flex gap-3">
                    <button
                      onClick={handleComplete}
                      disabled={actionLoading || selectedTask.status !== 'CLAIMED'}
                      className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] disabled:opacity-40 transition-all"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        if (!selectedTask.projectId) return;
                        void runAction(
                          () => EngineAPI.completeTask(selectedTask.id, { decision: 'REJECTED', notes: 'Rejected from the Studio Task Inbox' }, selectedTask.projectId!),
                          'Task completed',
                        );
                      }}
                      disabled={actionLoading || selectedTask.status !== 'CLAIMED'}
                      className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[#E76F51] hover:bg-[#f07b5d] text-[#1A1614] disabled:opacity-40 transition-all"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {selectedTask.variables && Object.keys(selectedTask.variables).length > 0 && (
                <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl p-5 shadow-warm-md">
                  <h3 className="text-sm font-semibold text-[#A89F91] mb-3">Process variables</h3>
                  <pre className="text-[11px] font-mono text-[#EAE3D9] bg-[#1A1614] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(selectedTask.variables, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#A89F91]">
            <Inbox className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">Select a task from the inbox to review.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const InfoTile: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="rounded-xl border border-[#3A322E] bg-[#25201D] p-3">
    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F91]">{label}</div>
    <div className={`mt-1 text-sm text-[#EAE3D9] truncate ${mono ? 'font-mono text-xs' : ''}`} title={value}>{value}</div>
  </div>
);
