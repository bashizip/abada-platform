import React, { useState } from 'react';
import { X, Sparkles, Plus, Layers, CheckCircle } from 'lucide-react';
import { WorkflowFile } from '@/types';

interface NewWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateWorkflow: (name: string, category: 'finance' | 'onboarding' | 'claims' | 'supply_chain' | 'custom') => void;
}

export const NewWorkflowModal: React.FC<NewWorkflowModalProps> = ({
  isOpen,
  onClose,
  onCreateWorkflow,
}) => {
  const [fileName, setFileName] = useState<string>('');
  const [category, setCategory] = useState<'finance' | 'onboarding' | 'claims' | 'supply_chain' | 'custom'>('finance');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileName.trim()) return;
    const finalName = fileName.endsWith('.bpmn') ? fileName : `${fileName}.bpmn`;
    onCreateWorkflow(finalName, category);
    setFileName('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl w-full max-w-md p-5 shadow-warm-lg space-y-5 animate-in zoom-in-95">
        <div className="flex items-center justify-between border-b border-[#3A322E] pb-3">
          <div className="flex items-center gap-2 text-[#F4A261]">
            <Plus className="w-5 h-5" />
            <h2 className="font-bold text-sm text-[#EAE3D9]">Create New Process Diagram</h2>
          </div>
          <button onClick={onClose} className="text-[#A89F91] hover:text-[#EAE3D9]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-[#A89F91] block font-medium">Process File Name</label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="e.g. international_trade_clearance.bpmn"
              className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2.5 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#F4A261]"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-[#A89F91] block font-medium">Domain Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as any)}
              className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2.5 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#F4A261]"
            >
              <option value="finance">Finance & Payment Settlement</option>
              <option value="onboarding">Corporate Onboarding & KYC</option>
              <option value="claims">Insurance Claims & Underwriting</option>
              <option value="supply_chain">Supply Chain & Freight Logistics</option>
              <option value="custom">Custom Enterprise Process</option>
            </select>
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#1A1614] hover:bg-[#2F2926] text-[#A89F91] hover:text-[#EAE3D9] border border-[#3A322E]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#F4A261] hover:bg-[#f5ad73] text-[#1A1614] active:scale-95 shadow-warm-md"
            >
              Create Canvas
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
