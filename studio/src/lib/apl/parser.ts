import * as yaml from 'yaml';
import dagre from 'dagre';
import {
  APLDocument,
  APLDecisionTableInput,
  APLDecisionTableNode,
  APLDecisionTableRule,
  APLNode,
  APLValue,
} from './types';
import { WorkflowFile, WorkflowNode, WorkflowEdge, DMNConfig } from '@/types';

/**
 * Parses an APL YAML string into an APLDocument object.
 */
export function parseAPLYaml(yamlString: string): APLDocument {
  return yaml.parse(yamlString) as APLDocument;
}

/**
 * Stringifies an APLDocument object into a YAML string.
 *
 * Decision-table blocks are emitted in the vision's canonical YAML shape:
 * `inputs` as a map (`score: "${...}"`) and the fallback rule wrapped as
 * `otherwise: { then: {...} }`, so AI-generated rule PRs use one stable form.
 */
export function stringifyAPLYaml(doc: APLDocument): string {
  const visionDoc: APLDocument = {
    ...doc,
    flow: {
      ...doc.flow,
      nodes: doc.flow.nodes.map((node) => {
        if (node.type !== 'decision-table') return node;
        const table = node as APLDecisionTableNode;
        const inputs = Array.isArray(table.inputs)
          ? table.inputs
          : Object.entries(table.inputs || {}).map(([name, expr]) => ({ name, expr }));
        return {
          ...node,
          inputs: Object.fromEntries(inputs.map((i) => [i.name, i.expr || ''])),
          rules: (table.rules || []).map((r) =>
            r.otherwise ? { otherwise: { then: r.then } } : { when: r.when, then: r.then }
          ),
        } as APLNode;
      }),
    },
  };
  return yaml.stringify(visionDoc);
}

/** Normalizes the array or map form of decision-table inputs. */
export const normalizeTableInputs = (
  inputs?: APLDecisionTableInput[] | Record<string, string>
): APLDecisionTableInput[] =>
  Array.isArray(inputs)
    ? inputs
    : Object.entries(inputs || {}).map(([name, expr]) => ({ name, expr: String(expr) }));

/** Resolves the flattened and vision-wrapper forms of an `otherwise` rule. */
export const resolveRuleOutcome = (rule: APLDecisionTableRule): {
  otherwise: boolean;
  when?: string;
  then: Record<string, APLValue>;
} => {
  const wrapped = rule.otherwise && typeof rule.otherwise === 'object'
    ? rule.otherwise
    : null;
  return {
    otherwise: wrapped ? true : !!rule.otherwise,
    when: wrapped ? undefined : rule.when,
    then: wrapped ? wrapped.then : (rule.then || {}),
  };
};

/** Coerces a string raw value to its declared output type in canonical APL. */
export const coerceAPLValue = (
  type: 'string' | 'number' | 'boolean',
  raw: APLValue
): APLValue => {
  if (type === 'boolean') {
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    return Boolean(raw);
  }
  if (type === 'number') {
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? raw : parsed;
  }
  return String(raw);
};

/** Coerces a canvas `then` map so values respect the declared output types. */
export const coerceRuleOutputs = (
  outputs: { name: string; type: string }[],
  thenValue: Record<string, APLValue>
): Record<string, APLValue> => {
  const coerced: Record<string, APLValue> = {};
  for (const [name, value] of Object.entries(thenValue)) {
    const declared = outputs.find((o) => o.name === name);
    if (declared && (declared.type === 'NUMBER' || declared.type === 'BOOLEAN')) {
      coerced[name] = coerceAPLValue(declared.type.toLowerCase() as 'number' | 'boolean', value);
    } else {
      coerced[name] = value;
    }
  }
  return coerced;
};

