import React, { useEffect, useState } from 'react';
import { X, FolderTree, FileText, Upload, ClipboardPaste, Loader2 } from 'lucide-react';
import { ProjectAPI, ProjectTreeNode, flattenTreeFolders } from '@/api/projects';
import { WorkflowFile } from '@/types';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';
import { transpileBPMNToAPL } from '@/lib/bpmn/transpiler';
import { LANGUAGE_VERSION_ABADA_IO_V1 } from '@/types';

type CreateMode = 'empty' | 'bpmn' | 'apl';

const APL_EXT = '.apl.yaml';

const ensureAplName = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return 'Untitled Process';
  return trimmed.endsWith(APL_EXT) ? trimmed : `${trimmed}${APL_EXT}`;
};

const sanitizeKey = (name: string): string =>
  name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().replace(/^[0-9]+/, 'process_') || `process_${Date.now()}`;

interface NewWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateWorkflow: (workflow: WorkflowFile, folderId?: string) => void;
  projectId?: string;
}

export const NewWorkflowModal: React.FC<NewWorkflowModalProps> = ({
  isOpen,
  onClose,
  onCreateWorkflow,
  projectId,
}) => {
  const [mode, setMode] = useState<CreateMode>('empty');
  const [fileName, setFileName] = useState<string>('');
  const [category, setCategory] = useState<WorkflowFile['category']>('finance');
  const [folders, setFolders] = useState<{ folder: ProjectTreeNode; path: string }[]>([]);
  const [folderId, setFolderId] = useState<string>('');
  const [bpmnSource, setBpmnSource] = useState<string>('');
  const [bpmnFileName, setBpmnFileName] = useState<string>('');
  const [aplSource, setAplSource] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode('empty');
    setFileName('');
    setCategory('finance');
    setBpmnSource('');
    setBpmnFileName('');
    setAplSource('');
    setError(null);
    setBusy(false);
    setFolderId('');
    if (!projectId) return;
    ProjectAPI.tree(projectId)
      .then((tree) => {
        const available = flattenTreeFolders(tree);
        setFolders(available);
        const processes = available.find((entry) => entry.path === 'processes');
        setFolderId(processes?.folder.id ?? '');
      })
      .catch(() => setFolders([]));
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  // Process documents only ever target the processes/ system root and its
  // subfolders; every file name is forced to the *.apl.yaml convention.
  const processFolders = folders.filter((entry) =>
    entry.path === 'processes' || entry.path.startsWith('processes/'));

  const readBpmnFile = (file: File): void => {
    setError(null);
    setBpmnFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setBpmnSource(String(reader.result || ''));
    reader.onerror = () => setError('Could not read the BPMN file');
    reader.readAsText(file);
  };

  const submit = (): void => {
    setError(null);
    setBusy(true);
    try {
      let workflow: WorkflowFile;
      if (mode === 'empty') {
        const name = ensureAplName(fileName);
        workflow = {
          id: 'pending',
          name,
          processKey: sanitizeKey(name),
          category,
          fileType: 'apl',
          languageVersion: LANGUAGE_VERSION_ABADA_IO_V1,
          version: '1.0.0',
          updatedAt: 'Just now',
          nodes: [],
          edges: [],
        };
      } else if (mode === 'bpmn') {
        if (!bpmnSource.trim()) {
          setError('Select a BPMN 2.0 XML file to import');
          setBusy(false);
          return;
        }
        const converted = aplToWorkflow(transpileBPMNToAPL(bpmnSource));
        const name = ensureAplName(fileName || converted.name || bpmnFileName.replace(/\.(bpmn|xml)$/i, ''));
        workflow = { ...converted, name, processKey: converted.processKey || sanitizeKey(name) };
      } else {
        if (!aplSource.trim()) {
          setError('Paste or type the APL YAML source');
          setBusy(false);
          return;
        }
        const parsed = parseAPLYaml(aplSource);
        if (!parsed?.metadata?.name || !parsed?.flow?.nodes) {
          setError('Invalid APL document: metadata.name and flow.nodes are required');
          setBusy(false);
          return;
        }
        const converted = aplToWorkflow(parsed);
        const name = ensureAplName(fileName || converted.name);
        workflow = { ...converted, name, processKey: converted.processKey || sanitizeKey(name) };
      }
      onCreateWorkflow(workflow, folderId || undefined);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const modes: { id: CreateMode; label: string; hint: string; icon: React.ElementType }[] = [
    { id: 'empty', label: 'Empty APL', hint: 'Blank canvas — the first event node becomes the start node', icon: FileText },
    { id: 'bpmn', label: 'Import BPMN', hint: 'Transpile an existing BPMN 2.0 XML file into APL', icon: Upload },
    { id: 'apl', label: 'Paste APL', hint: 'Author or paste APL YAML source directly', icon: ClipboardPaste },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl w-full max-w-lg p-5 shadow-warm-lg space-y-4 animate-in zoom-in-95">
        <div className="flex items-center justify-between border-b border-[#3A322E] pb-3">
          <div className="flex items-center gap-2 text-[#F4A261]">
            <FileText className="w-5 h-5" />
            <h2 className="font-bold text-sm text-[#EAE3D9]">New Process</h2>
          </div>
          <button onClick={onClose} className="text-[#A89F91] hover:text-[#EAE3D9]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {modes.map(({ id, label, hint, icon: Icon }) => (
            <button key={id} type="button" onClick={() => { setMode(id); setError(null); }}
              className={`rounded-xl border p-2.5 text-left transition-colors ${
                mode === id ? 'border-[#F4A261] bg-[#1A1614]' : 'border-[#3A322E] hover:border-[#A89F91]/50'}`}>
              <Icon className={`w-4 h-4 mb-1 ${mode === id ? 'text-[#F4A261]' : 'text-[#A89F91]'}`} />
              <span className="block text-[11px] font-semibold text-[#EAE3D9]">{label}</span>
              <span className="block text-[9px] text-[#A89F91] leading-snug mt-0.5">{hint}</span>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {mode === 'empty' && (
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block font-medium">Domain Category</label>
              <select value={category}
                onChange={(e) => setCategory(e.target.value as WorkflowFile['category'])}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2.5 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#F4A261]">
                <option value="finance">Finance & Payment Settlement</option>
                <option value="onboarding">Corporate Onboarding & KYC</option>
                <option value="claims">Insurance Claims & Underwriting</option>
                <option value="supply_chain">Supply Chain & Freight Logistics</option>
                <option value="custom">Custom Enterprise Process</option>
              </select>
            </div>
          )}

          {mode === 'bpmn' && (
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block font-medium">BPMN 2.0 File</label>
              <label className="flex items-center justify-center gap-2 px-3 py-6 rounded-xl bg-[#1A1614] border border-dashed border-[#3A322E] text-[11px] text-[#A89F91] cursor-pointer hover:border-[#F4A261]">
                <Upload className="w-4 h-4" />
                {bpmnSource ? bpmnFileName : 'Click to select a .bpmn / .xml file'}
                <input type="file" accept=".bpmn,.xml,text/xml" className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) readBpmnFile(file);
                  }} />
              </label>
            </div>
          )}

          {mode === 'apl' && (
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block font-medium">APL YAML Source</label>
              <textarea value={aplSource} onChange={(e) => setAplSource(e.target.value)}
                placeholder={'version: abada.io/v1\n\nmetadata:\n  key: my_process\n  name: My Process\n\nflow:\n  entry: start\n  nodes:\n    - id: start\n      type: webhook\n      next: end\n    - id: end\n      type: end'}
                rows={10}
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2.5 text-xs font-mono text-[#EAE3D9] focus:outline-none focus:border-[#F4A261] resize-y" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block font-medium">Process File Name</label>
              <input value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="e.g. international_trade_clearance"
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2.5 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#F4A261]" />
              <p className="text-[10px] text-[#A89F91]">Stored as <span className="font-mono text-[#90A955]">*.apl.yaml</span> under <span className="font-mono">processes/</span></p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block font-medium">Target Folder</label>
              <div className="relative">
                <FolderTree className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#A89F91]" />
                <select value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl pl-9 pr-3 py-2.5 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#F4A261]">
                  {processFolders.map((entry) => (
                    <option key={entry.folder.id} value={entry.folder.id}>
                      {entry.path}/
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="text-[11px] text-[#E76F51] bg-[#E76F51]/10 border border-[#E76F51]/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="pt-1 flex justify-end space-x-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#1A1614] hover:bg-[#2F2926] text-[#A89F91] hover:text-[#EAE3D9] border border-[#3A322E]">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#F4A261] hover:bg-[#f5ad73] text-[#1A1614] active:scale-95 shadow-warm-md disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 inline animate-spin" /> : 'Create Process'}
          </button>
        </div>
      </div>
    </div>
  );
};
