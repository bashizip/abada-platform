import React, { useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Canvas } from '@/features/designer/Canvas';
import type { ActivityHistoryDTO, IncidentDTO, ProcessInstanceDTO } from '@/api/engine';
import { agentStepModel } from '@/lib/run/incidents';
import { deriveInstancePath, InstancePath } from '@/lib/run/instanceDetail';
import type { InstanceFrame } from '@/hooks/useInstancePlayback';
import { WorkflowFile } from '@/types';
import { NodeIncidentCard, RetryProgress, type FailureDetails } from '../NodeIncidentCard';
import type { useNodeIncidents } from '../useNodeIncidents';

const noop = () => undefined;

/**
 * Content-stable path: polls return new object identities for the same engine
 * facts. A stable identity keeps the Canvas edges memoized, so the SVG token
 * motion never restarts while the facts are unchanged.
 */
function useStablePath(workflow: WorkflowFile | null, frame: InstanceFrame | null, incidentNodeIds: string[]): InstancePath | null {
  const path = useMemo(() => (!workflow || !frame ? null
    : deriveInstancePath(workflow, frame.instance, frame.activities, frame.history, { incidentNodeIds })),
  [workflow, frame, incidentNodeIds]);
  const cache = useRef<{ serialized: string | null; value: InstancePath | null }>({ serialized: null, value: null });
  return useMemo(() => {
    const serialized = JSON.stringify(path);
    if (cache.current.serialized !== serialized) cache.current = { serialized, value: path };
    return cache.current.value;
  }, [path]);
}

/**
 * The hero of the instance view: the diagram as the run plays back (S2 path,
 * S3 pacing), with the incident card on the failing step (S4).
 */
export const InstanceStage: React.FC<{
  projectId?: string;
  instance: ProcessInstanceDTO;
  isTerminal: boolean;
  loading: boolean;
  workflow: WorkflowFile | null;
  frame: InstanceFrame | null;
  history: ActivityHistoryDTO[];
  animateArrivals: boolean;
  nodeIncidents: ReturnType<typeof useNodeIncidents>;
  canAct: boolean;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  highlightNodeId: string | null;
  onRetried: (incident: IncidentDTO) => void;
  onViewDetails: (details: FailureDetails) => void;
  onCancelInstance: () => void;
}> = ({
  projectId, instance, isTerminal, loading, workflow, frame, history, animateArrivals, nodeIncidents, canAct,
  selectedNodeId, onSelectNode, highlightNodeId, onRetried, onViewDetails, onCancelInstance,
}) => {
  const stablePath = useStablePath(workflow, frame, nodeIncidents.incidentNodeIds);

  const cardNode = nodeIncidents.cardNodeId ? workflow?.nodes.find((node) => node.id === nodeIncidents.cardNodeId) ?? null : null;
  const cardIncident = cardNode ? nodeIncidents.incidentAt[cardNode.id] : undefined;
  const cardPhase = cardNode ? nodeIncidents.retryPhases[cardNode.id] : undefined;
  const overlay = !cardNode || !projectId || !workflow ? null
    : cardPhase && cardPhase !== 'failed'
      ? { nodeId: cardNode.id, content: <RetryProgress node={cardNode} phase={cardPhase} /> }
      : cardIncident ? {
        nodeId: cardNode.id,
        content: (
          <NodeIncidentCard key={cardIncident.id} projectId={projectId} incident={cardIncident} node={cardNode}
            history={history} canAct={canAct} model={agentStepModel(workflow, cardNode.id, history)}
            onRetried={onRetried} onViewDetails={onViewDetails} onCancelInstance={onCancelInstance}
            onClose={nodeIncidents.closeCard} />
        ),
      } : null;

  if (loading && !workflow) {
    return (
      <div role="status" className="flex h-full items-center justify-center gap-2 text-xs text-sand">
        <Loader2 className="h-4 w-4 animate-spin text-amethyst motion-reduce:animate-none" aria-hidden="true" /> Loading the diagram…
      </div>
    );
  }
  if (!workflow || !stablePath) {
    return <div className="flex h-full items-center justify-center text-xs text-sand">The definition of this instance is unavailable.</div>;
  }
  const still = instance.suspended || isTerminal;
  return (
    <Canvas
      nodes={workflow.nodes}
      edges={workflow.edges}
      layoutPending={workflow.layoutPending}
      selectedNodeId={selectedNodeId}
      onSelectNode={onSelectNode}
      onNodeMove={noop}
      onDeleteNode={noop}
      onConnectNodes={noop}
      onAddNode={noop}
      onOpenAplEditor={noop}
      onFocusPrompt={noop}
      isSimulating={false}
      activeSimulationNodeId={null}
      executionStatuses={stablePath.statuses}
      activeLiveNodeIds={stablePath.activeNodeIds}
      activePathEdges={stablePath.activePathEdgeIds}
      activeTokenEdges={still ? undefined : stablePath.tokenEdgeIds}
      nextPathEdges={still ? undefined : stablePath.nextEdgeIds}
      path={stablePath.path}
      animateArrivals={animateArrivals}
      incidentPulses={nodeIncidents.incidentPulses}
      retryPhases={nodeIncidents.retryPhases}
      highlightNodeId={highlightNodeId}
      focus={nodeIncidents.focus}
      nodeOverlay={overlay}
      readOnly
    />
  );
};
