/**
 * Kitchen-sink APL ↔ BPMN round-trip fidelity check (Studio gate).
 *
 * The kitchen-sink document (docs/features/kitchen-sink-process.md) must be
 * fully representable in native APL and must survive both directions of the
 * Studio compiler/transpiler without losing structure:
 *
 *   1. engine/src/test/resources/apl/kitchen-sink.apl.yaml  → BPMN → APL
 *   2. engine/src/test/resources/bpmn/kitchen-sink-test.bpmn → APL → BPMN
 *
 * Run with `npm run verify:kitchen-sink` from studio/ (needs `tsx`).
 *
 * When the engine test fixtures are not present (e.g. inside a Docker build
 * whose context is the studio/ directory only), the check is skipped with a
 * warning so the production image can still be built.
 */
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseAPLYaml } from '../src/lib/apl/parser';
import { compileAPLToBPMN } from '../src/lib/bpmn/compiler';
import { transpileBPMNToAPL } from '../src/lib/bpmn/transpiler';
import { APLDocument, APLNode } from '../src/lib/apl/types';

const here = dirname(fileURLToPath(import.meta.url));
const engineFixturePath = resolve(here, '../../engine/src/test/resources');

const fixtureExists = (rel: string): boolean => {
  try {
    return fs.existsSync(resolve(engineFixturePath, rel));
  } catch {
    return false;
  }
};

if (!fixtureExists('apl/kitchen-sink.apl.yaml') || !fixtureExists('bpmn/kitchen-sink-test.bpmn')) {
  console.warn('Kitchen-sink fixtures not found at', engineFixturePath + '.');
  console.warn('Skipping round-trip verification (expected when building inside Docker).');
  process.exit(0);
}

