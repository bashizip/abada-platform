import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Node,
  Edge,
} from '@xyflow/react';
import { Sparkles, X, CheckCircle2, XCircle, Tags, GitBranch } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { WorkflowDiffSnapshot, getChangeKindForNode, getAnnotationForNode, getChangeKindForEdge } from '@/lib/aiDiff/types';
import { workflowToAPL, stringifyAPLYaml } from '@/lib/apl/parser';
import { WorkflowFile } from '@/types';
import { AbadaNode } from './NodeRenderer';
import { AbadaEdge } from './EdgeRenderer';

interface AIDiffModalProps {
  snapshot: WorkflowDiffSnapshot;
  baseWorkflow: WorkflowFile;
  onApply: () => void;
  onReject: () => void;
  onExit: () => void;
}

const KIND_META: Record<string, { label: string; cls: string }> = {
  added: { label: 'ADDED', cls: 'text-[#90A955] border-[#90A955]/50 bg-[#90A955]/10' },
  modified: { label: 'MODIFIED', cls: 'text-[#F4A261] border-[#F4A261]/50 bg-[#F4A261]/10' },
  removed: { label: 'REMOVED', cls: 'text-[#E76F51] border-[#E76F51]/50 bg-[#E76F51]/10' },
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const nodeTypes = useMemo(() => ({ abadaNode: AbadaNode as any }), []);
  const edgeTypes = useMemo(() => ({ abadaEdge: AbadaEdge }), []);

  const graphNodes: Node[] = useMemo(
    () =>
      proposedNodes.map((node) => ({
        id: node.id,
        type: 'abadaNode',
        position: { x: node.x, y: node.y },
        data: {
          ...node,
          isActiveSim: false,
          diffKind: getChangeKindForNode(snapshot, node.id),
          diffAnnotation: getChangeKindForNode(snapshot, node.id) ? getAnnotationForNode(snapshot, node.id) : undefined,
        },
        selectable: false,
      })),
    [snapshot, proposedNodes]
  );

  const graphEdges: Edge[] = useMemo(
    () =>
      proposedEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'abadaEdge',
        data: {
          label: edge.label,
          isFlowing: false,
          diffKind: getChangeKindForEdge(snapshot, edge.id),
        },
        markerEnd: 'url(#arrowhead-saffron)',
      })),
    [snapshot, proposedEdges]
  );

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
    <div className="fixed inset-0 z-50 flex flex-col bg-[#141110]/90 backdrop-blur-sm p-3">
      <div className="flex-1 min-h-0 flex flex-col bg-[#1A1614] border border-[#3A322E] rounded-2xl shadow-warm-xl overflow-hidden">
        {/* PR header — title, source trigger, single-word CTAs */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#3A322E] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#9D4EDD]/15 border border-[#9D4EDD]/40 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-[#9D4EDD]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[#EAE3D9] tracking-wide truncate">
                  {proposal.title}
                </h2>
                <span className="text-[10px] font-mono text-[#A89F91] bg-[#25201D] border border-[#3A322E] px-1.5 py-0.5 rounded">
                  {proposal.targetDefinition}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] flex items-center gap-1 text-[#9D4EDD] font-medium bg-[#9D4EDD]/10 border border-[#9D4EDD]/30 px-1.5 py-0.5 rounded">
                  <GitBranch className="w-3 h-3" />
                  {proposal.source}
                </span>
                <span className="text-[10px] text-[#A89F91]">
                  {new Date(proposal.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button
              type="button"
              onClick={onReject}
              className="h-9 px-4 rounded-lg border border-[#E76F51]/40 bg-[#1A1614] text-xs font-semibold text-[#E76F51] hover:bg-[#2F2926] transition-all flex items-center gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
            <button
              type="button"
              onClick={onApply}
              className="h-9 px-4 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] text-xs font-semibold transition-all flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Approve
            </button>
            <button
              type="button"
              onClick={onExit}
              aria-label="Close review"
              className="ml-1 w-9 h-9 flex items-center justify-center rounded-lg border border-[#3A322E] bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9] hover:bg-[#2F2926] transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Left: graph diff OR APL YAML diff */}
          <div className="flex-1 min-w-0 flex flex-col border-r border-[#3A322E]">
            <div className="flex items-center gap-1 px-4 pt-3 shrink-0">
              <button
                type="button"
                onClick={() => setTab('graph')}
                className={`text-[11px] px-3 py-1.5 rounded-lg border transition-all ${
                  tab === 'graph'
                    ? 'bg-[#25201D] text-[#EAE3D9] border-[#3A322E]'
                    : 'text-[#A89F91] border-transparent hover:text-[#EAE3D9]'
                }`}
              >
                Graph diff
              </button>
              <button
                type="button"
                onClick={() => setTab('yaml')}
                className={`text-[11px] px-3 py-1.5 rounded-lg border transition-all ${
                  tab === 'yaml'
                    ? 'bg-[#25201D] text-[#EAE3D9] border-[#3A322E]'
                    : 'text-[#A89F91] border-transparent hover:text-[#EAE3D9]'
                }`}
              >
                APL YAML diff
              </button>
            </div>

            {tab === 'graph' ? (
              <div className="flex-1 relative mt-2">
                <svg style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0 }}>
                  <defs>
                    <marker id="arrowhead-saffron" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <polygon points="0 0, 8 4, 0 8" fill="#F4A261" />
                    </marker>
                  </defs>
                </svg>
                <ReactFlow
                  nodes={graphNodes}
                  edges={graphEdges}
                  nodeTypes={nodeTypes}
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
              </div>
            ) : (
              <div className="flex-1 min-h-0 mt-2 grid grid-cols-2 gap-3 px-4 pb-4">
                <div className="flex flex-col min-h-0 overflow-hidden rounded-xl border border-[#3A322E] bg-[#14100D]">
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#A89F91] border-b border-[#3A322E] bg-[#1A1614]">
                    Base definition
                  </div>
                  <pre className="flex-1 overflow-auto p-3 text-[10px] font-mono leading-relaxed text-[#A89F91] whitespace-pre-wrap">{baseYaml}</pre>
                </div>
                <div className="flex flex-col min-h-0 overflow-hidden rounded-lg border border-[#9D4EDD]/30 bg-[#14100D]">
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#9D4EDD] border-b border-[#3A322E] bg-[#25201D] flex items-center justify-between">
                    <span>Proposed definition</span>
                    <Tags className="w-3 h-3" />
                  </div>
                  <pre className="flex-1 overflow-auto p-3 text-[10px] font-mono leading-relaxed text-[#EAE3D9] whitespace-pre-wrap">{proposedYaml}</pre>
                </div>
              </div>
            )}
          </div>

          {/* Right: insight diagnostics */}
          <div className="w-80 shrink-0 flex flex-col min-h-0 bg-[#201B18]">
            <div className="px-4 py-3 border-b border-[#3A322E] shrink-0">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#EAE3D9] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#9D4EDD]" />
                Insight Diagnostics
              </h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#A89F91]">{proposal.rationale}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px]">
                {addCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full border border-[#90A955]/40 bg-[#90A955]/10 text-[#90A955] font-mono">+{addCount} added</span>
                )}
                {modCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full border border-[#F4A261]/40 bg-[#F4A261]/10 text-[#F4A261] font-mono">~{modCount} modified</span>
                )}
                {remCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full border border-[#E76F51]/40 bg-[#E76F51]/10 text-[#E76F51] font-mono">-{remCount} removed</span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {annotated.length > 0 && (
                <div className="px-4 pt-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#A89F91] mb-2">
                    <Tags className="w-3 h-3 text-[#9D4EDD]" />
                    # OPTIMIZATION comments ({annotated.length})
                  </div>
                </div>
              )}
              <div className="px-4 pb-4 space-y-2">
                {proposal.nodeChanges.map((c) => (
                  <div key={c.nodeId} className="bg-[#1A1614] border border-[#3A322E] rounded-lg p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono text-[#EAE3D9] truncate">{c.nodeId}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${KIND_META[c.kind].cls}`}>
                        {KIND_META[c.kind].label}
                      </span>
                    </div>
                    {c.annotation && (
                      <pre className="mt-2 text-[9.5px] font-mono leading-snug whitespace-pre-wrap text-[#9D4EDD] bg-[#25201D] rounded p-2 border border-[#3A322E]">
                        {c.annotation}
                      </pre>
                    )}
                  </div>
                ))}
                {proposal.edgeChanges.length > 0 && (
                  <div className="bg-[#1A1614] border border-[#3A322E] rounded-lg p-2.5">
                    <span className="text-[10px] font-mono text-[#EAE3D9]">edges</span>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {proposal.edgeChanges.map((e) => (
                        <div key={e.edgeId} className="flex items-center justify-between gap-2">
                          <span className="text-[9.5px] font-mono text-[#A89F91] truncate">{e.edgeId}</span>
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

            <div className="px-4 py-3 border-t border-[#3A322E] shrink-0">
              <p className="text-[10px] text-[#A89F91] leading-relaxed">
                Approving adopts the proposed definition and bumps the semantic version. The canvas is unchanged until you approve.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};