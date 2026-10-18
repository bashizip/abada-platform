import React, { useState } from 'react';
import { Check, Copy, MousePointerClick, Repeat2 } from 'lucide-react';
import type { AgentConfig, WorkflowFile, WorkflowNode } from '@/types';
import { TooltipProvider } from '@/components/ui';
import type { AplValidationIssue } from '@/api/apl';
import { isOutcomeRouteEdge, setRoute, syncRouteEdges, type Route } from '@/lib/apl/routes';
import { analyzeLoops } from '@/lib/apl/loopAnalysis';
import { issuesAt, nodeRelativePath } from '@/lib/apl/issues';
import { NODE_KINDS, kindOf, kindSpec } from '@/features/designer/nodes/nodeCatalog';
import { NodeGlyph } from '@/features/designer/nodes/shapes';
import { LoopEditor } from '@/components/inspector/RouteEditors';
import { Field, FieldIssues, Section } from '@/components/inspector/InspectorKit';
import { SectionScope } from '@/components/inspector/sectionScope';
import { INPUT, TEXTAREA } from '@/components/inspector/fieldStyles';
import type { NodeEditorProps } from '@/components/inspector/nodeEditor';
import { AgentEditor } from '@/components/inspector/AgentEditor';
import { HumanEditor } from '@/components/inspector/HumanEditor';
import { DecisionTableEditor } from '@/components/inspector/DecisionTableEditor';
import { CallProcessNodeEditor, EngineTaskEditor, ScriptEditor } from '@/components/inspector/WorkEditors';
import { CatchEventEditor, EventGatewayEditor, GatewayEditor, PlainEventEditor } from '@/components/inspector/FlowEditors';

interface PropertiesInspectorProps {
  selectedNode: WorkflowNode | null;
  onUpdateNode: (updatedNode: WorkflowNode) => void;
  onRunAgentTest?: (agentConfig: AgentConfig, testInput: string) => Promise<unknown>;
  nodeCount: number;
  /** Full active workflow: route targets, gateway branches and event-gateway children. */
  workflow?: WorkflowFile;
  /** Mutates the active workflow (nodes + edges) in one undo step. */
  onUpdateWorkflow?: (updater: (wf: WorkflowFile) => WorkflowFile) => void;
  /** Owning project — enables the human-node form picker and agent tools. */
  projectId?: string;
  /** Engine validation issues about the selected node. */
  issues?: AplValidationIssue[];
}

/** The editor for each kind of node; every one reads the same props. */
const EDITORS: Record<ReturnType<typeof kindOf>, React.FC<NodeEditorProps>> = {
  start: PlainEventEditor,
  end: PlainEventEditor,
  message: CatchEventEditor,
  timer: CatchEventEditor,
  signal: CatchEventEditor,
  agent: AgentEditor,
  'human-input': HumanEditor,
  'engine-task': EngineTaskEditor,
  script: ScriptEditor,
  'decision-table': DecisionTableEditor,
  exclusive: GatewayEditor,
  parallel: GatewayEditor,
  inclusive: GatewayEditor,
  'event-gateway': EventGatewayEditor,
  'call-process': CallProcessNodeEditor,
  'for-each': CallProcessNodeEditor,
};

/** Kinds whose config object must exist before their editor can show. */
const hasConfig = (node: WorkflowNode): boolean => {
  switch (node.type) {
    case 'agent': return !!node.agentConfig;
    case 'human': return !!node.humanConfig;
    case 'dmn': return !!node.dmnConfig;
    default: return true;
  }
};

const IdChip: React.FC<{ id: string }> = ({ id }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title="Copy the node id" aria-label={`Copy node id ${id}`}
      onClick={() => {
        navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }).catch(() => undefined);
      }}
      className="flex max-w-[45%] items-center gap-1 rounded border border-hairline bg-charcoal px-1.5 py-0.5 font-mono text-[10px] text-sand hover:text-linen">
      <span className="truncate">{id}</span>
      {copied ? <Check className="h-3 w-3 shrink-0 text-sage-green" /> : <Copy className="h-3 w-3 shrink-0" />}
    </button>
  );
};