const engineFixture = (rel: string): string =>
  fs.readFileSync(resolve(engineFixturePath, rel), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) {
    failures++;
    console.error(`  ✗ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
};

/** Structural signature of an APL document: id → type → routing (order-free). */
const signature = (doc: APLDocument) => {
  const nodes = doc.flow.nodes.map((node) => {
    const anyNode = node as any;
    if (node.type === 'condition' || node.type === 'inclusive') {
      return [node.id, node.type, (anyNode.rules || []).map((r: any) => r.then).sort()];
    }
    if (node.type === 'parallel') {
      return [node.id, node.type, (anyNode.branches || [anyNode.next]).filter(Boolean).sort()];
    }
    if (node.type === 'event-gateway') {
      return [
        node.id,
        node.type,
        (anyNode.events || []).map((e: any) => [e.type, e.message || e.duration || e.signal, e.next]),
      ];
    }
    return [node.id, node.type, anyNode.next];
  });
  return { entry: doc.flow.entry, nodes: nodes.sort((a, b) => String(a[0]).localeCompare(String(b[0]))) };
};

console.log('Kitchen-sink APL ↔ BPMN round-trip');
console.log('1. APL fixture → BPMN → APL');

const aplSource = engineFixture('apl/kitchen-sink.apl.yaml');
const apl = parseAPLYaml(aplSource);
check('APL fixture parses', !!apl.flow?.nodes?.length, { nodes: apl.flow?.nodes?.length });

const bpmnFromApl = compileAPLToBPMN(apl);
check('compiled BPMN declares an event-based gateway', bpmnFromApl.includes('bpmn:eventBasedGateway'));
// Count opening tags only — closing tags would double the count.
check('compiled BPMN has two competing catch events',
  (bpmnFromApl.match(/<bpmn:intermediateCatchEvent/g) || []).length === 2);
check('compiled BPMN keeps the FastTrackMessage', bpmnFromApl.includes('FastTrackMessage'));
check('compiled BPMN keeps the one-hour timer', bpmnFromApl.includes('PT1H'));
check('compiled BPMN keeps the kitchen-sink topic', bpmnFromApl.includes('kitchen-sink-topic'));
// fast-xml-parser escapes apostrophes in attribute text as &apos;.
check('compiled BPMN keeps the inclusive conditions',
  bpmnFromApl.includes("${path == &apos;C&apos;}") && bpmnFromApl.includes("${path == &apos;D&apos;}"));
check('compiled BPMN has parallel and inclusive gateways',
  (bpmnFromApl.match(/<bpmn:parallelGateway/g) || []).length === 2
    && (bpmnFromApl.match(/<bpmn:inclusiveGateway/g) || []).length === 2);

const backToApl = transpileBPMNToAPL(bpmnFromApl);
const signatureRoundTrip = signature(backToApl);
const signatureOriginal = signature(apl);
check('round-tripped APL entry matches', signatureRoundTrip.entry === signatureOriginal.entry,
  { original: signatureOriginal.entry, roundTrip: signatureRoundTrip.entry });
check('round-tripped APL structure matches (ids/types/routing)', JSON.stringify(signatureRoundTrip) === JSON.stringify(signatureOriginal),
  { original: signatureOriginal.nodes, roundTrip: signatureRoundTrip.nodes });

console.log('2. Legacy BPMN fixture → APL → BPMN');

const bpmnFixture = engineFixture('bpmn/kitchen-sink-test.bpmn');
const aplFromBpmn = transpileBPMNToAPL(bpmnFixture);
check('transpiled APL keeps every declared node', aplFromBpmn.flow.nodes.length === 12, {
  count: aplFromBpmn.flow.nodes.length,
});
const find = (id: string) => aplFromBpmn.flow.nodes.find((n) => n.id === id) as any;
const eventGateway = find('EventGateway');
check('BPMN event gateway transpiles to an event-gateway node',
  eventGateway?.type === 'event-gateway' && (eventGateway.events || []).length === 2,
  eventGateway);
check('event children keep message + timer definitions',
  eventGateway?.events?.[0]?.type === 'message-catch'
    && eventGateway?.events?.[0]?.message === 'FastTrackMessage'
    && eventGateway?.events?.[1]?.type === 'timer'
    && eventGateway?.events?.[1]?.duration === 'PT1H'
    && eventGateway?.events?.every((e: any) => e.next === 'ParallelJoin'),
  eventGateway?.events);
check('embedded camunda:class delegate maps to the script node',
  find('ServiceA')?.type === 'script' && (find('ServiceA')?.script || '').includes('com.abada.engine.delegates.TestDelegate'));
check('parallel fork keeps both branches',
  find('ParallelFork')?.type === 'parallel'
    && JSON.stringify(find('ParallelFork')?.branches) === JSON.stringify(['ServiceA', 'EventGateway']));
check('inclusive fork keeps both conditional routes',
  find('InclusiveFork')?.type === 'inclusive'
    && (find('InclusiveFork')?.rules || []).map((r: any) => r.then).sort().join(',') === 'TaskC,TaskD');
check('external task keeps the kitchen-sink topic',
  find('ExternalTask')?.type === 'engine-task' && find('ExternalTask')?.service === 'kitchen-sink-topic');

const bpmnFromTranspiled = compileAPLToBPMN(aplFromBpmn);
check('recompiled BPMN declares the event-based gateway', bpmnFromTranspiled.includes('bpmn:eventBasedGateway'));
check('recompiled BPMN wires StartEvent → InitialTask → ParallelFork',
  bpmnFromTranspiled.includes('sourceRef="StartEvent_1"') && bpmnFromTranspiled.includes('targetRef="InitialTask"'));
check('recompiled BPMN reaches the end event', bpmnFromTranspiled.includes('targetRef="EndEvent_1"'));

if (failures > 0) {
  console.error(`\nKitchen-sink round-trip FAILED with ${failures} drift(s)`);
  process.exit(1);
}
console.log('\nKitchen-sink round-trip OK — APL and BPMN prove the same shape.');
