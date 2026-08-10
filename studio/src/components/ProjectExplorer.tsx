import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ChevronDown, ChevronRight, FileJson, FileText, FileUp, Folder,
  FolderInput, FolderPlus, FolderTree, Download, Loader2, Pencil, Plus,
  RefreshCw, Trash2, X, Check,
} from 'lucide-react';
import {
  ProjectAPI, ProjectResourceContent, ProjectTreeNode,
  ResourceKind, flattenTreeFolders,
} from '@/api/projects';
import { WorkflowFile } from '@/types';

interface ProjectExplorerProps {
  projectId: string;
  activeWorkflowId?: string;
  workflows: WorkflowFile[];
  onSelectWorkflow: (id: string) => void;
  onActivateWorkflow: (workflow: WorkflowFile) => void;
  onRemoveDocument: (documentId: string) => void;
  onNewWorkflow: () => void;
  refreshKey?: number;
}

type RowKind = 'folder' | 'document' | 'resource';

interface MoveTarget {
  kind: RowKind;
  id: string;
  revision: number;
  display: string;
}

interface NewResourceState {
  folderId: string | null;
  name: string;
  kind: ResourceKind;
  contentType: string;
  contentBase64: string;
}

const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const base64ToText = (base64: string): string =>
  new TextDecoder('utf-8').decode(base64ToBytes(base64));

const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    resolve(result.slice(result.indexOf(',') + 1));
  };
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

