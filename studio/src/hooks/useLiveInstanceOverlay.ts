import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityHistoryDTO, ActivityInstanceDTO, EngineAPI, ProcessInstanceDTO } from '@/api/engine';
import { Project } from '@/api/projects';
import { WorkflowFile, SimulationLog } from '@/types';
import { deriveLiveExecutionOverlay, NodeRunStatus } from '@/lib/run/liveRun';
import { deriveInstancePath } from '@/lib/run/instanceDetail';
import { useInstancePlayback } from '@/hooks/useInstancePlayback';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';
import { applyPreferredLayout } from '@/lib/run/layoutPrefs';
import { useInstanceEvents } from '@/hooks/useInstanceEvents';
import { readInspectorPanelPinned, readInspectorPanelWidth, useInspectorPanelPrefs } from '@/lib/run/panelPrefs';

/**
 * Terminal statuses where the token animation should stop (the taken path
 * stays visible, but marching dots are suppressed).
 */
const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'];

const NO_FACTS = { activities: [], history: [] };
const EMPTY: string[] = [];

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
  const [liveSelectedNodeId, setLiveSelectedNodeId] = useState<string | null>(null);
  /** Statuses a Dry Run paints on the designer canvas; a live instance derives its own. */
  const [dryRunStatuses, setExecutionStatuses] = useState<Record<string, NodeRunStatus>>({});
  /** The engine facts of the live instance, as last fetched. */
  const [facts, setFacts] = useState<{ activities: ActivityInstanceDTO[]; history: ActivityHistoryDTO[] }>(NO_FACTS);
  const [instancesRefreshKey, setInstancesRefreshKey] = useState(0);
  const [instancePanelOpen, setInstancePanelOpen] = useState(true);
  const [detailInstance, setDetailInstance] = useState<ProcessInstanceDTO | null>(null);
  /** Step the instance view opens focused on (an incident's node, M5 S4). */
  const [detailFocusNodeId, setDetailFocusNodeId] = useState<string | undefined>(undefined);
  /** The instance the user just started from the Studio: its view plays it from the first fact (M5 S5). */
  const [detailStartedId, setDetailStartedId] = useState<string | null>(null);

  const {
    panelWidth: livePanelWidth,
    setPanelWidth: setLivePanelWidth,
    pinned: livePanelPinned,
    setPinned: setLivePanelPinned,
  } = useInspectorPanelPrefs();

  const openInstanceDetail = useCallback((instance: ProcessInstanceDTO, focusNodeId?: string,
    options: { justStarted?: boolean } = {}) => {
    setSelectedLiveInstance(null);
    setLiveWorkflow(null);
    setLiveSelectedNodeId(null);
    setExecutionStatuses({});
    setFacts(NO_FACTS);
    setInstancePanelOpen(false);
    setDetailInstance(instance);
    setDetailFocusNodeId(focusNodeId);
    setDetailStartedId(options.justStarted ? instance.id : null);
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
    setFacts(NO_FACTS);

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
      setFacts({ activities, history });
    } catch (reason) {
      setSimulationLogs((logs) => [...logs, {
        id: `instance-view-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system',
        nodeTitle: 'Live Instance', nodeType: 'event', status: 'error',
        message: reason instanceof Error ? reason.message : String(reason),
      }]);
    }
  }, [activeProject, workflows, setLivePanelWidth, setLivePanelPinned, setSidebarTab, setDesignerMode, setShowRunPanel, setSimulationLogs]);

  const selectedLiveInstanceId = selectedLiveInstance?.id;
  const selectedLiveInstanceStatus = selectedLiveInstance?.status;
  // Each stream event of the instance refreshes the overlay; polling is the fallback.
  const [eventTick, setEventTick] = useState(0);
  const onInstanceEvent = useCallback(() => setEventTick((tick) => tick + 1), []);
  const liveTerminal = TERMINAL_STATUSES.includes(selectedLiveInstanceStatus?.toUpperCase() || '');
  const streamState = useInstanceEvents(liveTerminal ? undefined : activeProject?.id, selectedLiveInstanceId,
    onInstanceEvent);
  const streamLive = streamState === 'live';

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
        setFacts({ activities, history });
      } catch {
        // Keep the last authoritative snapshot visible; the next poll retries.
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      const terminal = selectedLiveInstanceStatus?.toUpperCase() || '';
      if (!TERMINAL_STATUSES.includes(terminal)) void refresh();
    }, streamLive ? 15_000 : 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeProject, liveWorkflow, selectedLiveInstanceId, selectedLiveInstanceStatus, streamLive, eventTick]);

  /* ---- The canvas plays the instance back one flow at a time (M5 S3) ---- */
  const playback = useInstancePlayback(liveWorkflow, selectedLiveInstance, facts.activities, facts.history);
  const frame = playback.frame;
  const overlay = useMemo(() => {
    if (!liveWorkflow || !frame || facts.history.length === 0) return null;
    return {
      live: deriveLiveExecutionOverlay(liveWorkflow, frame.instance, frame.activities, frame.history),
      path: deriveInstancePath(liveWorkflow, frame.instance, frame.activities, frame.history),
    };
  }, [liveWorkflow, frame, facts.history.length]);

  /**
   * Content-stable projection: polls return new object identities for the
   * same engine facts. Keeping the identity when nothing changed prevents
   * Canvas re-renders (and SMIL animation restarts).
   */
  const stableOverlay = useRef<{ serialized: string; value: typeof overlay }>({ serialized: 'null', value: null });
  const serialized = JSON.stringify(overlay);
  if (stableOverlay.current.serialized !== serialized) stableOverlay.current = { serialized, value: overlay };
  const view = stableOverlay.current.value;
  const status = (selectedLiveInstance?.status || '').toUpperCase();
  const frozen = TERMINAL_STATUSES.includes(status) || !!selectedLiveInstance?.suspended;
  const executionStatuses = view ? view.live.statuses : dryRunStatuses;

  const clearLiveInstanceState = useCallback(() => {
    setSelectedLiveInstance(null);
    setLiveWorkflow(null);
    setLiveSelectedNodeId(null);
    setExecutionStatuses({});
    setFacts(NO_FACTS);
  }, []);

  return {
    selectedLiveInstance,
    liveWorkflow,
    activeLiveNodeIds: view?.live.activeNodeIds ?? EMPTY,
    liveSelectedNodeId,
    setLiveSelectedNodeId,
    executionStatuses,
    activePathEdges: view?.path.activePathEdgeIds ?? EMPTY,
    activeTokenEdges: !view || frozen ? EMPTY : view.path.tokenEdgeIds,
    nextPathEdges: !view || frozen ? EMPTY : view.path.nextEdgeIds,
    instancePath: view?.path.path,
    playback,
    setExecutionStatuses,
    instancesRefreshKey,
    setInstancesRefreshKey,
    instancePanelOpen,
    setInstancePanelOpen,
    detailInstance,
    detailFocusNodeId,
    detailStartedId,
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
