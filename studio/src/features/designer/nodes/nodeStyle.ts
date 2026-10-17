import type { NodeType, WorkflowNode } from '@/types';
import { palette } from '@/lib/tokens';

/** Accent colour per node type (the Studio palette). */
export const NODE_ACCENT: Record<NodeType, string> = {
  agent: palette.amethyst,
  human: palette.desertRose,
  dmn: palette.mineralTeal,
  'engine-task': palette.sageGreen,
  'call-process': palette.saffron,
  script: palette.mineralTeal,
  gateway: palette.saffron,
  event: palette.saffron,
};

/** Start events read green, end events red, everything in between saffron. */
export function eventAccent(subtype: WorkflowNode['subtype']): string {
  if (subtype === 'start') return palette.sageGreen;
  if (subtype === 'end') return palette.desertRose;
  return palette.saffron;
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