/** Converts a canvas DMNConfig into a canonical APL decision-table node. */
export const dmnConfigToAPLNode = (config: DMNConfig, nodeId: string): APLDecisionTableNode => ({
  id: nodeId,
  type: 'decision-table',
  decisionKey: config.decisionKey,
  hitPolicy: config.hitPolicy,
  inputs: config.inputs.map((i) => ({ name: i.name, expr: i.expr })),
  rules: config.rules.map((rule) =>
    rule.otherwise
      ? { otherwise: { then: coerceRuleOutputs(config.outputs, rule.then) } }
      : { when: rule.when, then: coerceRuleOutputs(config.outputs, rule.then) }
  ),
});

/** Canonical YAML for a single decision-table node — the shape AI rule PRs use. */
export const stringifyDecisionTableYaml = (config: DMNConfig, nodeId: string): string =>
  yaml.stringify(dmnConfigToAPLNode(config, nodeId));

/** Parses a canonical decision-table YAML block back into a DMNConfig. */
export const parseDecisionTableYaml = (node: any): DMNConfig => {
  const table = node as APLDecisionTableNode;
  return {
    decisionKey: table.decisionKey || `DMN_${(table.id || 'TABLE').toUpperCase()}`,
    hitPolicy: table.hitPolicy || 'FIRST',
    inputs: normalizeTableInputs(table.inputs).map((i) => ({ name: i.name, expr: i.expr })),
    outputs: [],
    rules: (table.rules || []).map((r, i) => ({ id: `r${i}`, ...resolveRuleOutcome(r) })),
  };
};

/**
 * Applies Dagre auto-layout to nodes that don't have x,y coordinates
 */
const applyAutoLayout = (nodes: WorkflowNode[], edges: WorkflowEdge[]) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', align: 'UL', ranksep: 100, nodesep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    // React Flow visual size roughly 200x120
    g.setNode(node.id, { width: 220, height: 120 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const n = g.node(node.id);
    // Only apply layout if node doesn't have an explicit UI coordinate or if it's 0,0
    if (node.x === 0 && node.y === 0) {
      return { ...node, x: n.x - 110, y: n.y - 60 };
    }
    return node;
  });
};

/** Maps a native APL decision-table block into the studio's DMNConfig model. */
const tableToDmnConfig = (table: APLDecisionTableNode) => ({
  decisionKey: table.decisionKey || `DMN_${table.id.toUpperCase()}`,
  hitPolicy: table.hitPolicy || 'FIRST',
  inputs: normalizeTableInputs(table.inputs).map((i) => ({ name: i.name, expr: i.expr })),
  outputs: [],
  rules: (table.rules || []).map((r, i) => ({
    id: `r${i}`,
    ...resolveRuleOutcome(r),
  })),
});

/**
 * Converts an APLDocument into the internal React Flow WorkflowFile model.
 */
