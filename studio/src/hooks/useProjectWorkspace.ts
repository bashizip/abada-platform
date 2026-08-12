import { useState, useRef, useEffect, useCallback } from 'react';
import { Project, ProjectAPI } from '@/api/projects';
import { WorkflowFile, LANGUAGE_VERSION_ABADA_IO_V1 } from '@/types';
import { workflowFingerprint } from '@/lib/run/workflowFingerprint';

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

  const persistedFingerprint = useRef(new Map<string, string>());
  const failedAutosaveFingerprint = useRef(new Map<string, string>());
  const persistedProcessKeys = useRef(new Map<string, string>());
  const creatingWorkflowIds = useRef(new Set<string>());
  const processesRootId = useRef<string | undefined>(undefined);
  const materializedDraftId = useRef<string | undefined>(undefined);

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

  useEffect(() => {
    if (!authenticated) return;
    ProjectAPI.list().then((available) => {
      setProjects(available);
      const remembered = localStorage.getItem('abada.studio.projectId');
      const selected = available.find((project) => project.id === remembered) || available[0];
      if (selected) void openProject(selected);
      else setShowProjects(true);
    }).catch(() => setShowProjects(true));
  }, [authenticated, openProject]);

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

  const updateActiveWorkflow = useCallback((updater: (wf: WorkflowFile) => WorkflowFile) => {
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
    setWorkflows((prev) => prev.map((wf) => (wf.id === targetId ? updater(wf) : wf)));
  }, [activeWorkflowId, workflows]);

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
    processesRootId,
    persistedProcessKeys,
  };
}
