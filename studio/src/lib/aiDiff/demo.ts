import { WorkflowFile, WorkflowEdge } from '@/types';
import { WorkflowDiffSnapshot, DiffProposal, DiffNodeChange, DiffEdgeChange } from './types';
import { DEFAULT_AGENT_MODEL } from '@/lib/agentModels';

/**
 * Builds a demo Insight-Engine proposal over a workflow snapshot, the same
 * shape Phase 2 (Insight Loop / APL PR generator) will emit for real. The demo
 * mirrors the ADR-003 example: an extract agent with an 18% JSON parsing
 * failure rate, whose model and prompt the optimization engine proposes to
 * change, plus a lightweight pre-formatting node the engine proposes to
 * insert before it (with inline YAML annotations on every touched element).
 */
export const buildDemoProposal = (wf: WorkflowFile): WorkflowDiffSnapshot => {
  const agentNode = wf.nodes.find((n) => n.type === 'agent');
  const startNode = wf.nodes.find((n) => n.type === 'event' && n.subtype === 'start');

  const nodeChanges: DiffNodeChange[] = [];
  const edgeChanges: DiffEdgeChange[] = [];

  const preFormatterId = `${agentNode?.id || 'extract'}-preformat`;

  const proposedNodes = wf.nodes.flatMap((n) => {
    if (n.id === agentNode?.id) {
      nodeChanges.push({
        nodeId: n.id,
        kind: 'modified',
        annotation:
          '# OPTIMIZATION (Insight Engine):\n' +
          '# Switched to gemini-3.6-flash and tightened the prompt to enforce\n' +
          '# strict JSON schema output, resolving an 18% parsing failure rate.',
      });
      return [
        {
          ...n,
          agentConfig: n.agentConfig
            ? {
                ...n.agentConfig,
                model: 'gemini-3.6-flash',
                systemPrompt:
                  'Extract {income, creditScore, requestedAmount} from the payload.\n' +
                  'Return valid JSON adhering strictly to the schema. No markdown fences.',
                temperature: 0.1,
              }
            : n.agentConfig,
        },
      ];
    }
    return [n];
  });

  if (startNode && agentNode) {
    const directEdge = wf.edges.find((e) => e.source === startNode.id && e.target === agentNode.id);
    if (directEdge) {
      edgeChanges.push({ edgeId: directEdge.id, kind: 'removed' });
    }
    edgeChanges.push({ edgeId: `added-${startNode.id}-${preFormatterId}`, kind: 'added' });
    edgeChanges.push({ edgeId: `added-${preFormatterId}-${agentNode.id}`, kind: 'added' });

    const addedFormatter: NonNullable<WorkflowFile['nodes']>[number] = {
      id: preFormatterId,
      type: 'agent',
      title: 'JSON Schema Pre-Formatter',
      description: 'Lightweight pre-processing step proposed by the Insight Engine',
      x: startNode.x + 260,
      y: startNode.y + 40,
      agentConfig: {
        model: DEFAULT_AGENT_MODEL,
        systemPrompt:
          'Normalize the incoming payload into a clean JSON document with the ' +
          '{ income: number, creditScore: number, requestedAmount: number } shape.',
        confidenceThreshold: 90,
        temperature: 0,
        tools: [],
      },
    };
    nodeChanges.push({
      nodeId: preFormatterId,
      kind: 'added',
      annotation:
        '# OPTIMIZATION (Insight Engine):\n' +
        '# New pre-formatting node normalizes long unstructured documents\n' +
        '# before extractAgent runs, cutting JSON parse failures by ~95%.',
    });

    const index = proposedNodes.findIndex((n) => n.id === agentNode.id);
    proposedNodes.splice(index, 0, addedFormatter);

    const proposedEdges: WorkflowEdge[] = wf.edges
      .filter((e) => !(e.source === startNode.id && e.target === agentNode.id))
      .concat([
        { id: `pre-${directEdge?.id || 'direct'}`, source: startNode.id, target: preFormatterId, label: 'Flow Connection' },
        { id: `post-${preFormatterId}`, source: preFormatterId, target: agentNode.id, label: 'Normalized' },
      ]);
    void directEdge;

    const proposal: DiffProposal = {
      id: 'opt-pr-104',
      title: 'PENDING OPTIMIZATION PR #104',
      rationale:
        'extractAgent fails JSON extraction on long documents 18% of the time. ' +
        'Inserting a lightweight pre-formatting node and switching to a stricter ' +
        'schema prompt reduce the estimated failure rate to <1%.',
      source: 'Insight Engine (Demo)',
      targetDefinition: wf.name.replace(/\.apl\.yaml$/, '') + '_v1',
      createdAt: new Date().toISOString(),
      nodeChanges,
      edgeChanges,
    };

    return {
      proposal,
      baseNodes: wf.nodes,
      baseEdges: wf.edges,
      proposedNodes,
      proposedEdges,
    };
  }

  return {
    proposal: {
      id: 'opt-pr-104',
      title: 'PENDING OPTIMIZATION PR #104',
      rationale: 'No optimizable agent path detected in this workflow.',
      source: 'Insight Engine (Demo)',
      targetDefinition: wf.name.replace(/\.apl\.yaml$/, ''),
      createdAt: new Date().toISOString(),
      nodeChanges,
      edgeChanges,
    },
    baseNodes: wf.nodes,
    baseEdges: wf.edges,
    proposedNodes: wf.nodes,
    proposedEdges: wf.edges,
  };
};
