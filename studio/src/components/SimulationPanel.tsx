import React, { useRef, useState } from 'react';
import { SimulationLog, NodeType } from '@/types';
import { 
  X, 
  Terminal, 
  CheckCircle2, 
  AlertTriangle, 
  Info, 
  Bot, 
  UserCheck, 
  Table, 
  GitFork,
  Circle,
  Clock,
  GripVertical
} from 'lucide-react';

interface SimulationPanelProps {
  logs: SimulationLog[];
  isOpen: boolean;
  onClose: () => void;
  onClearLogs: () => void;
  isSimulating: boolean;
}

export const SimulationPanel: React.FC<SimulationPanelProps> = ({
  logs,
  isOpen,
  onClose,
  onClearLogs,
  isSimulating,
}) => {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== 'undefined' ? Math.max(window.innerWidth - 496, 0) : 0,
    y: typeof window !== 'undefined' ? Math.max(window.innerHeight - 440, 64) : 0,
  }));
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const container = panelRef.current?.offsetParent as HTMLElement | null;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - rect.left - pos.x, dy: e.clientY - rect.top - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    const container = panelRef.current?.offsetParent as HTMLElement | null;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const w = panelRef.current?.offsetWidth ?? 480;
    const h = panelRef.current?.offsetHeight ?? 360;
    setPos({
      x: Math.min(Math.max(e.clientX - rect.left - dragOffset.current.dx, 8), Math.max(rect.width - w - 8, 8)),
      y: Math.min(Math.max(e.clientY - rect.top - dragOffset.current.dy, 8), Math.max(rect.height - h - 8, 8)),
    });
  };

  const onPointerUp = () => {
    dragOffset.current = null;
  };

  if (!isOpen) return null;

  const getNodeIcon = (type: NodeType) => {
    switch (type) {
      case 'agent':
        return <Bot className="w-3.5 h-3.5 text-[#9D4EDD]" />;
      case 'human':
        return <UserCheck className="w-3.5 h-3.5 text-[#E76F51]" />;
      case 'dmn':
        return <Table className="w-3.5 h-3.5 text-[#2A9D8F]" />;
      case 'gateway':
        return <GitFork className="w-3.5 h-3.5 text-[#F4A261]" />;
      case 'event':
      default:
        return <Circle className="w-3.5 h-3.5 text-[#F4A261]" />;
    }
  };

  return (
    <div
      ref={panelRef}
      className="absolute z-30 w-[480px] max-h-[360px] bg-[#25201D] border border-[#3A322E] rounded-2xl shadow-warm-lg flex flex-col overflow-hidden animate-in slide-in-from-bottom-5"
      style={{ left: 0, top: 0, transform: `translate(${pos.x}px, ${pos.y}px)` }}
    >
      {/* Drawer Header — drag handle */}
      <div
        className="p-3 bg-[#1A1614] border-b border-[#3A322E] flex items-center justify-between cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex items-center space-x-2">
          <GripVertical className="w-3.5 h-3.5 text-[#A89F91] shrink-0" />
          <Terminal className="w-4 h-4 text-[#9D4EDD]" />
          <span className="font-bold text-xs text-[#EAE3D9] tracking-wide">
            Real-Time Audit Stream & Simulation Logs
          </span>
          {isSimulating && (
            <span className="text-[10px] bg-[#9D4EDD]/20 text-[#9D4EDD] px-2 py-0.5 rounded-full font-mono animate-pulse flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#9D4EDD]" />
              Active
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onClearLogs}
            className="text-[11px] text-[#A89F91] hover:text-[#EAE3D9] px-2 py-0.5 rounded hover:bg-[#25201D]"
          >
            Clear Stream
          </button>
          <button
            onClick={onClose}
            className="text-[#A89F91] hover:text-[#EAE3D9] p-1 rounded hover:bg-[#25201D]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Logs Stream Body */}
      <div className="p-3 flex-1 overflow-y-auto space-y-2 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="py-8 text-center text-[#A89F91] text-xs">
            <Clock className="w-6 h-6 mx-auto mb-2 opacity-40 text-[#F4A261]" />
            <p>No execution events logged.</p>
            <p className="text-[10px] text-[#A89F91]">Click "Run" in the top bar, then "Run Live" to execute on the engine.</p>
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="p-2.5 rounded-xl bg-[#1A1614] border border-[#3A322E] space-y-1 text-xs"
            >
              <div className="flex items-center justify-between text-[10px] text-[#A89F91]">
                <div className="flex items-center gap-1.5">
                  <span className="text-[#9D4EDD]">{log.timestamp}</span>
                  <div className="flex items-center gap-1 bg-[#25201D] px-1.5 py-0.5 rounded border border-[#3A322E]">
                    {getNodeIcon(log.nodeType)}
                    <span className="text-[#EAE3D9] font-medium">{log.nodeTitle}</span>
                  </div>
                </div>

                {log.confidence !== undefined && (
                  <span className="text-[#90A955] font-bold">
                    Confidence: {log.confidence}%
                  </span>
                )}
              </div>

              <div className="flex items-start gap-1.5 pt-0.5">
                {log.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-[#90A955] shrink-0 mt-0.5" />}
                {log.status === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-[#E76F51] shrink-0 mt-0.5" />}
                {log.status === 'info' && <Info className="w-3.5 h-3.5 text-[#F4A261] shrink-0 mt-0.5" />}
                <p className="text-[#EAE3D9] text-[11px] leading-relaxed">
                  {log.message}
                </p>
              </div>

              {log.outputs && log.outputs.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {log.outputs.map((output, i) => (
                    <span
                      key={`${output.name}-${i}`}
                      className="text-[10px] font-mono bg-[#2A9D8F]/15 text-[#2A9D8F] border border-[#2A9D8F]/30 px-1.5 py-0.5 rounded"
                    >
                      {output.name} = {output.value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
