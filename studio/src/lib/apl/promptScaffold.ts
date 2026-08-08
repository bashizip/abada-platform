import { LANGUAGE_VERSION_ABADA_IO_V1, WorkflowFile, WorkflowNode } from '@/types';

const slugify = (value: string): string => {
  const slug = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 72);
  return slug && /^[a-z]/.test(slug) ? slug : `process_${slug || Date.now()}`;
};

/**
 * Deterministic APL-native fallback used when the configured AI generator is
 * unavailable. It always gives the user an editable, executable starting
 * graph instead of turning a provider outage into a dead creation path.
 */
export const createPromptWorkflow = (prompt: string): WorkflowFile => {
  const normalized = prompt.toLowerCase();
  const processKey = slugify(prompt);
  const nodes: WorkflowNode[] = [
    {
      id: 'start', type: 'event', subtype: 'start', title: 'Start Process',
      description: 'Receives the initial process payload.', x: 80, y: 220,
    },
    {
      id: 'agent', type: 'agent', title: 'AI Process Agent', description: prompt,
      x: 340, y: 220,
      agentConfig: {
        profileVersion: 'abada.agent/v1', model: 'openai-compatible',
        systemPrompt: prompt, confidenceThreshold: 85, temperature: 0.2, tools: [],
      },
    },
  ];

  if (/rule|policy|decision|risk|tax|compliance|fraud|score/.test(normalized)) {
    nodes.push({
      id: 'decision', type: 'dmn', title: 'Deterministic Policy',
      description: 'Applies the deterministic business rules for this process.', x: 600, y: 220,
      dmnConfig: {
        decisionKey: `${processKey.toUpperCase()}_POLICY`, hitPolicy: 'FIRST', inputs: [], outputs: [],
        rules: [{ id: 'fallback', otherwise: true, then: { outcome: 'REVIEW' } }],
      },
    });
  }

  if (/human|manual|approval|review|sign.?off|validate|validation/.test(normalized)) {
    nodes.push({
      id: 'approval', type: 'human', title: 'Human Approval',
      description: 'A human validates the proposed outcome.', x: 860, y: 220,
      humanConfig: { assigneeRole: 'Project Reviewer', slaHours: 24, formFields: ['Decision', 'Comment'] },
    });
  }

  nodes.push({
    id: 'end', type: 'event', subtype: 'end', title: 'Process Complete',
    description: 'Records the terminal outcome.', x: 1120, y: 220,
  });

  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `e-${node.id}-${nodes[index + 1].id}`,
    source: node.id,
    target: nodes[index + 1].id,
    label: 'Next',
  }));

  return {
    id: `wf-prompt-${Date.now()}`,
    name: prompt.trim().slice(0, 56) || 'AI Generated Process',
    processKey,
    description: prompt.trim(),
    category: 'custom',
    fileType: 'apl',
    languageVersion: LANGUAGE_VERSION_ABADA_IO_V1,
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
  };
};
