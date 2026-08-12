import { useState, useCallback } from 'react';
import { AuthoringAPI, AplGenerationCandidate } from '@/api/authoring';
import { Project } from '@/api/projects';
import { WorkflowFile, SimulationLog } from '@/types';
import { aplToWorkflow, parseAPLYaml, stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';

export interface AuthoringCandidate extends AplGenerationCandidate {
  workflow: WorkflowFile;
  replaceWorkflowId?: string;
}

export function useAplAuthoringState(
  activeProject: Project | undefined,
  currentWorkflow: WorkflowFile,
  setSimulationLogs: React.Dispatch<React.SetStateAction<SimulationLog[]>>,
  setDesignerMode: (mode: 'diagram' | 'apl') => void
) {
  const [authoringCandidate, setAuthoringCandidate] = useState<AuthoringCandidate | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const handleGenerateWorkflow = useCallback(async (promptText: string, mode: 'new' | 'refine' = 'new') => {
    if (!activeProject) {
      setSimulationLogs((logs) => [...logs, { id: `gen-${Date.now()}-project`,
        timestamp: new Date().toLocaleTimeString(), nodeId: 'system', nodeTitle: 'APL Authoring',
        nodeType: 'event', status: 'error', message: 'Open a project before generating APL.' }]);
      return;
    }
    setIsGenerating(true);
    const timestamp = () => new Date().toLocaleTimeString();

    setSimulationLogs(prev => [
      ...prev,
      {
        id: `gen-${Date.now()}-1`,
        timestamp: timestamp(),
        nodeId: 'system',
        nodeTitle: 'APL Authoring',
        nodeType: 'agent',
        status: 'info',
        message: `${mode === 'new' ? 'Creating' : 'Refining'} a native APL candidate for human review.`,
      }
    ]);

    try {
      const candidate = await AuthoringAPI.generate(activeProject.id, promptText, mode,
        mode === 'refine' ? stringifyAPLYaml(workflowToAPL(currentWorkflow)) : undefined);
      const parsed = aplToWorkflow(parseAPLYaml(candidate.aplSource));
      const replaceCurrent = mode === 'refine' || (!currentWorkflow.documentId && currentWorkflow.nodes.length === 0);
      const candidateWorkflow: WorkflowFile = replaceCurrent ? {
        ...parsed, id: currentWorkflow.id,
        documentId: currentWorkflow.documentId, revision: currentWorkflow.revision,
        version: currentWorkflow.version, updatedAt: currentWorkflow.updatedAt,
      } : { ...parsed, id: `draft-generated-${Date.now()}` };
      setAuthoringCandidate({ ...candidate, workflow: candidateWorkflow,
        replaceWorkflowId: replaceCurrent ? currentWorkflow.id : undefined });
      setDesignerMode('apl');

      setSimulationLogs(prev => [
        ...prev,
        {
          id: `gen-${Date.now()}-3`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Studio Compiler',
          nodeType: 'event',
          status: 'success',
          message: `${candidate.provider === 'LLM' ? 'LLM' : 'Local fallback'} produced validated APL in ${candidate.attempts} attempt(s). Review before applying.`,
        }
      ]);
    } catch (err: any) {
      setSimulationLogs(prev => [
        ...prev,
        {
          id: `gen-${Date.now()}-err`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Generation Error',
          nodeType: 'event',
          status: 'error',
          message: err.message,
        }
      ]);
    } finally {
      setIsGenerating(false);
    }
  }, [activeProject, currentWorkflow, setSimulationLogs, setDesignerMode]);

  return {
    authoringCandidate,
    setAuthoringCandidate,
    isGenerating,
    setIsGenerating,
    handleGenerateWorkflow
  };
}
