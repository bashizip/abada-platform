import { XMLParser } from 'fast-xml-parser';
import { APLDocument, APLNode } from '../apl/types';

/**
 * Parses legacy BPMN 2.0 XML and transpiles it into Abada Process Language (APL).
 */
export function transpileBPMNToAPL(xmlString: string): APLDocument {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => {
      const arrayTags = ['bpmn:sequenceFlow', 'bpmn:task', 'bpmn:serviceTask', 'bpmn:userTask', 'bpmn:exclusiveGateway', 'bpmn:businessRuleTask', 'bpmn:startEvent', 'bpmn:endEvent'];
      return arrayTags.includes(name);
    }
  });

  const parsed = parser.parse(xmlString);
  const root = parsed['bpmn:definitions'] || parsed['definitions'];
  if (!root) throw new Error('Invalid BPMN XML: Missing definitions root.');

  const process = root['bpmn:process'] || root['process'];
  if (!process) throw new Error('Invalid BPMN XML: Missing process element.');

  const aplNodes: APLNode[] = [];
  const seqFlows = process['bpmn:sequenceFlow'] || process['sequenceFlow'] || [];
  
  const getNext = (sourceId: string): string | undefined => {
    const flow = seqFlows.find((f: any) => f['@_sourceRef'] === sourceId);
    return flow ? flow['@_targetRef'] : undefined;
  };

  const processStartEvents = process['bpmn:startEvent'] || [];
  let entryId = '';

  processStartEvents.forEach((se: any) => {
    const id = se['@_id'];
    if (!entryId) entryId = id;
    aplNodes.push({
      id,
      type: 'webhook',
      description: se['@_name'],
      next: getNext(id),
    });
  });

  const processEndEvents = process['bpmn:endEvent'] || [];
  processEndEvents.forEach((ee: any) => {
    aplNodes.push({
      id: ee['@_id'],
      type: 'end',
      description: ee['@_name'],
    });
  });

  const processServiceTasks = process['bpmn:serviceTask'] || [];
  processServiceTasks.forEach((st: any) => {
    // Check if it's an AI Agent or standard engine task based on extensions or naming
    const isAgent = st['@_name']?.toLowerCase().includes('agent') || st['@_name']?.toLowerCase().includes('ai');
    if (isAgent) {
      aplNodes.push({
        id: st['@_id'],
        type: 'agent',
        description: st['@_name'],
        model: 'gpt-4o', // Default assumption
        next: getNext(st['@_id']),
      });
    } else {
      aplNodes.push({
        id: st['@_id'],
        type: 'engine-task',
        description: st['@_name'],
        service: st['@_camunda:topic'] || st['@_abada:topic'] || 'legacy-service',
        next: getNext(st['@_id']),
      });
    }
  });

  const processUserTasks = process['bpmn:userTask'] || [];
  processUserTasks.forEach((ut: any) => {
    aplNodes.push({
      id: ut['@_id'],
      type: 'approval-gate',
      description: ut['@_name'],
      assignees: ut['@_camunda:assignee'] ? [ut['@_camunda:assignee']] : ['reviewer'],
      next: getNext(ut['@_id']),
    });
  });

  const processGateways = process['bpmn:exclusiveGateway'] || [];
  processGateways.forEach((gw: any) => {
    const outFlows = seqFlows.filter((f: any) => f['@_sourceRef'] === gw['@_id']);
    aplNodes.push({
      id: gw['@_id'],
      type: 'condition',
      description: gw['@_name'],
      rules: outFlows.map((f: any) => ({
        if: f['bpmn:conditionExpression'] ? f['bpmn:conditionExpression']['#text'] : undefined,
        then: f['@_targetRef'],
      }))
    });
  });

  return {
    version: 'abada.io/v1',
    metadata: {
      name: process['@_name'] || process['@_id'] || 'Imported Process',
      owner: 'imported-user',
    },
    flow: {
      entry: entryId,
      nodes: aplNodes,
    }
  };
}
