import React, { useEffect } from 'react';
import { X, FileCode, Layers, GitBranch, Clock, Cpu } from 'lucide-react';
import { WorkflowFile, getFileFormatLabel, getRuntimeStatusTag } from '@/types';

interface ProcessDetailsModalProps {
  workflow: WorkflowFile;
  isOpen: boolean;
  onClose: () => void;
}

/** Clean file identifier: process name only, no format/version noise. */
const cleanName = (name: string): string =>
  name.replace(/\.(apl\.yaml|bpmn|dmn|json|prompt)$/i, '');

/**
 * "Process Details" inspector modal. The metadata pills (format, semantic
 * version, language spec) live here instead of cluttering the header — the
 * header only shows the clean process name, which opens this dialog.
 */
export const ProcessDetailsModal: React.FC<ProcessDetailsModalProps> = ({
  workflow,
  isOpen,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isNative = getRuntimeStatusTag(workflow.fileType) === 'APL Native';
  const statCell = (label: string, value: React.ReactNode) => (
    <div className="flex flex-col gap-1 rounded-lg border border-[#3A322E] bg-[#1A1614] px-3 py-2.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-[#A89F91]">{label}</span>
      <span className="text-xs font-mono text-[#EAE3D9] truncate">{value}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#14110D]/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Process Details"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#3A322E] bg-[#1A1614] shadow-warm-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3A322E]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#2A9D8F]/15 border border-[#2A9D8F]/40 flex items-center justify-center shrink-0">
              <Cpu className="w-4 h-4 text-[#2A9D8F]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[#EAE3D9] tracking-wide truncate">
                {cleanName(workflow.name)}
              </h2>
              <p className="text-[10px] text-[#A89F91]">Process Details</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close process details"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#3A322E] bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9] hover:bg-[#2F2926] transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {statCell('File Format', getFileFormatLabel(workflow.fileType))}
            {statCell('Semantic Version', `v${workflow.version}`)}
            {statCell('Language Spec', workflow.languageVersion || '—')}
            {statCell('Updated', workflow.updatedAt)}
          </div>

          <div className="flex items-center gap-1.5 text-[10px]">
            <span
              className={`px-2 py-0.5 rounded-full border font-mono ${
                isNative
                  ? 'text-[#2A9D8F] bg-[#2A9D8F]/10 border-[#2A9D8F]/30'
                  : 'text-[#F4A261] bg-[#F4A261]/10 border-[#F4A261]/30'
              }`}
            >
              {getRuntimeStatusTag(workflow.fileType)}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#90A955]/30 bg-[#90A955]/10 text-[#90A955] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#90A955] animate-pulse" />
              Active
            </span>
            <span className="ml-auto text-[10px] font-mono text-[#A89F91] flex items-center gap-1.5 pl-2">
              <Layers className="w-3 h-3" /> {workflow.nodes.length} nodes
              <GitBranch className="w-3 h-3 ml-2" /> {workflow.edges.length} edges
            </span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#3A322E] bg-[#201B18]">
          <p className="text-[10px] text-[#A89F91] leading-relaxed flex items-start gap-1.5">
            <FileCode className="w-3 h-3 mt-0.5 text-[#2A9D8F] shrink-0" />
            Versioned process definition — redeployment creates a new engine definition version; running instances keep the version they started from.
          </p>
          <p className="text-[10px] text-[#A89F91] mt-1.5 flex items-start gap-1.5">
            <Clock className="w-3 h-3 mt-0.5 text-[#9D4EDD] shrink-0" />
            {cleanName(workflow.name)}&nbsp;— durable instance state, transactional outbox delivery.
          </p>
        </div>
      </div>
    </div>
  );
};