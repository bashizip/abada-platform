import { XMLBuilder } from 'fast-xml-parser';
import { APLDocument, APLDecisionTableNode, APLValue } from '../apl/types';
import { normalizeTableInputs, resolveRuleOutcome } from '../apl/parser';

/** Renders a typed output value as the string the engine coerces back. */
const renderValue = (value: APLValue): string => {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
};

/**
 * Compiles APL YAML back down into strict executable BPMN 2.0 XML
 * for the Abada Engine.
 */
export function compileAPLToBPMN(apl: APLDocument): string {
  const processId = apl.metadata.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || `process_${Date.now()}`;
  
  const processObj: any = {
    '@_id': processId,
    '@_name': apl.metadata.name,
    '@_isExecutable': 'true',
  };

  const sequenceFlows: any[] = [];
  
  const elements = apl.flow.nodes.map(node => {
    if (node.next) {
      sequenceFlows.push({
        '@_id': `Flow_${node.id}_${node.next}`,
        '@_sourceRef': node.id,
        '@_targetRef': node.next,
      });
    }

    switch (node.type) {
      case 'webhook':
        return {
          'bpmn:startEvent': {
            '@_id': node.id,
            '@_name': node.description || 'Start',
            'bpmn:outgoing': `Flow_${node.id}_${node.next}`
          }
        };
      case 'end':
        return {
          'bpmn:endEvent': {
            '@_id': node.id,
            '@_name': node.description || 'End',
            'bpmn:incoming': [] // Filled later if needed
          }
        };
      case 'agent':
        return {
          'bpmn:serviceTask': {
            '@_id': node.id,
            '@_name': node.description || 'AI Agent',
            '@_camunda:topic': 'abada:agent',
            'bpmn:extensionElements': {
              'camunda:properties': {
                'camunda:property': [
                  { '@_name': 'model', '@_value': node.model || 'gemini-3.6-flash' },
                  { '@_name': 'prompt', '@_value': node.prompt || '' },
                  { '@_name': 'confidence_threshold', '@_value': (node.confidence_threshold || 85).toString() }
                ]
              }
            }
          }
        };
      case 'engine-task':
        return {
          'bpmn:serviceTask': {
            '@_id': node.id,
            '@_name': node.description || 'Engine Task',
            '@_camunda:topic': node.service
          }
        };
      case 'decision-table': {
        // Native deterministic decision table: the engine validates and executes
        // abada:decisionTable inside the workflow transaction (the table is the
        // law, agents are the advice).
        const table = node as APLDecisionTableNode;
        const inputs = normalizeTableInputs(table.inputs);
        const rules = (table.rules || []).map(resolveRuleOutcome);
        return {
          'bpmn:businessRuleTask': {
            '@_id': node.id,
            '@_name': node.description || 'Decision Table',
            'bpmn:extensionElements': {
              'abada:decisionTable': {
                '@_decisionKey': table.decisionKey || `DMN_${node.id.toUpperCase()}`,
                '@_hitPolicy': table.hitPolicy || 'FIRST',
                'abada:input': inputs.map((input) => ({
                  '@_name': input.name,
                  ...(input.expr ? { '@_expr': input.expr } : {})
                })),
                'abada:rule': rules.map((rule) => ({
                  ...(rule.otherwise ? { '@_otherwise': 'true' } : {}),
                  ...(rule.when ? { '@_when': rule.when } : {}),
                  'abada:output': Object.entries(rule.then).map(([name, value]) => ({
                    '@_name': name,
                    '@_value': renderValue(value)
                  }))
                }))
              }
            }
          }
        };
      }
      case 'approval-gate':
        return {
          'bpmn:userTask': {
            '@_id': node.id,
            '@_name': node.description || 'Human Approval',
            '@_camunda:candidateGroups': node.assignees.join(',')
          }
        };
      case 'condition': {
        // The engine requires exactly one reachable path per exclusive gateway:
        // conditional flows evaluate first, the 'else' flow is the gateway default.
        const flowIds: string[] = [];
        const usedFlowIds = new Set<string>();
        node.rules.forEach((rule, idx) => {
          // Guard against duplicate targets producing duplicate flow ids.
          const base = `Flow_${node.id}_${rule.then}`;
          let flowId = base;
          let suffix = 1;
          while (usedFlowIds.has(flowId)) flowId = `${base}_${suffix++}`;
          usedFlowIds.add(flowId);
          flowIds.push(flowId);
          sequenceFlows.push({
            '@_id': flowId,
            '@_sourceRef': node.id,
            '@_targetRef': rule.then,
            ...(rule.if ? {
              'bpmn:conditionExpression': {
                '@_xsi:type': 'bpmn:tFormalExpression',
                '#text': rule.if
              }
            } : {})
          });
        });
        // Prefer an explicit 'else' rule, otherwise the last flow becomes default.
        const elseRule = node.rules.find((rule) => rule.else) || node.rules[node.rules.length - 1];
        const defaultFlowId = elseRule ? flowIds[node.rules.indexOf(elseRule)] : undefined;
        return {
          'bpmn:exclusiveGateway': {
            '@_id': node.id,
            '@_name': node.description || 'Gateway',
            ...(defaultFlowId ? { '@_default': defaultFlowId } : {})
          }
        };
      }
      case 'parallel': {
        // Parallel gateway: a fork emits one unconditional flow per branch; a
        // join needs no outgoing flow configuration beyond `next`.
        (node.branches || []).forEach((branch) => {
          sequenceFlows.push({
            '@_id': `Flow_${node.id}_${branch}`,
            '@_sourceRef': node.id,
            '@_targetRef': branch,
          });
        });
        return {
          'bpmn:parallelGateway': {
            '@_id': node.id,
            '@_name': node.description || 'Parallel Gateway',
          }
        };
      }
      default:
        return {};
    }
  });

  const mergedElements: any = {};
  elements.forEach((el: any) => {
    const key = Object.keys(el)[0];
    if (!key) return;
    if (!mergedElements[key]) mergedElements[key] = [];
    mergedElements[key].push(el[key]);
  });

  const root = {
    'bpmn:definitions': {
      '@_xmlns:bpmn': 'http://www.omg.org/spec/BPMN/20100524/MODEL',
      '@_xmlns:camunda': 'http://camunda.org/schema/1.0/bpmn',
      '@_xmlns:abada': 'https://abada.io/schema/bpmn',
      '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@_id': 'Definitions_1',
      '@_targetNamespace': 'http://bpmn.io/schema/bpmn',
      'bpmn:process': {
        ...processObj,
        ...mergedElements,
        'bpmn:sequenceFlow': sequenceFlows
      }
    }
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    // Render boolean attribute values explicitly (isExecutable="true");
    // the default (bare `isExecutable`) is not well-formed XML.
    suppressBooleanAttributes: false,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(root)}`;
}
