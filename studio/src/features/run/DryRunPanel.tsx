import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Braces, CheckCircle2, ChevronRight, FlaskConical, Play, RotateCcw, X } from 'lucide-react';
import { WorkflowEdge, WorkflowFile, WorkflowNode } from '@/types';
import { deriveDefaultPayload, NodeRunStatus, sleep } from '@/lib/run/liveRun';
import { agentModelGuardMessage, invalidAgentModels, hasAgentNodes } from '@/lib/agentModels';
import { InsightAPI } from '@/api/insight';

type PauseState =
  | { kind: 'agent'; node: WorkflowNode; edges: WorkflowEdge[] }
  | { kind: 'gateway'; node: WorkflowNode; edges: WorkflowEdge[] }
  | { kind: 'human'; node: WorkflowNode; edges: WorkflowEdge[] }
  | null;

interface DryRunPanelProps {
  workflow: WorkflowFile;
  isOpen: boolean;
  onClose: () => void;
  onCompleted: (payload: Record<string, unknown>) => void;
  onBlocked?: (message: string) => void;
  onOverlayChange: (
    statuses: Record<string, NodeRunStatus>,
    activeNodeId: string | null,
    running: boolean,
  ) => void;
}

const initialStatuses = (workflow: WorkflowFile): Record<string, NodeRunStatus> =>
  Object.fromEntries(workflow.nodes.map((node) => [node.id, 'idle']));

