import { XMLBuilder } from 'fast-xml-parser';
import { APLDocument } from '../apl/types';

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
            '@_camunda:type': 'external',
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
            '@_camunda:type': 'external',
            '@_camunda:topic': node.service
          }
        };
      case 'approval-gate':
        return {
          'bpmn:userTask': {
            '@_id': node.id,
            '@_name': node.description || 'Human Approval',
            '@_camunda:candidateGroups': node.assignees.join(',')
          }
        };
      case 'condition':
        node.rules.forEach((rule, idx) => {
          sequenceFlows.push({
            '@_id': `Flow_${node.id}_${rule.then}`,
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
        return {
          'bpmn:exclusiveGateway': {
            '@_id': node.id,
            '@_name': node.description || 'Gateway'
          }
        };
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
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(root)}`;
}
