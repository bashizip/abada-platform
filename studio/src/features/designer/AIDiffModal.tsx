import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Node,
  Edge,
} from '@xyflow/react';
import { Sparkles, X, CheckCircle2, XCircle, Tags, GitBranch } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { WorkflowDiffSnapshot, getChangeKindForNode, getAnnotationForNode, getChangeKindForEdge } from '@/lib/aiDiff/types';
import { workflowToAPL, stringifyAPLYaml } from '@/lib/apl/parser';
import { WorkflowFile } from '@/types';
import { canvasNodeTypes, outcomeKindsBySource, toCanvasNode } from './nodes';
import { AbadaEdge } from './EdgeRenderer';
import { CanvasMarkers } from './CanvasMarkers';
import { CanvasViewContext, MarkerPrefixProvider, type CanvasView } from './canvasContext';
import { edgeKindOf, inferDirection, outcomeSlots, parallelLanes } from '@/lib/layout/edgeGeometry';
import { type LayoutResult, applyPositions, computeLayout } from '@/lib/layout/elkLayout';

interface AIDiffModalProps {
  snapshot: WorkflowDiffSnapshot;
  baseWorkflow: WorkflowFile;
  onApply: (comment: string) => Promise<void> | void;
  onReject: (comment: string) => Promise<void> | void;
  onExit: () => void;
}

const KIND_META: Record<string, { label: string; cls: string }> = {
  added: { label: 'ADDED', cls: 'text-sage-green border-sage-green/50 bg-sage-green/10' },
  modified: { label: 'MODIFIED', cls: 'text-saffron border-saffron/50 bg-saffron/10' },
  removed: { label: 'REMOVED', cls: 'text-desert-rose border-desert-rose/50 bg-desert-rose/10' },
};

type DiffTab = 'graph' | 'yaml';

/**
 * Full-focus AI diff review dialog. The canvas stays untouched while a
 * proposal is reviewed here; Esc / backdrop dismissal exits back to the clean
 * editor without applying anything. Approve adopts the proposed graph and
 * bumps the semantic version (the governance gate preview for the Phase 2
 * Insight-Engine PR generator).
 */
