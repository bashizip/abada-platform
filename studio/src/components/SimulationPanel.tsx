import React from 'react';
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
  RotateCcw
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
    <div className="absolute bottom-20 right-4 z-30 w-[480px] max-h-[360px] bg-[#25201D] border border-[#3A322E] rounded-2xl shadow-warm-lg flex flex-col overflow-hidden animate-in slide-in-from-bottom-5">
      {/* Drawer Header */}
      <div className="p-3 bg-[#1A1614] border-b border-[#3A322E] flex items-center justify-between">
        <div className="flex items-center space-x-2">
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
            <p className="text-[10px] text-[#A89F91]">Click "Simulate Execution" in the top bar to run the process flow.</p>
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
            </div>
          ))
        )}
      </div>
    </div>
  );
};