export function aplToWorkflow(apl: APLDocument): WorkflowFile {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  apl.flow.nodes.forEach((aplNode) => {
    const wNode: WorkflowNode = {
      id: aplNode.id,
      type: 'agent',
      title: aplNode.id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: aplNode.description || '',
      x: aplNode.ui?.x || 0,
      y: aplNode.ui?.y || 0,
    };

    switch (aplNode.type) {
      case 'webhook':
        wNode.type = 'event';
        wNode.subtype = 'start';
        break;
      case 'end':
        wNode.type = 'event';
        wNode.subtype = 'end';
        break;
      case 'agent':
        wNode.type = 'agent';
        wNode.agentConfig = {
          profileVersion: aplNode.profile || 'abada.agent/v1',
          model: aplNode.model || 'gemini-3.6-flash',
          systemPrompt: aplNode.prompt || '',
          confidenceThreshold: aplNode.confidence_threshold || 85,
          temperature: aplNode.temperature ?? 0.2,
          tools: aplNode.tools || [],
          inputs: aplNode.inputs,
          resultVariable: aplNode.result_variable,
          outputSchema: aplNode.output_schema,
          maxTokens: aplNode.max_tokens,
          timeoutMs: aplNode.timeout_ms,
          maxAttempts: aplNode.max_attempts,
          retryBackoffMs: aplNode.retry_backoff_ms,
        };
        break;
      case 'engine-task':
        wNode.type = 'agent'; // Visual fallback
        wNode.agentConfig = {
          model: 'system-service',
          systemPrompt: `Execute Engine Service: ${aplNode.service}`,
          confidenceThreshold: 100,
          temperature: 0,
          tools: [aplNode.service],
        };
        break;
      case 'approval-gate':
        wNode.type = 'human';
        wNode.humanConfig = {
          assigneeRole: aplNode.assignees?.join(', ') || 'Reviewer',
          slaHours: aplNode.sla_hours || 24,
          formFields: [],
          requireDoubleSignOff: aplNode.mode === 'parallel' && (aplNode.assignees?.length || 0) > 1,
        };
        break;
      case 'condition':
        wNode.type = 'gateway';
        wNode.subtype = 'exclusive';
        wNode.dmnConfig = {
          decisionKey: `RULE_${aplNode.id.toUpperCase()}`,
          hitPolicy: 'FIRST',
          inputs: [],
          outputs: [],
          rules: aplNode.rules.map((r, i) => ({
            id: `r${i}`,
            when: r.if,
            otherwise: !!r.else,
            then: { Next: r.then },
          })),
        };
        break;
      case 'decision-table': {
        const table = aplNode as APLDecisionTableNode;
        wNode.type = 'dmn';
        wNode.dmnConfig = tableToDmnConfig(table);
        break;
      }
      default: {
        // Legacy APL documents (pre-decision-table blocks) used type 'dmn'.
        const legacy = aplNode as unknown as { type?: string };
        if (legacy.type === 'dmn') {
          wNode.type = 'dmn';
          wNode.dmnConfig = tableToDmnConfig(aplNode as unknown as APLDecisionTableNode);
        }
        break;
      }
    }

    nodes.push(wNode);

    // Build edges
    if (aplNode.type === 'condition') {
      aplNode.rules.forEach((r) => {
        edges.push({
          id: `e_${aplNode.id}_${r.then}`,
          source: aplNode.id,
          target: r.then,
          label: r.if ? `if ${r.if}` : 'else',
        });
      });
    } else if (aplNode.next) {
      edges.push({
        id: `e_${aplNode.id}_${aplNode.next}`,
        source: aplNode.id,
        target: aplNode.next,
      });
    } else if (aplNode.type === 'engine-task' && aplNode.on_error) {
      edges.push({
        id: `e_${aplNode.id}_${aplNode.on_error}_error`,
        source: aplNode.id,
        target: aplNode.on_error,
        label: 'on_error',
      });
    }
  });

  const layoutedNodes = applyAutoLayout(nodes, edges);

  return {
    id: `wf-${Date.now()}`,
    name: apl.metadata.name,
    category: (apl.metadata.category || 'custom') as any,
    fileType: 'apl',
    languageVersion: apl.version,
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    nodes: layoutedNodes,
    edges,
  };
}

/**
 * Converts internal React Flow WorkflowFile model into an APLDocument.
 */