export const ProjectExplorer: React.FC<ProjectExplorerProps> = ({
  projectId,
  activeWorkflowId,
  workflows,
  onSelectWorkflow,
  onActivateWorkflow,
  onRemoveDocument,
  onNewWorkflow,
  refreshKey = 0,
}) => {
  const [tree, setTree] = useState<ProjectTreeNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ kind: RowKind; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creatingFolderIn, setCreatingFolderIn] = useState<string | null>(null);
  const [newFolderValue, setNewFolderValue] = useState('');
  const [newResource, setNewResource] = useState<NewResourceState | null>(null);
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const [preview, setPreview] = useState<ProjectResourceContent | null>(null);
  const [busy, setBusy] = useState(false);
  const initializedProject = useRef<string | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    try {
      setTree(await ProjectAPI.tree(projectId));
      setLoadError(null);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
  }, [projectId, refreshKey, refetch]);

  useEffect(() => {
    if (initializedProject.current === projectId || tree === null) return;
    initializedProject.current = projectId;
    const processes = tree.find((node) => node.kind === 'FOLDER' && node.name === 'processes');
    setExpanded(new Set(processes ? [processes.id] : []));
  }, [projectId, tree]);

  const folderEntries = useMemo(() => flattenTreeFolders(tree ?? []), [tree]);

  const run = async (operation: () => Promise<void>, failMessage: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await operation();
    } catch (reason) {
      setActionError(`${failMessage}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleFolder = (folderId: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const openDocument = (node: ProjectTreeNode): void => {
    const known = workflows.find((workflow) => workflow.documentId === node.id);
    if (known) {
      onSelectWorkflow(known.id);
      return;
    }
    void ProjectAPI.documents(projectId).then((documents) => {
      const document = documents.find((item) => item.id === node.id);
      if (document) onActivateWorkflow(ProjectAPI.workflow(document));
    }).catch(() => setActionError('Could not load the process document'));
  };

  const startRename = (kind: RowKind, id: string, currentName: string): void => {
    setRenaming({ kind, id });
    setRenameValue(currentName);
  };

  const commitRename = (kind: RowKind, id: string, revision: number): void => {
    const name = renameValue.trim();
    if (!name || !renaming) return;
    const operation = kind === 'folder'
      ? () => ProjectAPI.renameFolder(projectId, id, name).then(() => undefined)
      : kind === 'document'
        ? () => ProjectAPI.renameDocument(projectId, id, name, revision).then(() => undefined)
        : () => ProjectAPI.renameResource(projectId, id, name, revision).then(() => undefined);
    void run(async () => {
      await operation();
      setRenaming(null);
      await refetch();
    }, 'Rename failed');
  };

  const createFolder = (parentId: string | null): void => {
    const name = newFolderValue.trim();
    if (!name) return;
    void run(async () => {
      const created = await ProjectAPI.createFolder(projectId, name, parentId);
      setCreatingFolderIn(null);
      setNewFolderValue('');
      await refetch();
      setExpanded((current) => new Set(current).add(created.id));
    }, 'Folder creation failed');
  };

  const openPreview = async (node: ProjectTreeNode): Promise<void> => {
    setActionError(null);
    try {
      setPreview(await ProjectAPI.getResource(projectId, node.id));
    } catch (reason) {
      setActionError(`Could not open file: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const downloadPreview = (resource: ProjectResourceContent): void => {
    const blob = new Blob([base64ToBytes(resource.contentBase64)],
      { type: resource.contentType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = resource.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const replacePreview = async (resource: ProjectResourceContent, file: File): Promise<void> => {
    const base64 = await readFileAsBase64(file);
    await run(async () => {
      const updated = await ProjectAPI.replaceResource(projectId, resource.id,
        file.type || resource.contentType, base64, resource.revision);
      setPreview(await ProjectAPI.getResource(projectId, updated.id));
      await refetch();
    }, 'Replace failed');
  };

  const submitNewResource = (): void => {
    if (!newResource) return;
    const { folderId, name, kind, contentType, contentBase64 } = newResource;
    if (!name.trim() || !contentBase64) {
      setActionError('Provide a file name and select a file to import');
      return;
    }
    void run(async () => {
      await ProjectAPI.createResource(projectId, name.trim(), kind,
        contentType || 'application/octet-stream', contentBase64, folderId);
      setNewResource(null);
      await refetch();
    }, 'File creation failed');
  };

  const deleteFolder = (node: ProjectTreeNode): void => {
    const affected: string[] = [];
    const collect = (current: ProjectTreeNode): void => {
      if (current.kind === 'DOCUMENT') affected.push(current.id);
      current.children.forEach(collect);
    };
    collect(node);
    if (!window.confirm(
      `Delete folder "${node.path}"?\n\nAll process files inside are archived (deployments stay live) and every other file is permanently removed.`
    )) return;
    void run(async () => {
      await ProjectAPI.deleteFolder(projectId, node.id);
      affected.forEach(onRemoveDocument);
      await refetch();
    }, 'Folder deletion failed');
  };

  const archiveDocument = (node: ProjectTreeNode): void => {
    if (!window.confirm(`Archive "${node.path}"? The process stays deployed, but the file is hidden and read-only.`)) return;
    void run(async () => {
      await ProjectAPI.archiveDocument(projectId, node.id, true, node.revision);
      onRemoveDocument(node.id);
      await refetch();
    }, 'Archive failed');
  };

  const excludedMoveTargets = (): Set<string> => {
    if (!moving || moving.kind !== 'folder') return new Set();
    const excluded = new Set<string>();
    const findNode = (nodes: ProjectTreeNode[], id: string): ProjectTreeNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const found = findNode(node.children, id);
        if (found) return found;
      }
      return null;
    };
    const collect = (node: ProjectTreeNode): void => {
      node.children.forEach((child) => {
        if (child.kind !== 'FOLDER') return;
        excluded.add(child.id);
        collect(child);
      });
    };
    const target = findNode(tree ?? [], moving.id);
    if (target) {
      excluded.add(target.id);
      collect(target);
    }
    return excluded;
  };

  const excluded = excludedMoveTargets();

  const commitMove = (folderId: string | null): void => {
    if (!moving) return;
    const operation = moving.kind === 'folder'
      ? () => ProjectAPI.moveFolder(projectId, moving.id, folderId, moving.revision).then(() => undefined)
      : moving.kind === 'document'
        ? () => ProjectAPI.moveDocument(projectId, moving.id, folderId, moving.revision).then(() => undefined)
        : () => ProjectAPI.moveResource(projectId, moving.id, folderId, moving.revision).then(() => undefined);
    void run(async () => {
      await operation();
      setMoving(null);
      await refetch();
    }, 'Move failed');
    setMoving(null);
  };

  const isActiveDocument = (node: ProjectTreeNode): boolean =>
    !!workflows.find((workflow) => workflow.documentId === node.id && workflow.id === activeWorkflowId);

  const drafts = workflows.filter((workflow) => !workflow.documentId);

  const renderFolderRow = (node: ProjectTreeNode, depth: number): React.ReactElement => (
    <div key={node.id} className="group">
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-[#2F2926] cursor-pointer text-[#EAE3D9]"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => toggleFolder(node.id)}
      >
        {expanded.has(node.id) ? <ChevronDown className="w-3.5 h-3.5 text-[#A89F91] shrink-0" /> 
          : <ChevronRight className="w-3.5 h-3.5 text-[#A89F91] shrink-0" />}
        <Folder className={`w-4 h-4 shrink-0 ${expanded.has(node.id) ? 'text-[#F4A261]' : 'text-[#A89F91]'}`} />
        <span className="text-xs font-medium truncate flex-1">{node.name}</span>
        <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button title="New file" disabled={busy}
            onClick={(event) => { event.stopPropagation(); setNewResource({
              folderId: node.id, name: '', kind: 'RESOURCE', contentType: 'application/json',
              contentBase64: '' }); }}
            className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#2A9D8F]">
            <Plus className="w-3 h-3" />
          </button>
          <button title="Rename" disabled={busy}
            onClick={(event) => { event.stopPropagation(); startRename('folder', node.id, node.name); }}
            className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9]">
            <Pencil className="w-3 h-3" />
          </button>
          <button title="Move" disabled={busy}
            onClick={(event) => { event.stopPropagation(); setMoving({ kind: 'folder', id: node.id, revision: node.revision, display: node.path }); }}
            className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9]">
            <FolderInput className="w-3 h-3" />
          </button>
          <button title="Delete folder" disabled={busy}
            onClick={(event) => { event.stopPropagation(); deleteFolder(node); }}
            className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#E76F51]">
            <Trash2 className="w-3 h-3" />
          </button>
        </span>
      </div>
      {renaming && renaming.kind === 'folder' && renaming.id === node.id && (
        <form className="flex items-center gap-1 px-2 ml-6" style={{ paddingLeft: 20 + depth * 14 }}
          onSubmit={(event) => { event.preventDefault(); commitRename('folder', node.id, node.revision); }}>
          <input autoFocus value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }}
            className="flex-1 min-w-0 bg-[#1A1614] border border-[#3A322E] rounded px-2 py-1 text-xs text-[#EAE3D9]" />
          <button type="submit" className="p-1 text-[#90A955]"><Check className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => setRenaming(null)} className="p-1 text-[#A89F91]"><X className="w-3.5 h-3.5" /></button>
        </form>
      )}
      {expanded.has(node.id) && (
        <div>
          {creatingFolderIn === node.id && (
            <form className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: 20 + depth * 14 }}
              onSubmit={(event) => { event.preventDefault(); createFolder(node.id); }}>
              <Folder className="w-3.5 h-3.5 text-[#A89F91] shrink-0" />
              <input autoFocus value={newFolderValue} placeholder="Folder name"
                onChange={(event) => setNewFolderValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') { setCreatingFolderIn(null); setNewFolderValue(''); } }}
                className="flex-1 min-w-0 bg-[#1A1614] border border-[#3A322E] rounded px-2 py-1 text-xs text-[#EAE3D9]" />
              <button type="submit" className="p-1 text-[#90A955]"><Check className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => { setCreatingFolderIn(null); setNewFolderValue(''); }} className="p-1 text-[#A89F91]"><X className="w-3.5 h-3.5" /></button>
            </form>
          )}
          {node.children.map((child) => renderRow(child, depth + 1))}
        </div>
      )}
    </div>
  );

  const renderDocumentRow = (node: ProjectTreeNode, depth: number): React.ReactElement => {
    const active = isActiveDocument(node);
    return (
      <div key={node.id} className="group">
        <div
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-[#EAE3D9] ${
            active ? 'bg-[#1A1614] border border-[#F4A261]/40' : 'hover:bg-[#2F2926] border border-transparent'}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => openDocument(node)}
        >
          <FileText className={`w-4 h-4 shrink-0 ${active ? 'text-[#F4A261]' : 'text-[#A89F91]'}`} />
          <span className="text-xs truncate flex-1">{node.name}</span>
          <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <button title="Rename" disabled={busy}
              onClick={(event) => { event.stopPropagation(); startRename('document', node.id, node.name); }}
              className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9]">
              <Pencil className="w-3 h-3" />
            </button>
            <button title="Move to folder" disabled={busy}
              onClick={(event) => { event.stopPropagation(); setMoving({ kind: 'document', id: node.id, revision: node.revision, display: node.path }); }}
              className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9]">
              <FolderInput className="w-3 h-3" />
            </button>
            <button title="Archive" disabled={busy}
              onClick={(event) => { event.stopPropagation(); archiveDocument(node); }}
              className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#E76F51]">
              <Archive className="w-3 h-3" />
            </button>
          </span>
        </div>
        {renaming && renaming.kind === 'document' && renaming.id === node.id && (
          <form className="flex items-center gap-1 px-2" style={{ paddingLeft: 20 + depth * 14 }}
            onSubmit={(event) => { event.preventDefault(); commitRename('document', node.id, node.revision); }}>
            <input autoFocus value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }}
              className="flex-1 min-w-0 bg-[#1A1614] border border-[#3A322E] rounded px-2 py-1 text-xs text-[#EAE3D9]" />
            <button type="submit" className="p-1 text-[#90A955]"><Check className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => setRenaming(null)} className="p-1 text-[#A89F91]"><X className="w-3.5 h-3.5" /></button>
          </form>
        )}
      </div>
    );
  };

  const renderResourceRow = (node: ProjectTreeNode, depth: number): React.ReactElement => {
    const kind = node.status === 'FORM' ? 'FORM' : 'RESOURCE';
    const Icon = kind === 'FORM' ? FileJson : FileText;
    return (
      <div key={node.id} className="group">
        <div
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[#2F2926] text-[#EAE3D9] border border-transparent"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => void openPreview(node)}
        >
          <Icon className={`w-4 h-4 shrink-0 ${kind === 'FORM' ? 'text-[#2A9D8F]' : 'text-[#9D4EDD]'}`} />
          <span className="text-xs truncate flex-1">{node.name}</span>
          <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <button title="Rename" disabled={busy}
              onClick={(event) => { event.stopPropagation(); startRename('resource', node.id, node.name); }}
              className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9]">
              <Pencil className="w-3 h-3" />
            </button>
            <button title="Move to folder" disabled={busy}
              onClick={(event) => { event.stopPropagation(); setMoving({ kind: 'resource', id: node.id, revision: node.revision, display: node.path }); }}
              className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9]">
              <FolderInput className="w-3 h-3" />
            </button>
            <button title="Delete" disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                if (!window.confirm(`Delete "${node.path}" permanently?`)) return;
                void run(async () => {
                  await ProjectAPI.deleteResource(projectId, node.id);
                  await refetch();
                }, 'File deletion failed');
              }}
              className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#E76F51]">
              <Trash2 className="w-3 h-3" />
            </button>
          </span>
        </div>
        {renaming && renaming.kind === 'resource' && renaming.id === node.id && (
          <form className="flex items-center gap-1 px-2" style={{ paddingLeft: 20 + depth * 14 }}
            onSubmit={(event) => { event.preventDefault(); commitRename('resource', node.id, node.revision); }}>
            <input autoFocus value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }}
              className="flex-1 min-w-0 bg-[#1A1614] border border-[#3A322E] rounded px-2 py-1 text-xs text-[#EAE3D9]" />
            <button type="submit" className="p-1 text-[#90A955]"><Check className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => setRenaming(null)} className="p-1 text-[#A89F91]"><X className="w-3.5 h-3.5" /></button>
          </form>
        )}
      </div>
    );
  };

  const renderRow = (node: ProjectTreeNode, depth: number): React.ReactElement => {
    if (node.kind === 'FOLDER') return renderFolderRow(node, depth);
    if (node.kind === 'DOCUMENT') return renderDocumentRow(node, depth);
    return renderResourceRow(node, depth);
  };

  const renderMovePicker = (): React.ReactElement | null => {
    if (!moving) return null;
    return (
      <div className="fixed inset-0 z-40 bg-black/60 flex items-start justify-center pt-28" onClick={() => setMoving(null)}>
        <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl w-80 p-4 shadow-warm-lg space-y-2"
          onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#EAE3D9]">Move &quot;{moving.display}&quot; to</span>
            <button onClick={() => setMoving(null)} className="text-[#A89F91] hover:text-[#EAE3D9]"><X className="w-4 h-4" /></button>
          </div>
          <button
            disabled={busy || excluded.has('')}
            onClick={() => commitMove(null)}
            className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-[#A89F91] hover:bg-[#1A1614] disabled:opacity-40"
          >
            Project root (no folder)
          </button>
          {folderEntries.map((entry) => {
            const depth = entry.path.split('/').length - 1;
            return (
              <button key={entry.folder.id}
                disabled={busy || excluded.has(entry.folder.id)}
                onClick={() => commitMove(entry.folder.id)}
                className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-[#A89F91] hover:bg-[#1A1614] disabled:opacity-40 flex items-center gap-1.5"
                style={{ paddingLeft: 8 + depth * 12 }}
              >
                <Folder className="w-3.5 h-3.5 text-[#F4A261]" />
                {entry.path}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderPreview = (): React.ReactElement | null => {
    if (!preview) return null;
    const isText = !preview.contentType || preview.contentType.startsWith('text/') ||
      preview.contentType.includes('json') || preview.contentType.includes('yaml') ||
      preview.contentType.includes('xml') || preview.contentType.includes('csv');
    return (
      <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl w-full max-w-2xl p-5 shadow-warm-lg flex flex-col max-h-[85vh] space-y-3">
          <div className="flex items-center justify-between border-b border-[#3A322E] pb-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileJson className="w-4 h-4 text-[#2A9D8F] shrink-0" />
              <h2 className="text-sm font-bold text-[#EAE3D9] truncate">{preview.name}</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1614] border border-[#3A322E] text-[#A89F91]">
                {preview.kind}
              </span>
            </div>
            <button onClick={() => setPreview(null)} className="text-[#A89F91] hover:text-[#EAE3D9]">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-[#A89F91] font-mono">
            <span>{preview.contentType || 'unknown'}</span>
            <span>{preview.sizeBytes} bytes</span>
            <span>sha256 {preview.sha256.slice(0, 12)}…</span>
          </div>
          <div className="flex-1 overflow-auto bg-[#1A1614] rounded-xl border border-[#3A322E] p-3">
            {isText ? (
              <pre className="text-[11px] text-[#A8D8B9] whitespace-pre-wrap break-all font-mono max-h-96 overflow-auto">
                {base64ToText(preview.contentBase64)}
              </pre>
            ) : (
              <div className="text-xs text-[#A89F91] text-center py-8">
                Binary file — use Download to save it locally.
              </div>
            )}
          </div>
          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-[#1A1614] hover:bg-[#2F2926] text-[#A89F91] border border-[#3A322E] cursor-pointer">
              <FileUp className="w-3.5 h-3.5" />
              Replace Content
              <input type="file" className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void replacePreview(preview, file);
                }} />
            </label>
            <div className="flex gap-2">
              <button onClick={() => downloadPreview(preview)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#1A1614] hover:bg-[#2F2926] text-[#A89F91] border border-[#3A322E]">
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
              <button onClick={() => setPreview(null)}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-[#F4A261] hover:bg-[#f5ad73] text-[#1A1614]">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderNewResourceModal = (): React.ReactElement | null => {
    if (!newResource) return null;
    const targetPath = folderEntries.find((entry) => entry.folder.id === newResource.folderId)?.path;
    return (
      <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl w-full max-w-md p-5 shadow-warm-lg space-y-4">
          <div className="flex items-center justify-between border-b border-[#3A322E] pb-3">
            <div className="flex items-center gap-2 text-[#2A9D8F]">
              <FileUp className="w-5 h-5" />
              <h2 className="font-bold text-sm text-[#EAE3D9]">Import File{targetPath ? ` into ${targetPath}/` : ''}</h2>
            </div>
            <button onClick={() => setNewResource(null)} className="text-[#A89F91] hover:text-[#EAE3D9]">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block font-medium">File Name</label>
              <input value={newResource.name}
                onChange={(event) => setNewResource({ ...newResource, name: event.target.value })}
                placeholder="e.g. clearing_form_schema.json"
                className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2.5 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A89F91] block font-medium">Kind</label>
                <select value={newResource.kind}
                  onChange={(event) => setNewResource({ ...newResource, kind: event.target.value as ResourceKind })}
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2.5 text-xs text-[#EAE3D9]">
                  <option value="RESOURCE">RESOURCE</option>
                  <option value="FORM">FORM</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[#A89F91] block font-medium">Content Type</label>
                <input value={newResource.contentType}
                  onChange={(event) => setNewResource({ ...newResource, contentType: event.target.value })}
                  list="content-type-presets"
                  className="w-full bg-[#1A1614] border border-[#3A322E] rounded-xl px-3 py-2.5 text-xs text-[#EAE3D9] focus:outline-none focus:border-[#2A9D8F]" />
                <datalist id="content-type-presets">
                  <option value="application/json" />
                  <option value="application/yaml" />
                  <option value="text/plain" />
                  <option value="text/csv" />
                  <option value="application/pdf" />
                </datalist>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-[#A89F91] block font-medium">File Content</label>
              <label className="flex items-center justify-center gap-2 px-3 py-6 rounded-xl bg-[#1A1614] border border-dashed border-[#3A322E] text-[11px] text-[#A89F91] cursor-pointer hover:border-[#2A9D8F]">
                <FileUp className="w-4 h-4" />
                {newResource.contentBase64 ? 'Selected — choose another file to replace' : 'Click to select a file'}
                <input type="file" className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const base64 = await readFileAsBase64(file);
                    setNewResource((current) => current ? {
                      ...current,
                      name: current.name.trim() || file.name,
                      contentType: current.contentType === 'application/json' && !file.type
                        ? 'application/json' : (current.contentType || file.type || 'application/octet-stream'),
                      contentBase64: base64,
                    } : current);
                  }} />
              </label>
              {newResource.contentBase64 && (
                <p className="text-[10px] text-[#90A955] font-mono">
                  {Math.round(newResource.contentBase64.length * 0.75)} bytes staged
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setNewResource(null)}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#1A1614] hover:bg-[#2F2926] text-[#A89F91] border border-[#3A322E]">
              Cancel
            </button>
            <button onClick={submitNewResource} disabled={busy}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#2A9D8F] hover:bg-[#34bdae] text-[#101816] disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 inline animate-spin" /> : 'Import File'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wider text-[#A89F91] uppercase">
          Project Files
        </span>
        <div className="flex items-center gap-0.5">
          <button title="New Folder" disabled={busy}
            onClick={() => setCreatingFolderIn('__root__')}
            className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#F4A261]">
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button title="Import File" disabled={busy}
            onClick={() => setNewResource({ folderId: null, name: '', kind: 'RESOURCE',
              contentType: 'application/json', contentBase64: '' })}
            className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#2A9D8F]">
            <FileUp className="w-3.5 h-3.5" />
          </button>
          <button title="New Process" disabled={busy}
            onClick={onNewWorkflow}
            className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9]">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button title="Refresh Project Files" disabled={busy}
            onClick={() => void refetch()}
            className="p-1 rounded hover:bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9]">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {creatingFolderIn === '__root__' && (
        <form className="flex items-center gap-1 px-2 py-1 bg-[#1A1614] rounded-lg border border-[#3A322E]"
          onSubmit={(event) => { event.preventDefault(); createFolder(null); }}>
          <Folder className="w-3.5 h-3.5 text-[#F4A261] shrink-0" />
          <input autoFocus value={newFolderValue} placeholder="Folder name (project root)"
            onChange={(event) => setNewFolderValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { setCreatingFolderIn(null); setNewFolderValue(''); } }}
            className="flex-1 min-w-0 bg-transparent px-1 py-1 text-xs text-[#EAE3D9]" />
          <button type="submit" className="p-1 text-[#90A955]"><Check className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => { setCreatingFolderIn(null); setNewFolderValue(''); }} className="p-1 text-[#A89F91]"><X className="w-3.5 h-3.5" /></button>
        </form>
      )}

      {actionError && (
        <div className="text-[11px] text-[#E76F51] bg-[#E76F51]/10 border border-[#E76F51]/30 rounded-lg px-3 py-2">
          {actionError}
        </div>
      )}
      {loadError && !actionError && (
        <div className="text-[11px] text-[#E76F51] bg-[#E76F51]/10 border border-[#E76F51]/30 rounded-lg px-3 py-2">
          {loadError}
        </div>
      )}

      {tree === null && !loadError && (
        <div className="text-xs text-[#A89F91] text-center py-4 flex items-center justify-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading project files…
        </div>
      )}

      {tree !== null && tree.length === 0 && !loadError && (
        <div className="text-xs text-[#A89F91] text-center p-4 bg-[#1A1614] rounded-xl border border-[#3A322E]">
          <FolderTree className="w-4 h-4 mx-auto mb-1.5 text-[#A89F91]" />
          No files yet. Create a folder or a new process file.
        </div>
      )}

      {tree !== null && tree.length > 0 && (
        <div className="space-y-0.5">
          {tree.map((node) => renderRow(node, 0))}
        </div>
      )}

      {drafts.length > 0 && (
        <div className="pt-2 border-t border-[#3A322E] mt-2">
          <span className="text-[10px] font-semibold tracking-wider text-[#A89F91]/80 uppercase block mb-1.5">
            Unsaved Drafts
          </span>
          <div className="space-y-1">
            {drafts.map((draft) => (
              <button key={draft.id}
                onClick={() => onSelectWorkflow(draft.id)}
                className={`w-full text-left p-2 rounded-lg border flex items-center gap-2 ${
                  draft.id === activeWorkflowId
                    ? 'bg-[#1A1614] border-[#F4A261]/40'
                    : 'bg-[#25201D] hover:bg-[#2F2926] border-[#3A322E]'}`}
              >
                <span className="w-2 h-2 rounded-full bg-[#E76F51] shrink-0" />
                <FileText className="w-3.5 h-3.5 text-[#A89F91] shrink-0" />
                <span className="text-xs truncate">{draft.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {renderMovePicker()}
      {renderNewResourceModal()}
      {renderPreview()}
    </div>
  );
};