import React, { useEffect, useState } from 'react';
import { X, Plus, FolderTree } from 'lucide-react';
import { ProjectAPI, ProjectTreeNode, flattenTreeFolders } from '@/api/projects';

interface NewWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateWorkflow: (name: string, category: 'finance' | 'onboarding' | 'claims' | 'supply_chain' | 'custom', folderId?: string) => void;
  projectId?: string;
}

export const NewWorkflowModal: React.FC<NewWorkflowModalProps> = ({
  isOpen,
  onClose,
  onCreateWorkflow,
  projectId,
}) => {
  const [fileName, setFileName] = useState<string>('');
  const [category, setCategory] = useState<'finance' | 'onboarding' | 'claims' | 'supply_chain' | 'custom'>('finance');
  const [folders, setFolders] = useState<{ folder: ProjectTreeNode; path: string }[]>([]);
  const [folderId, setFolderId] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setFileName('');
    setFolderId('');
    if (!projectId) return;
    ProjectAPI.tree(projectId)
      .then((tree) => {
        const available = flattenTreeFolders(tree);
        setFolders(available);
        const processes = available.find((entry) => entry.path === 'processes');
        const defaultsTo = processes?.folder.id ?? available[0]?.folder.id ?? '';
        setFolderId(defaultsTo);
      })
      .catch(() => setFolders([]));
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileName.trim()) return;
    const finalName = fileName.endsWith('.apl.yaml') || fileName.endsWith('.bpmn')
      ? fileName
      : `${fileName}.apl.yaml`;
    onCreateWorkflow(finalName, category, folderId || undefined);
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
              placeholder="e.g. international_trade_clearance.apl.yaml"
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

          {folderId !== undefined && (
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block font-medium">Target Folder</label>
              <div className="relative">
                <FolderTree className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#A89F91]" />
                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl pl-9 pr-3 py-2.5 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#F4A261]"
                >
                  <option value="">Project root</option>
                  {folders.map((entry) => (
                    <option key={entry.folder.id} value={entry.folder.id}>
                      {entry.path}/
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

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