export const AIDiffModal: React.FC<AIDiffModalProps> = ({
  snapshot,
  baseWorkflow,
  onApply,
  onReject,
  onExit,
}) => {
  const { proposal, baseNodes, baseEdges, proposedNodes, proposedEdges } = snapshot;
  const [tab, setTab] = useState<DiffTab>('graph');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !comment.trim()) return;
    setSubmitting(true);
    try {
      await (decision === 'approve' ? onApply(comment.trim()) : onReject(comment.trim()));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const edgeTypes = useMemo(() => ({ abadaEdge: AbadaEdge }), []);
  const markerPrefix = `abada-diff-${useId().replace(/:/g, '')}`;
  // Proposals add nodes wherever the generator put them: the review graph is
  // auto-laid-out for reading (view only — nothing is saved from here).
  const [laid, setLaid] = useState<LayoutResult | null>(null);
  useEffect(() => {
    let live = true;
    computeLayout(proposedNodes, proposedEdges, inferDirection(proposedNodes, proposedEdges))
      .then((result) => { if (live) setLaid(result); })
      .catch(() => { if (live) setLaid(null); });
    return () => { live = false; };
  }, [proposedNodes, proposedEdges]);

  const view: CanvasView = useMemo(
    () => ({
      direction: laid?.direction ?? inferDirection(proposedNodes, proposedEdges),
      readOnly: true,
      layout: laid ? { positions: laid.positions, routes: laid.routes } : null,
    }),
    [laid, proposedNodes, proposedEdges],
  );

  const graphNodes: Node[] = useMemo(() => {
    const outcomeKinds = outcomeKindsBySource(proposedEdges);
    const nodes = laid ? applyPositions(proposedNodes, laid.positions) : proposedNodes;
    return nodes.map((node) => {
      const diffKind = getChangeKindForNode(snapshot, node.id);
      return toCanvasNode(node, {
        isActiveSim: false,
        diffKind,
        diffAnnotation: diffKind ? getAnnotationForNode(snapshot, node.id) : undefined,
        outcomeKinds: outcomeKinds.get(node.id),
        selectable: false,
      });
    });
  }, [snapshot, proposedNodes, proposedEdges, laid]);

  const graphEdges: Edge[] = useMemo(() => {
    const slots = outcomeSlots(proposedEdges);
    const lanes = parallelLanes(proposedEdges);
    return proposedEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'abadaEdge',
      data: {
        label: edge.label,
        kind: edgeKindOf(edge),
        outcomeSlot: slots.get(edge.id),
        lane: lanes.get(edge.id),
        isFlowing: false,
        diffKind: getChangeKindForEdge(snapshot, edge.id),
      },
    }));
  }, [snapshot, proposedEdges]);

  const baseYaml = useMemo(
    () => stringifyAPLYaml(workflowToAPL({ ...baseWorkflow, nodes: baseNodes, edges: baseEdges })),
    [baseWorkflow, baseNodes, baseEdges]
  );
  const proposedYaml = useMemo(() => {
    const annotations = proposal.nodeChanges
      .filter((c) => c.annotation)
      .map((c) => c.annotation)
      .join('\n\n');
    const doc = stringifyAPLYaml(workflowToAPL({ ...baseWorkflow, nodes: proposedNodes, edges: proposedEdges }));
    return annotations ? `${annotations}\n\n${doc}` : doc;
  }, [baseWorkflow, proposedNodes, proposedEdges, proposal.nodeChanges]);

  const annotated = proposal.nodeChanges.filter((c) => c.annotation);
  const addCount = proposal.nodeChanges.filter((c) => c.kind === 'added').length;
  const modCount = proposal.nodeChanges.filter((c) => c.kind === 'modified').length;
  const remCount =
    proposal.nodeChanges.filter((c) => c.kind === 'removed').length +
    proposal.edgeChanges.filter((c) => c.kind === 'removed').length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-charcoal-veil/90 backdrop-blur-sm p-3">
      <div className="flex-1 min-h-0 flex flex-col bg-charcoal border border-hairline rounded-2xl shadow-warm-xl overflow-hidden">
        {/* PR header — title, source trigger, single-word CTAs */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-hairline shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amethyst/15 border border-amethyst/40 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-amethyst" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-linen tracking-wide truncate">
                  {proposal.title}
                </h2>
                <span className="text-[10px] font-mono text-sand bg-mocha border border-hairline px-1.5 py-0.5 rounded">
                  {proposal.targetDefinition}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] flex items-center gap-1 text-amethyst font-medium bg-amethyst/10 border border-amethyst/30 px-1.5 py-0.5 rounded">
                  <GitBranch className="w-3 h-3" />
                  {proposal.source}
                </span>
                <span className="text-[10px] text-sand">
                  {new Date(proposal.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button
              type="button"
              onClick={() => void submit('reject')}
              disabled={submitting || !comment.trim()}
              className="h-9 px-4 rounded-lg border border-desert-rose/40 bg-charcoal text-xs font-semibold text-desert-rose hover:bg-mocha-hover transition-all flex items-center gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
            <button
              type="button"
              onClick={() => void submit('approve')}
              disabled={submitting}
              className="h-9 px-4 rounded-lg bg-mineral-teal hover:bg-mineral-teal-bright text-charcoal text-xs font-semibold transition-all flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Approve
            </button>
            <button
              type="button"
              onClick={onExit}
              aria-label="Close review"
              className="ml-1 w-9 h-9 flex items-center justify-center rounded-lg border border-hairline bg-charcoal text-sand hover:text-linen hover:bg-mocha-hover transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Left: graph diff OR APL YAML diff */}
          <div className="flex-1 min-w-0 flex flex-col border-r border-hairline">
            <div className="flex items-center gap-1 px-4 pt-3 shrink-0">
              <button
                type="button"
                onClick={() => setTab('graph')}
                className={`text-[11px] px-3 py-1.5 rounded-lg border transition-all ${
                  tab === 'graph'
                    ? 'bg-mocha text-linen border-hairline'
                    : 'text-sand border-transparent hover:text-linen'
                }`}
              >
                Graph diff
              </button>
              <button
                type="button"
                onClick={() => setTab('yaml')}
                className={`text-[11px] px-3 py-1.5 rounded-lg border transition-all ${
                  tab === 'yaml'
                    ? 'bg-mocha text-linen border-hairline'
                    : 'text-sand border-transparent hover:text-linen'
                }`}
              >
                APL YAML diff
              </button>
            </div>

            {tab === 'graph' ? (
              <div className="flex-1 relative mt-2">
                <CanvasMarkers prefix={markerPrefix} />
                <MarkerPrefixProvider value={markerPrefix}>
                <CanvasViewContext.Provider value={view}>
                <ReactFlow
                  key={laid ? 'laid-out' : 'as-proposed'}
                  nodes={graphNodes}
                  edges={graphEdges}
                  nodeTypes={canvasNodeTypes}
                  connectionMode={ConnectionMode.Loose}
                  edgeTypes={edgeTypes}
                  fitView
                  minZoom={0.2}
                  maxZoom={2}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(168, 159, 145, 0.12)" />
                </ReactFlow>
                </CanvasViewContext.Provider>
                </MarkerPrefixProvider>
              </div>
            ) : (
              <div className="flex-1 min-h-0 mt-2 grid grid-cols-2 gap-3 px-4 pb-4">
                <div className="flex flex-col min-h-0 overflow-hidden rounded-xl border border-hairline bg-charcoal-ink">
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-sand border-b border-hairline bg-charcoal">
                    Base definition
                  </div>
                  <pre className="flex-1 overflow-auto p-3 text-[10px] font-mono leading-relaxed text-sand whitespace-pre-wrap">{baseYaml}</pre>
                </div>
                <div className="flex flex-col min-h-0 overflow-hidden rounded-lg border border-amethyst/30 bg-charcoal-ink">
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-amethyst border-b border-hairline bg-mocha flex items-center justify-between">
                    <span>Proposed definition</span>
                    <Tags className="w-3 h-3" />
                  </div>
                  <pre className="flex-1 overflow-auto p-3 text-[10px] font-mono leading-relaxed text-linen whitespace-pre-wrap">{proposedYaml}</pre>
                </div>
              </div>
            )}
          </div>

          {/* Right: insight diagnostics */}
          <div className="w-80 shrink-0 flex flex-col min-h-0 bg-mocha-deep">
            <div className="px-4 py-3 border-b border-hairline shrink-0">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-linen flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amethyst" />
                Insight Diagnostics
              </h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-sand">{proposal.rationale}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px]">
                {addCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full border border-sage-green/40 bg-sage-green/10 text-sage-green font-mono">+{addCount} added</span>
                )}
                {modCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full border border-saffron/40 bg-saffron/10 text-saffron font-mono">~{modCount} modified</span>
                )}
                {remCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full border border-desert-rose/40 bg-desert-rose/10 text-desert-rose font-mono">-{remCount} removed</span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {annotated.length > 0 && (
                <div className="px-4 pt-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sand mb-2">
                    <Tags className="w-3 h-3 text-amethyst" />
                    # OPTIMIZATION comments ({annotated.length})
                  </div>
                </div>
              )}
              <div className="px-4 pb-4 space-y-2">
                {proposal.nodeChanges.map((c) => (
                  <div key={c.nodeId} className="bg-charcoal border border-hairline rounded-lg p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono text-linen truncate">{c.nodeId}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${KIND_META[c.kind].cls}`}>
                        {KIND_META[c.kind].label}
                      </span>
                    </div>
                    {c.annotation && (
                      <pre className="mt-2 text-[9.5px] font-mono leading-snug whitespace-pre-wrap text-amethyst bg-mocha rounded p-2 border border-hairline">
                        {c.annotation}
                      </pre>
                    )}
                  </div>
                ))}
                {proposal.edgeChanges.length > 0 && (
                  <div className="bg-charcoal border border-hairline rounded-lg p-2.5">
                    <span className="text-[10px] font-mono text-linen">edges</span>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {proposal.edgeChanges.map((e) => (
                        <div key={e.edgeId} className="flex items-center justify-between gap-2">
                          <span className="text-[9.5px] font-mono text-sand truncate">{e.edgeId}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${KIND_META[e.kind].cls}`}>
                            {KIND_META[e.kind].label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-hairline shrink-0">
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Review comment (required to reject)"
                className="w-full mb-2 min-h-16 resize-y rounded-lg border border-hairline bg-charcoal-ink p-2 text-[10px] text-linen outline-none focus:border-mineral-teal"
              />
              <p className="text-[10px] text-sand leading-relaxed">
                Approving adopts the proposed definition and bumps the semantic version. The canvas is unchanged until you approve.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
