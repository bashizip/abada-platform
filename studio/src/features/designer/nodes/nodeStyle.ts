import type { NodeType, WorkflowNode } from '@/types';

/** Accent colour per node type (the Studio palette). */
export const NODE_ACCENT: Record<NodeType, string> = {
  agent: '#9D4EDD',
  human: '#E76F51',
  dmn: '#2A9D8F',
  'engine-task': '#90A955',
  'call-process': '#F4A261',
  script: '#2A9D8F',
  gateway: '#F4A261',
  event: '#F4A261',
};

/** Start events read green, end events red, everything in between saffron. */
export function eventAccent(subtype: WorkflowNode['subtype']): string {
  if (subtype === 'start') return '#90A955';
  if (subtype === 'end') return '#E76F51';
  return '#F4A261';
}

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  agent: 'Agent',
  human: 'Human task',
  dmn: 'Decision table',
  'engine-task': 'Engine task',
  'call-process': 'Call process',
  script: 'Script',
  gateway: 'Gateway',
  event: 'Event',
};

/** The one line of configuration worth seeing on the diagram. */
export function taskFact(node: WorkflowNode): string {
  switch (node.type) {
    case 'agent': {
      const model = node.agentConfig?.model ?? '';
      const threshold = node.agentConfig?.confidenceThreshold;
      return [model, threshold ? `≥ ${threshold}% confidence` : ''].filter(Boolean).join(' · ');
    }
    case 'human': {
      const assignees = node.humanConfig?.assignees?.filter(Boolean) ?? [];
      if (assignees.length) return assignees.join(', ');
      return node.humanConfig?.slaHours ? `SLA ${node.humanConfig.slaHours}h` : '';
    }
    case 'dmn': {
      const rules = node.dmnConfig?.rules?.length ?? 0;
      return node.dmnConfig ? `${rules} rule${rules === 1 ? '' : 's'} · ${node.dmnConfig.hitPolicy}` : '';
    }
    case 'engine-task':
      return node.engineTaskConfig?.service ?? '';
    case 'call-process':
      return node.callProcessConfig?.process ? `calls ${node.callProcessConfig.process}` : '';
    case 'script':
      return node.scriptConfig?.script?.split('\n').find((line) => line.trim())?.trim() ?? '';
    default:
      return '';
  }
}
