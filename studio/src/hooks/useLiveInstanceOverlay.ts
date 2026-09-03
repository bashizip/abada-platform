import { useState, useCallback, useEffect, useRef } from 'react';
import { EngineAPI, ProcessInstanceDTO } from '@/api/engine';
import { Project } from '@/api/projects';
import { WorkflowFile, SimulationLog } from '@/types';
import { deriveLiveExecutionOverlay, NodeRunStatus } from '@/lib/run/liveRun';
import { deriveInstancePath } from '@/lib/run/instanceDetail';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';
import { applyPreferredLayout } from '@/lib/run/layoutPrefs';
import { readInspectorPanelPinned, readInspectorPanelWidth, useInspectorPanelPrefs } from '@/lib/run/panelPrefs';

/**
 * Terminal statuses where the token animation should stop (the taken path
 * stays visible, but marching dots are suppressed).
 */
const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'];

export function useLiveInstanceOverlay(
  activeProject: Project | undefined,
  workflows: WorkflowFile[],
  setSidebarTab: (tab: 'files' | 'palette' | 'instances') => void,
  setDesignerMode: (mode: 'diagram' | 'apl') => void,
  setShowRunPanel: (show: boolean) => void,
  setCurrentView: (view: 'designer' | 'inbox' | 'operations' | 'instance') => void,
  setSimulationLogs: React.Dispatch<React.SetStateAction<SimulationLog[]>>
) {
  const [selectedLiveInstance, setSelectedLiveInstance] = useState<ProcessInstanceDTO | null>(null);
  const [liveWorkflow, setLiveWorkflow] = useState<WorkflowFile | null>(null);
  const [activeLiveNodeIds, setActiveLiveNodeIds] = useState<string[]>([]);
  const [liveSelectedNodeId, setLiveSelectedNodeId] = useState<string | null>(null);
  const [executionStatuses, setExecutionStatuses] = useState<Record<string, NodeRunStatus>>({});
  const [activePathEdges, setActivePathEdges] = useState<string[]>([]);
  const [activeTokenEdges, setActiveTokenEdges] = useState<string[]>([]);
  const [nextPathEdges, setNextPathEdges] = useState<string[]>([]);
  const [instancesRefreshKey, setInstancesRefreshKey] = useState(0);
  const [instancePanelOpen, setInstancePanelOpen] = useState(true);
  const [detailInstance, setDetailInstance] = useState<ProcessInstanceDTO | null>(null);

  const {
    panelWidth: livePanelWidth,
    setPanelWidth: setLivePanelWidth,
    pinned: livePanelPinned,
    setPinned: setLivePanelPinned,
  } = useInspectorPanelPrefs();

  /**
   * Content-stable cache: polls return new object identities for the same
   * engine facts. Serializing and comparing prevents state updates (and SMIL
   * animation restarts) when nothing actually changed.
   */
  const stablePathRef = useRef<string | null>(null);

  const applyPathOverlay = useCallback((
    workflow: WorkflowFile,
    instance: ProcessInstanceDTO,
    activities: import('@/api/engine').ActivityInstanceDTO[],
    history: import('@/api/engine').ActivityHistoryDTO[],
  ) => {
    const path = deriveInstancePath(workflow, instance, activities, history);
    const serialized = JSON.stringify(path);
    if (stablePathRef.current === serialized) return;
    stablePathRef.current = serialized;
    setActivePathEdges(path.activePathEdgeIds);
    const isTerminal = TERMINAL_STATUSES.includes(
      (instance.status || '').toUpperCase(),
    );
    const frozen = isTerminal || instance.suspended;
    setActiveTokenEdges(frozen ? [] : path.tokenEdgeIds);
    setNextPathEdges(frozen ? [] : path.nextEdgeIds);
  }, []);

  const openInstanceDetail = useCallback((instance: ProcessInstanceDTO) => {
    setSelectedLiveInstance(null);
    setLiveWorkflow(null);
    setActiveLiveNodeIds([]);
    setLiveSelectedNodeId(null);
    setExecutionStatuses({});
    setActivePathEdges([]);
    setActiveTokenEdges([]);
    setNextPathEdges([]);
    stablePathRef.current = null;
    setInstancePanelOpen(false);
    setDetailInstance(instance);
    setCurrentView('instance');
  }, [setCurrentView]);

  const openLiveInstance = useCallback(async (instance: ProcessInstanceDTO) => {
    if (!activeProject) return;
    setLivePanelWidth(readInspectorPanelWidth());
    setLivePanelPinned(readInspectorPanelPinned());
    setSelectedLiveInstance(instance);
    setSidebarTab('instances');
    setDesignerMode('diagram');
    setShowRunPanel(false);
    setInstancePanelOpen(true);
    stablePathRef.current = null;

    try {
      const definition = await EngineAPI.getDefinitionForInstance(instance, activeProject.id);
      let instanceWorkflow = workflows.find((workflow) => workflow.processKey === instance.processDefinitionId) || null;
      if (definition?.schemaType === 'APL_NATIVE' && definition.bpmnXml) {
        const parsed = aplToWorkflow(parseAPLYaml(definition.bpmnXml));
        instanceWorkflow = { ...parsed, id: `instance-${instance.id}`, version: String(definition.version) };
      }
      if (!instanceWorkflow) throw new Error('The immutable definition for this instance is unavailable');
      // Apply the user's preferred layout if one has been saved for this process
      const layoutKey = instance.processDefinitionId;
      instanceWorkflow = {
        ...instanceWorkflow,
        nodes: applyPreferredLayout(layoutKey, instanceWorkflow.nodes),
      };
      setLiveWorkflow(instanceWorkflow);

      const [fresh, activities, history] = await Promise.all([
        EngineAPI.getInstance(instance.id, activeProject.id),
        EngineAPI.getActivityInstances(instance.id, activeProject.id),
        EngineAPI.getInstanceHistory(instance.id, activeProject.id),
      ]);
      setSelectedLiveInstance(fresh);
      setLiveSelectedNodeId(fresh.currentActivityId ?? instanceWorkflow.nodes[0]?.id ?? null);
      const overlay = deriveLiveExecutionOverlay(instanceWorkflow, fresh, activities, history);
      setExecutionStatuses(overlay.statuses);
      setActiveLiveNodeIds(overlay.activeNodeIds);
      applyPathOverlay(instanceWorkflow, fresh, activities, history);
    } catch (reason) {
      setSimulationLogs((logs) => [...logs, {
        id: `instance-view-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system',
        nodeTitle: 'Live Instance', nodeType: 'event', status: 'error',
        message: reason instanceof Error ? reason.message : String(reason),
      }]);
    }
  }, [activeProject, workflows, setLivePanelWidth, setLivePanelPinned, setSidebarTab, setDesignerMode, setShowRunPanel, setSimulationLogs, applyPathOverlay]);

  const selectedLiveInstanceId = selectedLiveInstance?.id;
  const selectedLiveInstanceStatus = selectedLiveInstance?.status;

  useEffect(() => {
    if (!activeProject || !selectedLiveInstanceId || !liveWorkflow) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [fresh, activities, history] = await Promise.all([
          EngineAPI.getInstance(selectedLiveInstanceId, activeProject.id),
          EngineAPI.getActivityInstances(selectedLiveInstanceId, activeProject.id),
          EngineAPI.getInstanceHistory(selectedLiveInstanceId, activeProject.id),
        ]);
        if (cancelled) return;
        setSelectedLiveInstance(fresh);
        const overlay = deriveLiveExecutionOverlay(liveWorkflow, fresh, activities, history);
        setExecutionStatuses(overlay.statuses);
        setActiveLiveNodeIds(overlay.activeNodeIds);
        applyPathOverlay(liveWorkflow, fresh, activities, history);
      } catch {
        // Keep the last authoritative snapshot visible; the next poll retries.
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      const terminal = selectedLiveInstanceStatus?.toUpperCase() || '';
      if (!TERMINAL_STATUSES.includes(terminal)) void refresh();
    }, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeProject, liveWorkflow, selectedLiveInstanceId, selectedLiveInstanceStatus, applyPathOverlay]);

  const clearLiveInstanceState = useCallback(() => {
    setSelectedLiveInstance(null);
    setLiveWorkflow(null);
    setActiveLiveNodeIds([]);
    setLiveSelectedNodeId(null);
    setExecutionStatuses({});
    setActivePathEdges([]);
    setActiveTokenEdges([]);
    setNextPathEdges([]);
    stablePathRef.current = null;
  }, []);

  return {
    selectedLiveInstance,
    liveWorkflow,
    activeLiveNodeIds,
    liveSelectedNodeId,
    setLiveSelectedNodeId,
    executionStatuses,
    activePathEdges,
    activeTokenEdges,
    nextPathEdges,
    setExecutionStatuses,
    instancesRefreshKey,
    setInstancesRefreshKey,
    instancePanelOpen,
    setInstancePanelOpen,
    detailInstance,
    setDetailInstance,
    livePanelWidth,
    setLivePanelWidth,
    livePanelPinned,
    setLivePanelPinned,
    openLiveInstance,
    openInstanceDetail,
    clearLiveInstanceState,
  };
}
