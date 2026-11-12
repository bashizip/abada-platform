import type { EventSubtype, GatewaySubtype, NodeType, WorkflowNode } from '@/types';
import { getDefaultAgentModel } from '@/lib/agentModels';
import { NODE_ACCENT, eventAccent } from './nodeStyle';

/**
 * The node vocabulary Studio offers: one entry per thing a user can place on
 * the canvas. The palette, the canvas and the properties panel all read it, so
 * a node is named, coloured and drawn the same way everywhere.
 */
export type NodeKind =
  | 'start' | 'end' | 'message' | 'timer' | 'signal'
  | 'agent' | 'human-input' | 'engine-task' | 'script'
  | 'decision-table' | 'exclusive' | 'parallel' | 'inclusive' | 'event-gateway'
  | 'call-process' | 'for-each';

export type NodeKindGroup = 'Events' | 'Work' | 'Decisions & routing' | 'Subprocesses';

export interface NodeKindSpec {
  kind: NodeKind;
  type: NodeType;
  subtype?: EventSubtype | GatewaySubtype;
  /** The name a user reads: palette entry, panel header, tooltips. */
  label: string;
  /** What it does, in one line. */
  description: string;
  group: NodeKindGroup;
  /** The APL block it is saved as. */
  aplType: string;
  /** Extra words the palette search matches. */
  keywords: string;
}

export const NODE_KINDS: readonly NodeKindSpec[] = [
  { kind: 'start', type: 'event', subtype: 'start', label: 'Start', group: 'Events', aplType: 'webhook',
    description: 'Where an instance begins, when the process is started', keywords: 'webhook trigger begin entry' },
  { kind: 'end', type: 'event', subtype: 'end', label: 'End', group: 'Events', aplType: 'end',
    description: 'Where a path finishes', keywords: 'finish complete terminate stop' },
  { kind: 'message', type: 'event', subtype: 'message', label: 'Wait for a message', group: 'Events',
    aplType: 'message-catch', description: 'Pauses until a message with this name is correlated',
    keywords: 'message catch correlate receive' },
  { kind: 'timer', type: 'event', subtype: 'timer', label: 'Wait for a time', group: 'Events', aplType: 'timer',
    description: 'Pauses for a duration, then continues', keywords: 'timer delay duration sleep wait' },
  { kind: 'signal', type: 'event', subtype: 'signal', label: 'Wait for a signal', group: 'Events', aplType: 'signal',
    description: 'Pauses until a broadcast signal arrives', keywords: 'signal broadcast catch' },
  { kind: 'agent', type: 'agent', label: 'Agent', group: 'Work', aplType: 'agent',
    description: 'A model advises under an output contract the engine enforces', keywords: 'ai llm model agent' },
  { kind: 'human-input', type: 'human', label: 'Human task', group: 'Work', aplType: 'human-input',
    description: 'A person reviews, decides or fills a form', keywords: 'human user task review approval form' },
  { kind: 'engine-task', type: 'engine-task', label: 'Engine task', group: 'Work', aplType: 'engine-task',
    description: 'Durable external work a worker picks up by topic', keywords: 'service worker external job topic' },
  { kind: 'script', type: 'script', label: 'Script', group: 'Work', aplType: 'script',
    description: 'A short in-transaction script (operator-enabled)', keywords: 'script javascript code' },
  { kind: 'decision-table', type: 'dmn', label: 'Decision table', group: 'Decisions & routing',
    aplType: 'decision-table', description: 'Deterministic rules decide outputs from inputs',
    keywords: 'dmn rules policy decision table' },
  { kind: 'exclusive', type: 'gateway', subtype: 'exclusive', label: 'Exclusive gateway', group: 'Decisions & routing',
    aplType: 'condition', description: 'Takes the first branch whose condition holds', keywords: 'condition if else branch xor' },
  { kind: 'parallel', type: 'gateway', subtype: 'parallel', label: 'Parallel gateway', group: 'Decisions & routing',
    aplType: 'parallel', description: 'Runs every branch at once, then waits for all', keywords: 'fork join and concurrent' },
  { kind: 'inclusive', type: 'gateway', subtype: 'inclusive', label: 'Inclusive gateway', group: 'Decisions & routing',
    aplType: 'inclusive', description: 'Runs every branch whose condition holds', keywords: 'or fork join conditions' },
  { kind: 'event-gateway', type: 'gateway', subtype: 'event', label: 'Event gateway', group: 'Decisions & routing',
    aplType: 'event-gateway', description: 'Waits for competing events; the first one wins', keywords: 'race event first' },
  { kind: 'call-process', type: 'call-process', label: 'Call process', group: 'Subprocesses', aplType: 'call-process',
    description: 'Runs another process as a governed child', keywords: 'subprocess child call' },
  { kind: 'for-each', type: 'call-process', label: 'For each', group: 'Subprocesses', aplType: 'for-each',
    description: 'Runs a child process once per item of a list', keywords: 'loop list items multi instance map' },
];