export const DryRunPanel: React.FC<DryRunPanelProps> = ({
  workflow, isOpen, onClose, onCompleted, onBlocked, onOverlayChange,
}) => {
  const defaults = useMemo(() => deriveDefaultPayload(workflow), [workflow]);
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(defaults, null, 2));
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [pause, setPause] = useState<PauseState>(null);
  const [mockOutput, setMockOutput] = useState('');
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const runId = useRef(0);
  const continuation = useRef<((edges: WorkflowEdge[]) => void) | null>(null);
  const statuses = useRef<Record<string, NodeRunStatus>>(initialStatuses(workflow));
  const variables = useRef<Record<string, unknown>>({});

  useEffect(() => {
    setPayloadText(JSON.stringify(deriveDefaultPayload(workflow), null, 2));
    setPayloadError(null);
    setPause(null);
    setMessages([]);
    statuses.current = initialStatuses(workflow);
    onOverlayChange(statuses.current, null, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id]);

  useEffect(() => () => { runId.current += 1; }, []);

  if (!isOpen) return null;

  const emit = (activeNodeId: string | null, isRunning = true) => {
    onOverlayChange({ ...statuses.current }, activeNodeId, isRunning);
  };

  const outgoing = (nodeId: string) => workflow.edges.filter((edge) => edge.source === nodeId);

  const waitForInput = (nextPause: Exclude<PauseState, null>): Promise<WorkflowEdge[]> => {
    setPause(nextPause);
    setMockOutput('');
    setSelectedEdges([]);
    return new Promise((resolve) => { continuation.current = resolve; });
  };

  const finishPause = (edges: WorkflowEdge[]) => {
    const resolve = continuation.current;
    continuation.current = null;
    setPause(null);
    resolve?.(edges);
  };

  const run = async () => {
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(payloadText || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Payload must be a JSON object');
      payload = parsed;
    } catch (reason) {
      setPayloadError(reason instanceof Error ? reason.message : String(reason));
      return;
    }

    const start = workflow.nodes.find((node) => node.type === 'event' && node.subtype === 'start')
      || workflow.nodes.find((node) => !workflow.edges.some((edge) => edge.target === node.id));
    if (!start) {
      setPayloadError('Dry Run requires a start node');
      return;
    }

    const invalidModels = invalidAgentModels(workflow.nodes);
    if (invalidModels.length > 0) {
      const message = agentModelGuardMessage(invalidModels);
      setPayloadError(message);
      onBlocked?.(message);
      return;
    }

    if (hasAgentNodes(workflow.nodes)) {
      try {
        const aiSettings = await InsightAPI.getAiSettings();
        if (!aiSettings.configured) {
          const message = 'This workflow contains AI agent nodes but no LLM API key is configured. Go to Settings → AI Providers to configure one before deploying.';
          setPayloadError(message);
          onBlocked?.(message);
          return;
        }
      } catch {
        // If we can't check, let the engine reject at deploy time
      }
    }

    const currentRun = ++runId.current;
    const queue = [start.id];
    const visits = new Map<string, number>();
    let steps = 0;
    variables.current = { ...payload };
    statuses.current = initialStatuses(workflow);
    setMessages(['Dry Run started — no engine, LLM or external side effect is called.']);
    setRunning(true);
    emit(start.id);

    while (queue.length && currentRun === runId.current) {
      const nodeId = queue.shift()!;
      const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) continue;
      steps += 1;
      const visitCount = (visits.get(nodeId) || 0) + 1;
      visits.set(nodeId, visitCount);
      if (steps > 100 || visitCount > 10) {
        statuses.current[nodeId] = 'failed';
        setMessages((items) => [...items, `Stopped at ${node.title}: loop protection reached.`]);
        emit(nodeId, false);
        setRunning(false);
        return;
      }

      statuses.current[nodeId] = 'running';
      emit(nodeId);
      setMessages((items) => [...items, `Token entered ${node.title}.`]);
      await sleep(450);
      if (currentRun !== runId.current) return;

      const edges = outgoing(nodeId);
      let chosen = edges;
      if (node.type === 'agent') {
        chosen = await waitForInput({ kind: 'agent', node, edges });
      } else if (node.type === 'human') {
        statuses.current[nodeId] = 'waiting';
        emit(nodeId);
        chosen = await waitForInput({ kind: 'human', node, edges });
      } else if ((node.type === 'gateway' || node.type === 'dmn') && edges.length > 1) {
        if (node.subtype !== 'parallel') chosen = await waitForInput({ kind: 'gateway', node, edges });
      }
      if (currentRun !== runId.current) return;

      statuses.current[nodeId] = 'completed';
      emit(null);
      chosen.forEach((edge) => queue.push(edge.target));
    }

    if (currentRun !== runId.current) return;
    setRunning(false);
    setMessages((items) => [...items, 'Dry Run completed successfully.']);
    emit(null, false);
    onCompleted(payload);
  };

  const cancel = () => {
    runId.current += 1;
    continuation.current?.([]);
    continuation.current = null;
    setPause(null);
    setRunning(false);
    statuses.current = initialStatuses(workflow);
    emit(null, false);
  };

  const continueAgent = () => {
    if (!pause || pause.kind !== 'agent' || !mockOutput.trim()) return;
    const resultVariable = pause.node.agentConfig?.resultVariable || `${pause.node.id}_result`;
    variables.current[resultVariable] = mockOutput.trim();
    setMessages((items) => [...items, `Mocked ${resultVariable} = ${mockOutput.trim()}.`]);
    finishPause(pause.edges);
  };

  const continueGateway = () => {
    if (!pause || pause.kind !== 'gateway' || selectedEdges.length === 0) return;
    finishPause(pause.edges.filter((edge) => selectedEdges.includes(edge.id)));
  };

  return (
    <div className="absolute top-16 right-4 z-30 w-[420px] max-h-[calc(100vh-6rem)] bg-[#25201D] border border-[#3A322E] rounded-2xl shadow-warm-lg flex flex-col overflow-hidden">
      <div className="p-3 bg-[#1A1614] border-b border-[#3A322E] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-[#F4A261]" />
          <div><strong className="text-xs">Dry Run</strong><p className="text-[10px] text-[#A89F91]">Local · mocked · non-persistent</p></div>
        </div>
        <button onClick={() => { cancel(); onClose(); }} aria-label="Close Dry Run"><X className="w-4 h-4" /></button>
      </div>

      <div className="p-3 space-y-3 overflow-y-auto">
        <div className="rounded-xl border border-[#3A322E] bg-[#1A1614] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#3A322E] flex items-center justify-between">
            <span className="text-[10px] font-semibold text-[#F4A261] flex items-center gap-1"><Braces className="w-3 h-3" /> INPUT PAYLOAD</span>
            <button className="text-[10px] text-[#A89F91]" onClick={() => setPayloadText(JSON.stringify(defaults, null, 2))}>Reset</button>
          </div>
          <textarea aria-label="Dry Run input payload" value={payloadText} disabled={running}
            onChange={(event) => { setPayloadText(event.target.value); setPayloadError(null); }}
            className="w-full h-36 bg-transparent p-3 font-mono text-[11px] outline-none resize-none disabled:opacity-60" />
        </div>
        {payloadError && <div className="text-[11px] text-[#E76F51] flex gap-1"><AlertTriangle className="w-3.5 h-3.5" />{payloadError}</div>}

        {pause?.kind === 'agent' && (
          <div className="rounded-xl border border-[#9D4EDD]/40 bg-[#9D4EDD]/10 p-3 space-y-2">
            <p className="text-xs font-semibold">Mock agent output · {pause.node.title}</p>
            <textarea aria-label="Mock agent output" value={mockOutput} onChange={(event) => setMockOutput(event.target.value)}
              placeholder="Example: HIGH" className="w-full h-20 rounded-lg bg-[#1A1614] border border-[#3A322E] p-2 font-mono text-[11px] outline-none" />
            <button onClick={continueAgent} disabled={!mockOutput.trim()} className="w-full py-2 rounded-lg bg-[#9D4EDD] text-xs font-semibold disabled:opacity-40">Use mocked output</button>
          </div>
        )}

        {pause?.kind === 'gateway' && (
          <div className="rounded-xl border border-[#F4A261]/40 bg-[#F4A261]/10 p-3 space-y-2">
            <p className="text-xs font-semibold">Choose simulated transition · {pause.node.title}</p>
            {pause.edges.map((edge) => (
              <label key={edge.id} className="flex items-center gap-2 rounded-lg border border-[#3A322E] bg-[#1A1614] p-2 text-[11px] cursor-pointer">
                <input type={pause.node.subtype === 'inclusive' ? 'checkbox' : 'radio'} name="dry-run-edge"
                  checked={selectedEdges.includes(edge.id)} onChange={() => setSelectedEdges((items) =>
                    pause.node.subtype === 'inclusive'
                      ? items.includes(edge.id) ? items.filter((id) => id !== edge.id) : [...items, edge.id]
                      : [edge.id])} />
                {edge.label || `${edge.source} → ${edge.target}`}
              </label>
            ))}
            <button onClick={continueGateway} disabled={!selectedEdges.length} className="w-full py-2 rounded-lg bg-[#F4A261] text-[#1A1614] text-xs font-semibold disabled:opacity-40">Continue selected path</button>
          </div>
        )}

        {pause?.kind === 'human' && (
          <div className="rounded-xl border border-[#E76F51]/40 bg-[#E76F51]/10 p-3 space-y-2">
            <p className="text-xs font-semibold">Simulated human task · {pause.node.title}</p>
            <button onClick={() => finishPause(pause.edges)} className="w-full py-2 rounded-lg bg-[#E76F51] text-[#1A1614] text-xs font-semibold">Complete simulated task</button>
          </div>
        )}

        {!running && (
          <button onClick={() => void run()} className="w-full py-2.5 rounded-xl bg-[#F4A261] text-[#1A1614] text-xs font-semibold flex items-center justify-center gap-2">
            <Play className="w-3.5 h-3.5 fill-current" /> Start Dry Run
          </button>
        )}
        {running && !pause && <div className="text-xs text-[#F4A261] flex items-center gap-2"><RotateCcw className="w-3.5 h-3.5 animate-spin" />Advancing simulated token…</div>}

        <div className="space-y-1 max-h-28 overflow-y-auto">
          {messages.map((message, index) => <div key={`${index}-${message}`} className="text-[10px] text-[#A89F91] flex gap-1"><ChevronRight className="w-3 h-3 shrink-0" />{message}</div>)}
          {!running && messages.at(-1)?.includes('successfully') && <div className="text-[10px] text-[#90A955] flex gap-1"><CheckCircle2 className="w-3 h-3" />Ready for Deploy & Start</div>}
        </div>
      </div>
    </div>
  );
};
