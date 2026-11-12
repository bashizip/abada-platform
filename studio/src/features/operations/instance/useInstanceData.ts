import { useCallback, useEffect, useState } from 'react';
import {
  ActivityHistoryDTO, ActivityInstanceDTO, EngineAPI, ProcessDefinitionDTO, ProcessInstanceDTO, ProjectJob,
} from '@/api/engine';
import { AgentStepEvidence, EvidenceAPI } from '@/api/evidence';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';
import { useInstanceEvents } from '@/hooks/useInstanceEvents';
import { applyPreferredLayout } from '@/lib/run/layoutPrefs';
import { buildExecutionTrace } from '@/lib/run/instanceDetail';
import { statusOf } from '@/lib/run/instanceFormat';
import { WorkflowFile } from '@/types';

/**
 * Everything the instance view reads: the instance, its immutable definition
 * as a workflow, activities, history, variables, jobs and agent steps. Live
 * from the project event stream while the instance advances, polling as the
 * fallback (2 s without the stream, 15 s as a safety net with it).
 */
export function useInstanceData(projectId: string | undefined, instanceId: string,
  initialInstance: ProcessInstanceDTO, onRefresh?: () => void) {
  const [instance, setInstance] = useState<ProcessInstanceDTO>(initialInstance);
  const [workflow, setWorkflow] = useState<WorkflowFile | null>(null);
  const [definition, setDefinition] = useState<ProcessDefinitionDTO | null>(null);
  const [activities, setActivities] = useState<ActivityInstanceDTO[]>([]);
  const [history, setHistory] = useState<ActivityHistoryDTO[]>([]);
  const [variables, setVariables] = useState<Record<string, unknown> | null>(null);
  const [jobs, setJobs] = useState<ProjectJob[]>([]);
  const [agentSteps, setAgentSteps] = useState<AgentStepEvidence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (fresh: boolean) => {
    if (!projectId) return;
    try {
      setError(null);
      const [inst, act, hist] = await Promise.all([
        EngineAPI.getInstance(instanceId, projectId),
        EngineAPI.getActivityInstances(instanceId, projectId),
        EngineAPI.getInstanceHistory(instanceId, projectId),
      ]);
      setInstance(inst);
      setActivities(act);
      setHistory(hist);
      if (fresh) {
        const def = await EngineAPI.getDefinitionForInstance(inst, projectId);
        setDefinition(def);
        if (def?.schemaType === 'APL_NATIVE' && def.bpmnXml) {
          const wf = aplToWorkflow(parseAPLYaml(def.bpmnXml));
          setWorkflow({ ...wf, nodes: applyPreferredLayout(inst.processDefinitionId, wf.nodes) });
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId, instanceId]);

  /* Variables, jobs and agent steps: a slower read, refreshed with the rest. */
  const loadDetails = useCallback(async () => {
    if (!projectId) return;
    try {
      const [vars, jobList] = await Promise.all([
        EngineAPI.getInstanceVariables(instanceId, projectId),
        EngineAPI.getJobs(projectId),
      ]);
      setVariables(vars);
      setJobs(jobList);
      setAgentSteps(await EvidenceAPI.steps(projectId, instanceId).catch(() => []));
    } catch {
      // Keep the last known snapshot; the next tick retries.
    }
  }, [projectId, instanceId]);

  useEffect(() => {
    void load(true);
    void loadDetails();
  }, [load, loadDetails]);

  const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(statusOf(instance));
  const refresh = useCallback(() => {
    void load(false);
    void loadDetails();
    onRefresh?.();
  }, [load, loadDetails, onRefresh]);
  const live = useInstanceEvents(isTerminal ? undefined : projectId, instanceId, refresh) === 'live';
  useEffect(() => {
    if (isTerminal) return;
    const timer = window.setInterval(refresh, live ? 15_000 : 2000);
    return () => window.clearInterval(timer);
  }, [isTerminal, live, refresh]);

  const exportTrace = useCallback(() => {
    const payload = buildExecutionTrace(instance, definition, activities, history, variables, jobs);
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `execution-trace-${instance.id.slice(0, 8)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [instance, definition, activities, history, variables, jobs]);

  return {
    instance, workflow, definition, activities, history, variables, jobs, agentSteps,
    error, loading, isTerminal, live, load, refresh, exportTrace,
  };
}