const BY_KIND = new Map(NODE_KINDS.map((spec) => [spec.kind, spec]));

export const kindSpec = (kind: NodeKind): NodeKindSpec => BY_KIND.get(kind)!;

/** The catalog entry a canvas node is an instance of. */
export function kindOf(node: Pick<WorkflowNode, 'type' | 'subtype' | 'callProcessConfig'>): NodeKind {
  switch (node.type) {
    case 'event':
      return (node.subtype as EventSubtype | undefined) ?? 'start';
    case 'gateway':
      return node.subtype === 'event' ? 'event-gateway'
        : node.subtype === 'parallel' || node.subtype === 'inclusive' ? node.subtype : 'exclusive';
    case 'human':
      return 'human-input';
    case 'dmn':
      return 'decision-table';
    case 'call-process':
      return node.callProcessConfig?.forEach ? 'for-each' : 'call-process';
    default:
      return node.type;
  }
}

/** The accent colour of a kind; events read green at the start and red at the end. */
export function kindAccent(kind: NodeKind): string {
  const spec = kindSpec(kind);
  return spec.type === 'event' ? eventAccent(spec.subtype) : NODE_ACCENT[spec.type];
}

export const PALETTE_GROUPS: readonly NodeKindGroup[] = ['Events', 'Work', 'Decisions & routing', 'Subprocesses'];

/** The drag-and-drop payload type of a palette entry. */
export const NODE_KIND_MIME = 'application/x-abada-node-kind';

export const isNodeKind = (value: string): value is NodeKind => BY_KIND.has(value as NodeKind);

/** Default title for a new node of this kind. */
const DEFAULT_TITLE: Record<NodeKind, string> = {
  start: 'Start', end: 'End', message: 'Wait for message', timer: 'Wait', signal: 'Wait for signal',
  agent: 'Agent', 'human-input': 'Review', 'engine-task': 'Engine task', script: 'Script',
  'decision-table': 'Decision', exclusive: 'Decide', parallel: 'In parallel', inclusive: 'Any of',
  'event-gateway': 'First event', 'call-process': 'Call process', 'for-each': 'For each',
};

/**
 * A new node of `kind`, with the smallest configuration that reads correctly:
 * required values left empty for the user (the engine names what is missing).
 */
export function createNode(kind: NodeKind, id: string, position: { x: number; y: number }): WorkflowNode {
  const spec = kindSpec(kind);
  const node: WorkflowNode = {
    id,
    type: spec.type,
    subtype: spec.subtype,
    title: DEFAULT_TITLE[kind],
    description: '',
    x: position.x,
    y: position.y,
  };
  switch (kind) {
    case 'message':
    case 'timer':
    case 'signal':
      node.catchEventConfig = { definitionRef: kind === 'timer' ? 'PT1H' : '' };
      break;
    case 'agent':
      node.agentConfig = { model: getDefaultAgentModel(), systemPrompt: '', confidenceThreshold: 0, temperature: 0.2, tools: [] };
      break;
    case 'human-input':
      node.humanConfig = { assignees: [], formFields: [] };
      break;
    case 'engine-task':
      node.engineTaskConfig = { service: '' };
      break;
    case 'script':
      node.scriptConfig = { script: '', format: 'javascript' };
      break;
    case 'decision-table':
      node.dmnConfig = {
        decisionKey: `${id.replace(/[^A-Za-z0-9_]/g, '_')}`,
        hitPolicy: 'FIRST',
        inputs: [{ name: 'amount', expr: '${amount}' }],
        outputs: [],
        rules: [
          { id: 'r1', when: 'amount > 1000', then: { approved: false } },
          { id: 'r2', otherwise: true, then: { approved: true } },
        ],
      };
      break;
    case 'call-process':
      node.callProcessConfig = { process: '', outputs: {} };
      break;
    case 'for-each':
      node.callProcessConfig = {
        process: '', outputs: {},
        forEach: { items: '', itemInput: 'item', maxItems: 100, results: 'results' },
      };
      break;
    default:
      break;
  }
  return node;
}