export function workflowToAPL(wf: WorkflowFile): APLDocument {
  const aplNodes: APLNode[] = [];

  // Real gateway conditions must be expressions the engine can evaluate
  // (e.g. `${fraudScore > 75}`). Free-text edge labels are descriptions and
  // must never be emitted as condition expressions.
  const toCondition = (label?: string, condition?: string): string | undefined => {
    const raw = label?.replace(/^if\s+/i, '').trim();
    if (condition) return condition;
    if (raw && /^\$\{.*\}$/.test(raw)) return raw;
    return undefined;
  };

  // Helper to find outgoing edge target for non-gateway nodes
  const getNextNode = (nodeId: string, sourceType: WorkflowNode['type']): string | undefined => {
    if (sourceType === 'gateway') return undefined; // gateways route via rules
    const outEdges = wf.edges.filter(e => e.source === nodeId);
    return outEdges.length > 0 ? outEdges[0].target : undefined;
  };

  wf.nodes.forEach(node => {
    const baseNode = {
      id: node.id,
      description: node.description || undefined,
      ui: { x: Math.round(node.x), y: Math.round(node.y) },
    };

    if (node.type === 'event') {
      if (node.subtype === 'start') {
        aplNodes.push({
          ...baseNode,
          type: 'webhook',
          next: getNextNode(node.id, node.type),
        } as APLNode);
      } else {
        aplNodes.push({
          ...baseNode,
          type: 'end',
        } as APLNode);
      }
    } else if (node.type === 'agent') {
      aplNodes.push({
        ...baseNode,
        type: 'agent',
        profile: node.agentConfig?.profileVersion || 'abada.agent/v1',
        model: node.agentConfig?.model,
        prompt: node.agentConfig?.systemPrompt,
        inputs: node.agentConfig?.inputs,
        result_variable: node.agentConfig?.resultVariable,
        output_schema: node.agentConfig?.outputSchema,
        tools: node.agentConfig?.tools?.length ? node.agentConfig.tools : undefined,
        confidence_threshold: node.agentConfig?.confidenceThreshold,
        temperature: node.agentConfig?.temperature,
        max_tokens: node.agentConfig?.maxTokens,
        timeout_ms: node.agentConfig?.timeoutMs,
        max_attempts: node.agentConfig?.maxAttempts,
        retry_backoff_ms: node.agentConfig?.retryBackoffMs,
        next: getNextNode(node.id, node.type),
      } as APLNode);
    } else if (node.type === 'human') {
      aplNodes.push({
        ...baseNode,
        type: 'approval-gate',
        assignees: node.humanConfig?.assigneeRole.split(',').map(s => s.trim()) || [],
        mode: node.humanConfig?.requireDoubleSignOff ? 'parallel' : 'serial',
        sla_hours: node.humanConfig?.slaHours,
        next: getNextNode(node.id, node.type),
      } as APLNode);
    } else if (node.type === 'gateway') {
      const outEdges = wf.edges.filter(e => e.source === node.id);
      aplNodes.push({
        ...baseNode,
        type: 'condition',
        rules: outEdges.map((e, idx) => {
          const cond = toCondition(e.label, e.condition);
          const isElse = !cond && (e.label?.toLowerCase().includes('else') || idx === outEdges.length - 1);
          return {
            if: cond,
            else: isElse ? e.target : undefined,
            then: e.target,
          };
        })
      } as APLNode);
    } else if (node.type === 'dmn') {
      // Native decision-table block: the deterministic "law" that constrains the
      // probabilistic agents (vision: the engine executes it, not the LLM).
      aplNodes.push({
        ...baseNode,
        type: 'decision-table',
        decisionKey: node.dmnConfig?.decisionKey,
        hitPolicy: node.dmnConfig?.hitPolicy,
        inputs: node.dmnConfig?.inputs?.length
          ? node.dmnConfig.inputs.map((i) => ({ name: i.name, expr: i.expr }))
          : undefined,
        rules: node.dmnConfig?.rules?.length
          ? node.dmnConfig.rules.map((r) => ({
              when: r.when,
              otherwise: r.otherwise,
              then: r.then,
            }))
          : undefined,
        next: getNextNode(node.id, node.type),
      } as APLNode);
    }
  });

  const entryNode = wf.nodes.find(n => n.type === 'event' && n.subtype === 'start') || wf.nodes[0];

  return {
    version: 'abada.io/v1',
    metadata: {
      name: wf.name,
      owner: 'studio-user',
      category: wf.category,
    },
    flow: {
      entry: entryNode ? entryNode.id : '',
      nodes: aplNodes,
    }
  };
}
