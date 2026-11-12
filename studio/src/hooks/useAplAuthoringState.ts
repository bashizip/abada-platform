import { useState, useCallback } from 'react';
import { Project } from '@/api/projects';
import { WorkflowFile, SimulationLog } from '@/types';
import { playCue } from '@/lib/sound';

/** An open AI draft workspace (M5 S12): what it refines and how its result lands. */
export interface AuthoringWorkspaceRequest {
  key: string;
  prompt: string;
  /** The process the draft starts from and is compared with. */
  origin: WorkflowFile;
  /** Apply replaces the open process (`replaceWorkflowId`), or opens the draft as a new one. */
  target: 'replace' | 'new';
  replaceWorkflowId?: string;
}

/**
 * Opens the AI draft workspace from the natural-language bar. Model calls happen in the
 * workspace, through the authoring service; nothing reaches the canvas until the user applies.
 */
export function useAplAuthoringState(
  activeProject: Project | undefined,
  currentWorkflow: WorkflowFile,
  setSimulationLogs: React.Dispatch<React.SetStateAction<SimulationLog[]>>,
) {
  const [workspace, setWorkspace] = useState<AuthoringWorkspaceRequest | null>(null);
  /** Why a prompt could not open a draft, shown where it was typed. */
  const [authoringError, setAuthoringError] = useState<string | null>(null);

  const handleGenerateWorkflow = useCallback((promptText: string, mode: 'new' | 'refine' = 'new') => {
    if (!activeProject) {
      setAuthoringError('Open a project before drafting a process with AI.');
      setSimulationLogs((logs) => [...logs, { id: `gen-${Date.now()}-project`,
        timestamp: new Date().toLocaleTimeString(), nodeId: 'system', nodeTitle: 'APL Authoring',
        nodeType: 'event', status: 'error', message: 'Open a project before generating APL.' }]);
      return;
    }
    setAuthoringError(null);
    playCue('loading', { emphasis: 'subtle' });
    // An empty unsaved process is simply filled in; otherwise "New process" opens a new draft.
    const emptyDraft = !currentWorkflow.documentId && currentWorkflow.nodes.length === 0;
    const replace = (mode === 'refine' && currentWorkflow.nodes.length > 0) || emptyDraft;
    const origin: WorkflowFile = replace ? currentWorkflow : {
      ...currentWorkflow,
      id: `draft-generated-${Date.now()}`,
      name: 'New process',
      fileName: undefined,
      documentId: undefined,
      revision: undefined,
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      processKey: undefined,
      nodes: [],
      edges: [],
    };
    setWorkspace({ key: `workspace-${Date.now()}`, prompt: promptText, origin, target: replace ? 'replace' : 'new',
      replaceWorkflowId: replace ? currentWorkflow.id : undefined });
    setSimulationLogs((prev) => [...prev, {
      id: `gen-${Date.now()}-1`, timestamp: new Date().toLocaleTimeString(), nodeId: 'system', nodeTitle: 'APL Authoring',
      nodeType: 'agent', status: 'info',
      message: `${replace && currentWorkflow.nodes.length ? 'Refining' : 'Drafting'} a native APL candidate for human review.`,
    }]);
  }, [activeProject, currentWorkflow, setSimulationLogs]);

  return {
    workspace,
    closeWorkspace: useCallback(() => setWorkspace(null), []),
    authoringError,
    setAuthoringError,
    handleGenerateWorkflow,
  };
}
