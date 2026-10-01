import { useState, useRef, useEffect, useCallback } from 'react';
import { Project, ProjectAPI } from '@/api/projects';
import { WorkflowFile, LANGUAGE_VERSION_ABADA_IO_V1 } from '@/types';
import { workflowFingerprint } from '@/lib/run/workflowFingerprint';
import { config } from '@/config/runtime';
import { ensureLeadTriageStarter } from '@/lib/starter/leadTriage';
import {
  WorkflowHistory, emptyHistory, record as recordEdit, redo as redoEdit, undo as undoEdit, withContent,
} from '@/lib/history/workflowHistory';

export const createEmptyWorkflow = (
  id: string,
  name = 'Untitled Process',
  processKey = 'untitled_process',
  category: WorkflowFile['category'] = 'custom',
): WorkflowFile => ({
  id,
  name,
  processKey: /^[a-z]/.test(processKey) ? processKey : `process_${processKey}`,
  category,
  fileType: 'apl',
  languageVersion: LANGUAGE_VERSION_ABADA_IO_V1,
  version: '1.0.0',
  updatedAt: 'Just now',
  nodes: [],
  edges: [],
});

export function useProjectWorkspace(authenticated: boolean) {
  const bootstrapWorkflow = useRef(createEmptyWorkflow('bootstrap-draft'));
  const [workflows, setWorkflows] = useState<WorkflowFile[]>([]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | undefined>();
  const [showProjects, setShowProjects] = useState(false);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [workspaceStatus, setWorkspaceStatus] = useState<'loading' | 'seeding' | 'ready' | 'error'>('loading');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const persistedFingerprint = useRef(new Map<string, string>());
  const failedAutosaveFingerprint = useRef(new Map<string, string>());
  const persistedProcessKeys = useRef(new Map<string, string>());
  const creatingWorkflowIds = useRef(new Set<string>());
  const processesRootId = useRef<string | undefined>(undefined);
  const materializedDraftId = useRef<string | undefined>(undefined);
  // Undo/redo per process document, keyed by workflow id (re-keyed when a
  // draft is first saved and receives its document id).
  const histories = useRef(new Map<string, WorkflowHistory>());
  const [historyVersion, setHistoryVersion] = useState(0);

  const currentWorkflow = workflows.find((w) => w.id === activeWorkflowId)
    || workflows[0] || bootstrapWorkflow.current;

  const openProject = useCallback(async (project: Project) => {
    setActiveProject(project);
    localStorage.setItem('abada.studio.projectId', project.id);
    const [documents, tree] = await Promise.all([
      ProjectAPI.documents(project.id),
      ProjectAPI.tree(project.id),
    ]);
    processesRootId.current = tree
      .find((node) => node.kind === 'FOLDER' && node.name === 'processes')?.id;
    if (documents.length) {
      const loaded = documents.map(ProjectAPI.workflow);
      loaded.forEach((workflow) => {
        persistedFingerprint.current.set(workflow.id, workflowFingerprint(workflow));
        if (workflow.documentId && workflow.processKey) {
          persistedProcessKeys.current.set(workflow.documentId, workflow.processKey);
        }
      });
      setWorkflows(loaded);
      setActiveWorkflowId(loaded[0].id);
    } else {
      setWorkflows([]);
      setActiveWorkflowId('');
    }
    setTreeRefreshKey((val) => val + 1);
  }, []);

  const initializeWorkspace = useCallback(async () => {
    if (!authenticated) return;
    setWorkspaceStatus('loading');
    setWorkspaceError(null);
    try {
      let available = await ProjectAPI.list();
      let seededProject: Project | undefined;
      if (config.starterWorkflowEnabled) {
        setWorkspaceStatus('seeding');
        const result = await ensureLeadTriageStarter(available);
        available = result.projects;
        seededProject = result.project;
      }
      setProjects(available);
      const remembered = localStorage.getItem('abada.studio.projectId');
      const selected = seededProject
        || available.find((project) => project.id === remembered)
        || available[0];
      if (selected) await openProject(selected);
      else setShowProjects(true);
      setWorkspaceStatus('ready');
    } catch (reason) {
      setWorkspaceError(reason instanceof Error ? reason.message : String(reason));
      setWorkspaceStatus('error');
    }
  }, [authenticated, openProject]);

  useEffect(() => {
    if (authenticated) void initializeWorkspace();
  }, [authenticated, initializeWorkspace]);

  // Autosave timer
  useEffect(() => {
    if (!activeProject) return;
    if (currentWorkflow.id === bootstrapWorkflow.current.id) return;

    const persistedProcessKey = currentWorkflow.documentId
      ? persistedProcessKeys.current.get(currentWorkflow.documentId)
      : undefined;
    const workflowToSave = persistedProcessKey && currentWorkflow.processKey !== persistedProcessKey
      ? { ...currentWorkflow, processKey: persistedProcessKey }
      : currentWorkflow;
    const fingerprint = workflowFingerprint(workflowToSave);

    if (persistedFingerprint.current.get(currentWorkflow.id) === fingerprint) return;
    if (failedAutosaveFingerprint.current.get(currentWorkflow.id) === fingerprint) return;

    const timer = window.setTimeout(() => {
      if (!currentWorkflow.documentId && creatingWorkflowIds.current.has(currentWorkflow.id)) return;
      if (!currentWorkflow.documentId) creatingWorkflowIds.current.add(currentWorkflow.id);

      const save = currentWorkflow.documentId
        ? ProjectAPI.saveDocument(activeProject.id, workflowToSave)
        : ProjectAPI.createDocument(
            activeProject.id,
            workflowToSave,
            workflowToSave.description || '',
            {
              folderId: workflowToSave.folderId ?? processesRootId.current ?? null,
              fileName: workflowToSave.fileName ?? null,
            }
          );

      save.then((saved) => {
        const persistedId = saved.id;
        persistedFingerprint.current.set(persistedId, fingerprint);
        failedAutosaveFingerprint.current.delete(currentWorkflow.id);
        persistedProcessKeys.current.set(persistedId, saved.processKey);

        if (persistedId !== currentWorkflow.id && histories.current.has(currentWorkflow.id)) {
          histories.current.set(persistedId, histories.current.get(currentWorkflow.id)!);
          histories.current.delete(currentWorkflow.id);
        }
        setWorkflows((items) =>
          items.map((item) =>
            item.id === currentWorkflow.id
              ? {
                  ...item,
                  id: persistedId,
                  documentId: persistedId,
                  revision: saved.revision,
                  processKey: saved.processKey,
                  updatedAt: saved.updatedAt,
                }
              : item
          )
        );
        if (!currentWorkflow.documentId) {
          setActiveWorkflowId((id) => (id === currentWorkflow.id ? persistedId : id));
        }
        setTreeRefreshKey((val) => val + 1);
      }).catch((err) => {
        failedAutosaveFingerprint.current.set(currentWorkflow.id, fingerprint);
        console.error('Autosave failed:', err);
      }).finally(() => creatingWorkflowIds.current.delete(currentWorkflow.id));
    }, 800);

    return () => window.clearTimeout(timer);
  }, [activeProject, currentWorkflow]);

  /**
   * Records `before` → `after` as an undo step of document `id`. Edits of the
   * same `kind` in quick succession merge into one step; without a kind every
   * edit is its own step.
   */
  const recordHistory = useCallback((id: string, before: WorkflowFile, after: WorkflowFile, kind?: string) => {
    const now = Date.now();
    const current = histories.current.get(id) ?? emptyHistory();
    const next = recordEdit(current, before, after, kind ?? `edit-${now}-${Math.random()}`, now);
    if (next !== current) {
      histories.current.set(id, next);
      setHistoryVersion((value) => value + 1);
    }
  }, []);

  /**
   * Applies an edit to the active process document. `kind` groups rapid edits
   * of the same thing (a drag, typing in one field) into one undo step; `null`
   * applies the edit without recording it (for example the automatic first
   * layout of a newly opened process).
   */
  const updateActiveWorkflow = useCallback((updater: (wf: WorkflowFile) => WorkflowFile, kind?: string | null) => {
    let targetId: string | undefined = activeWorkflowId;
    if (!targetId || !workflows.some((wf) => wf.id === targetId)) {
      const refId = materializedDraftId.current;
      targetId = refId && workflows.some((wf) => wf.id === refId) ? refId : undefined;
    }
    if (!targetId) {
      const draftId = `draft-${Date.now()}`;
      materializedDraftId.current = draftId;
      setActiveWorkflowId(draftId);
      const draft = {
        ...updater({ ...bootstrapWorkflow.current, folderId: processesRootId.current }),
        id: draftId,
      };
      setWorkflows((prev) => [draft, ...prev.filter((item) => !item.id.startsWith('draft-'))]);
      return;
    }
    const before = workflows.find((wf) => wf.id === targetId);
    if (before && kind !== null) recordHistory(targetId, before, updater(before), kind);
    setWorkflows((prev) => prev.map((wf) => (wf.id === targetId ? updater(wf) : wf)));
  }, [activeWorkflowId, workflows, recordHistory]);

  const stepHistory = useCallback((direction: 'undo' | 'redo') => {
    const target = workflows.find((wf) => wf.id === currentWorkflow.id);
    if (!target) return;
    const history = histories.current.get(target.id);
    if (!history) return;
    const step = direction === 'undo' ? undoEdit(history, target) : redoEdit(history, target);
    if (!step) return;
    histories.current.set(target.id, step.history);
    setHistoryVersion((value) => value + 1);
    setWorkflows((prev) => prev.map((wf) => (wf.id === target.id ? withContent(wf, step.content) : wf)));
  }, [workflows, currentWorkflow.id]);

  const undo = useCallback(() => stepHistory('undo'), [stepHistory]);
  const redo = useCallback(() => stepHistory('redo'), [stepHistory]);
  void historyVersion; // re-render when the history changes
  const activeHistory = histories.current.get(currentWorkflow.id);
  const canUndo = (activeHistory?.past.length ?? 0) > 0;
  const canRedo = (activeHistory?.future.length ?? 0) > 0;

  return {
    workflows,
    setWorkflows,
    activeWorkflowId,
    setActiveWorkflowId,
    currentWorkflow,
    projects,
    setProjects,
    activeProject,
    showProjects,
    setShowProjects,
    treeRefreshKey,
    setTreeRefreshKey,
    openProject,
    updateActiveWorkflow,
    recordHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    processesRootId,
    persistedProcessKeys,
    workspaceStatus,
    workspaceError,
    retryWorkspace: initializeWorkspace,
  };
}
