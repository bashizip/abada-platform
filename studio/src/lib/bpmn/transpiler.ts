import { XMLParser } from 'fast-xml-parser';
import { APLDocument, APLHitPolicy, APLNode, APLValue } from '../apl/types';
import { normalizeTableInputs } from '../apl/parser';
import { DEFAULT_AGENT_MODEL } from '@/lib/agentModels';

/** Coerces a string back to the typed value the engine stored. */
const coerceValue = (raw: string): APLValue => {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
  return raw;
};

/** Normalizes single-element fast-xml-parser output into an array. */
const asArray = <T,>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * Parses legacy BPMN 2.0 XML and transpiles it into Abada Process Language (APL).
 */
export function transpileBPMNToAPL(xmlString: string): APLDocument {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
isArray: (name) => {
      const arrayTags = ['bpmn:sequenceFlow', 'bpmn:task', 'bpmn:serviceTask', 'bpmn:userTask', 'bpmn:businessRuleTask', 'bpmn:scriptTask', 'bpmn:startEvent', 'bpmn:endEvent', 'bpmn:intermediateCatchEvent', 'bpmn:exclusiveGateway', 'bpmn:inclusiveGateway', 'bpmn:parallelGateway'];
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

  const messagesByName = new Map(
    asArray<any>(root['bpmn:message']).map((m) => [m['@_id'], m['@_name']])
  );
  const signalsByName = new Map(
    asArray<any>(root['bpmn:signal']).map((s) => [s['@_id'], s['@_name']])
  );

  const processCatchEvents = process['bpmn:intermediateCatchEvent'] || [];
  processCatchEvents.forEach((ce: any) => {
    if (ce['bpmn:messageEventDefinition']) {
      const ref = ce['bpmn:messageEventDefinition']['@_messageRef'];
      aplNodes.push({
        id: ce['@_id'],
        type: 'message-catch',
        description: ce['@_name'],
        message: messagesByName.get(ref) || ref,
        next: getNext(ce['@_id']),
      });
    } else if (ce['bpmn:timerEventDefinition']) {
      const def = ce['bpmn:timerEventDefinition'];
      aplNodes.push({
        id: ce['@_id'],
        type: 'timer',
        description: ce['@_name'],
        duration: def['bpmn:timeDuration'] ?? def['bpmn:timeDuration']?.['#text'] ?? '',
        next: getNext(ce['@_id']),
      });
    } else if (ce['bpmn:signalEventDefinition']) {
      const ref = ce['bpmn:signalEventDefinition']['@_signalRef'];
      aplNodes.push({
        id: ce['@_id'],
        type: 'signal',
        description: ce['@_name'],
        signal: signalsByName.get(ref) || ref,
        next: getNext(ce['@_id']),
      });
    }
  });

  const getProperties = (el: any): Record<string, string> => {
    const props: Record<string, string> = {};
    const properties =
      el?.['bpmn:extensionElements']?.['camunda:properties']?.['camunda:property'];
    const list = Array.isArray(properties) ? properties : properties ? [properties] : [];
    list.forEach((p: any) => {
      if (p?.['@_name']) props[p['@_name']] = p['@_value'] ?? '';
    });
    return props;
  };

  // Native decision tables: bpmn:businessRuleTask carrying an
  // abada:decisionTable extension (the engine executes it in-transaction).
  const processBusinessRuleTasks = process['bpmn:businessRuleTask'] || [];
  processBusinessRuleTasks.forEach((brt: any) => {
    const table = brt?.['bpmn:extensionElements']?.['abada:decisionTable'];
    if (!table) return; // a businessRuleTask without the extension is a deploy error anyway
    const inputs = normalizeTableInputs(
      asArray<any>(table['abada:input']).map((input) => ({
        name: input['@_name'],
        expr: input['@_expr'],
      }))
    );
    const rules = asArray<any>(table['abada:rule']).map((rule) => {
      const outputs = asArray<any>(rule['abada:output']).reduce<Record<string, APLValue>>(
        (acc, output) => {
          acc[output['@_name']] = coerceValue(String(output['@_value'] ?? ''));
          return acc;
        },
        {}
      );
      if (rule['@_otherwise'] === 'true') return { otherwise: true, then: outputs };
      return { when: rule['@_when'], then: outputs };
    });
    aplNodes.push({
      id: brt['@_id'],
      type: 'decision-table',
      description: brt['@_name'] || '',
      decisionKey: table['@_decisionKey'],
      hitPolicy: (table['@_hitPolicy'] as APLHitPolicy) || 'FIRST',
      inputs: inputs.map((i) => ({ name: i.name, expr: i.expr })),
      rules,
      next: getNext(brt['@_id']),
    });
  });

  const processServiceTasks = process['bpmn:serviceTask'] || [];
  processServiceTasks.forEach((st: any) => {
    const topic = st['@_camunda:topic'] || st['@_abada:topic'];
    const name = st['@_name'] || '';
    const props = getProperties(st);
    const isLegacyDmn = topic === 'abada:dmn';
    const isAgent =
      topic === 'abada:agent' ||
      (!isLegacyDmn && (name.toLowerCase().includes('agent') || name.toLowerCase().includes('ai')));

    if (isLegacyDmn) {
      // Legacy pre-Phase-2 documents: abada:dmn as an external service task.
      aplNodes.push({
        id: st['@_id'],
        type: 'decision-table',
        description: name,
        decisionKey: props.decisionKey,
        hitPolicy: (props.hitPolicy as APLHitPolicy) || 'FIRST',
        next: getNext(st['@_id']),
      });
    } else if (isAgent) {
      aplNodes.push({
        id: st['@_id'],
        type: 'agent',
        description: name,
        model: props.model || DEFAULT_AGENT_MODEL,
        prompt: props.prompt || undefined,
        confidence_threshold: props.confidence_threshold
          ? Number(props.confidence_threshold)
          : undefined,
        next: getNext(st['@_id']),
      });
    } else {
      aplNodes.push({
        id: st['@_id'],
        type: 'engine-task',
        description: name,
        service: topic || 'legacy-service',
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

  const processScriptTasks = process['bpmn:scriptTask'] || [];
  processScriptTasks.forEach((st: any) => {
    const script = st['bpmn:script'];
    aplNodes.push({
      id: st['@_id'],
      type: 'script',
      description: st['@_name'] || '',
      script: typeof script === 'string' ? script : script?.['#text'] ?? '',
      format: st['@_scriptFormat'] || 'javascript',
      next: getNext(st['@_id']),
    } as APLNode);
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

  const processInclusiveGateways = process['bpmn:inclusiveGateway'] || [];
  processInclusiveGateways.forEach((gw: any) => {
    const outFlows = seqFlows.filter((f: any) => f['@_sourceRef'] === gw['@_id']);
    const defaultFlowId = gw['@_default'];
    aplNodes.push({
      id: gw['@_id'],
      type: 'inclusive',
      description: gw['@_name'],
      ...(outFlows.length >= 2
        ? {
            rules: outFlows.map((f: any) => ({
              if: f['bpmn:conditionExpression'] ? f['bpmn:conditionExpression']['#text'] : undefined,
              else: f['@_id'] === defaultFlowId ? f['@_targetRef'] : undefined,
              then: f['@_targetRef'],
            }))
          }
        : { next: outFlows[0]?.['@_targetRef'] }),
    } as APLNode);
  });

  const processParallelGateways = process['bpmn:parallelGateway'] || [];
  processParallelGateways.forEach((gw: any) => {
    const outFlows = seqFlows.filter((f: any) => f['@_sourceRef'] === gw['@_id']);
    // The fork keeps parallelism by declaring one branch per outgoing flow;
    // a parallel gateway with a single successor is a join instead.
    aplNodes.push({
      id: gw['@_id'],
      type: 'parallel',
      description: gw['@_name'],
      ...(outFlows.length >= 2
        ? { branches: outFlows.map((f: any) => f['@_targetRef']) }
        : { next: outFlows[0]?.['@_targetRef'] }),
    } as APLNode);
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
