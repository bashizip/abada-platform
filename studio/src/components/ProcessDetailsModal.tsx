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
    <div className="flex flex-col gap-1 rounded-lg border border-hairline bg-charcoal px-3 py-2.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-sand">{label}</span>
      <span className="text-xs font-mono text-linen truncate">{value}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-deep/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Process Details"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-hairline bg-charcoal shadow-warm-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-mineral-teal/15 border border-mineral-teal/40 flex items-center justify-center shrink-0">
              <Cpu className="w-4 h-4 text-mineral-teal" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-linen tracking-wide truncate">
                {cleanName(workflow.name)}
              </h2>
              <p className="text-[10px] text-sand">Process Details</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close process details"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-hairline bg-charcoal text-sand hover:text-linen hover:bg-mocha-hover transition-all"
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
                  ? 'text-mineral-teal bg-mineral-teal/10 border-mineral-teal/30'
                  : 'text-saffron bg-saffron/10 border-saffron/30'
              }`}
            >
              {getRuntimeStatusTag(workflow.fileType)}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-sage-green/30 bg-sage-green/10 text-sage-green flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-sage-green animate-pulse" />
              Active
            </span>
            <span className="ml-auto text-[10px] font-mono text-sand flex items-center gap-1.5 pl-2">
              <Layers className="w-3 h-3" /> {workflow.nodes.length} nodes
              <GitBranch className="w-3 h-3 ml-2" /> {workflow.edges.length} edges
            </span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-hairline bg-mocha-deep">
          <p className="text-[10px] text-sand leading-relaxed flex items-start gap-1.5">
            <FileCode className="w-3 h-3 mt-0.5 text-mineral-teal shrink-0" />
            Versioned process definition — redeployment creates a new engine definition version; running instances keep the version they started from.
          </p>
          <p className="text-[10px] text-sand mt-1.5 flex items-start gap-1.5">
            <Clock className="w-3 h-3 mt-0.5 text-amethyst shrink-0" />
            {cleanName(workflow.name)}&nbsp;— durable instance state, transactional outbox delivery.
          </p>
        </div>
      </div>
    </div>
  );
};