/** Nothing selected: what the process holds, and how to start editing. */
const ProcessOverview: React.FC<{ workflow?: WorkflowFile; nodeCount: number }> = ({ workflow, nodeCount }) => {
  const counts = new Map<string, number>();
  for (const node of workflow?.nodes ?? []) counts.set(kindOf(node), (counts.get(kindOf(node)) ?? 0) + 1);
  const present = NODE_KINDS.filter((spec) => counts.has(spec.kind));
  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2 rounded-2xl border border-hairline bg-charcoal p-4 text-center">
        <MousePointerClick className="mx-auto h-6 w-6 text-sand" aria-hidden="true" />
        <p className="text-xs font-medium text-linen">Select a step to edit it</p>
        <p className="text-[11px] leading-relaxed text-sand">
          Every property of the step shows here. Add steps from the palette: click one, or drag it onto the canvas.
        </p>
      </div>
      <div className="space-y-2">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-sand">
          This process · {nodeCount} step{nodeCount === 1 ? '' : 's'}
        </span>
        <ul className="space-y-1">
          {present.map((spec) => (
            <li key={spec.kind} className="flex items-center gap-3 rounded-lg px-2 py-1 text-xs text-linen">
              <span className="flex w-10 justify-center"><NodeGlyph kind={spec.kind} size={18} /></span>
              <span className="flex-1">{spec.label}</span>
              <span className="font-mono text-sand">{counts.get(spec.kind)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export const PropertiesInspector: React.FC<PropertiesInspectorProps> = ({
  selectedNode,
  onUpdateNode,
  nodeCount,
  workflow,
  onUpdateWorkflow,
  projectId,
  issues = [],
}) => {
  if (!selectedNode) {
    return (
      <aside className="z-10 flex h-full w-full min-w-0 flex-col overflow-y-auto border-l border-hairline bg-mocha">
        <ProcessOverview workflow={workflow} nodeCount={nodeCount} />
      </aside>
    );
  }

  const kind = kindOf(selectedNode);
  const spec = kindSpec(kind);
  const Editor = EDITORS[kind];
  const nodes = workflow?.nodes ?? [];
  const nextTarget = workflow?.edges.find((edge) => edge.source === selectedNode.id && !isOutcomeRouteEdge(edge))?.target;
  const loopProblem = workflow ? analyzeLoops(workflow).targets.get(selectedNode.id) : undefined;
  const loopable = kind !== 'start' && kind !== 'end';
  // Issues the engine did not pin to a field are listed at the top; the rest show next to their field.
  const general = issues.filter((issue) => !nodeRelativePath(issue) || nodeRelativePath(issue) === '/id');
  const placed = issues.length - general.length;

  const editorProps: NodeEditorProps = {
    node: selectedNode,
    nodes,
    workflow,
    projectId,
    issues,
    update: onUpdateNode,
    updateWorkflow: onUpdateWorkflow,
    routeTo: (route: Route, target: string | null) =>
      onUpdateWorkflow?.((wf) => setRoute(wf, selectedNode.id, route, target)),
    commitWithRoutes: (updated, dropNext = false) => onUpdateWorkflow?.((wf) => syncRouteEdges({
      ...wf,
      nodes: wf.nodes.map((node) => (node.id === updated.id ? updated : node)),
      // A review with outcomes, or an agent with routes, has no `next`: its exits are the outcomes or routes.
      edges: dropNext ? wf.edges.filter((edge) => edge.source !== updated.id || isOutcomeRouteEdge(edge)) : wf.edges,
    })),
    nextTarget,
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="z-10 flex h-full w-full min-w-0 flex-col overflow-y-auto border-l border-hairline bg-mocha"
        aria-label={`${spec.label} properties`}>
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-hairline bg-charcoal/80 px-4 py-3 backdrop-blur-md">
          <span className="flex w-11 shrink-0 justify-center"><NodeGlyph kind={kind} size={26} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-linen">{spec.label}</h2>
            <p className="truncate text-[10px] text-sand">
              {spec.description} · <code className="font-mono text-sand-dim">{spec.aplType}</code>
            </p>
          </div>
          <IdChip id={selectedNode.id} />
        </header>

        <SectionScope.Provider value={kind}>
          <div className="space-y-3 p-4">
            <div className="space-y-3">
              <Field label="Name" htmlFor="node-title" help="Shown on the canvas and in Operations.">
                <input id="node-title" value={selectedNode.title} className={INPUT}
                  onChange={(e) => onUpdateNode({ ...selectedNode, title: e.target.value })} />
              </Field>
              <Field label="Description" apl="description" htmlFor="node-description" issues={issuesAt(issues, 'description')}>
                <textarea id="node-description" rows={2} value={selectedNode.description} className={TEXTAREA}
                  placeholder="What this step is for"
                  onChange={(e) => onUpdateNode({ ...selectedNode, description: e.target.value })} />
              </Field>
            </div>

            {issues.length > 0 && (
              <div role="status" className="space-y-1 rounded-xl border border-desert-rose/40 bg-desert-rose/10 p-3">
                <span className="text-[11px] font-semibold text-desert-rose">
                  {issues.length} validation issue{issues.length === 1 ? '' : 's'}
                </span>
                <FieldIssues issues={general} />
                {placed > 0 && (
                  <p className="text-[10px] text-sand">
                    {general.length ? `${placed} more are` : placed === 1 ? 'It is' : 'They are'} shown next to the field they are about.
                  </p>
                )}
              </div>
            )}

            {hasConfig(selectedNode) && <Editor {...editorProps} />}

            {loopable && onUpdateWorkflow && (
              <Section id="loop" title="Repeat limit" icon={<Repeat2 className="h-3.5 w-3.5" />}
                defaultOpen={!!selectedNode.loop || !!loopProblem} issues={issuesAt(issues, 'loop')}
                summary="A step that a flow returns to needs a bound, so a loop can never run forever.">
                <LoopEditor loop={selectedNode.loop} problem={loopProblem} nodes={nodes} excludeId={selectedNode.id}
                  onChange={(loop) => editorProps.commitWithRoutes({ ...selectedNode, loop })} />
              </Section>
            )}
          </div>
        </SectionScope.Provider>
      </aside>
    </TooltipProvider>
  );
};
