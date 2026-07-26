import { layoutProcess } from "bpmn-auto-layout";
import { BpmnModdle, type BpmnElement } from "bpmn-moddle";

const BPMN_DIAGRAM_PATTERN =
  /<(?:[A-Za-z_][\w.-]*:)?BPMNDiagram(?:\s|>)/;

function addSequenceFlowReferences(container: BpmnElement): void {
  for (const element of container.flowElements ?? []) {
    if (element.$type === "bpmn:SequenceFlow") {
      const source = element.sourceRef;
      const target = element.targetRef;

      if (source) {
        source.outgoing ??= [];
        if (!source.outgoing.includes(element)) {
          source.outgoing.push(element);
        }
      }

      if (target) {
        target.incoming ??= [];
        if (!target.incoming.includes(element)) {
          target.incoming.push(element);
        }
      }
    }

    addSequenceFlowReferences(element);
  }
}

/**
 * Returns BPMN XML that bpmn-js can display.
 *
 * Definitions deployed without BPMN-DI are valid executable BPMN, but have no
 * coordinates for a viewer. The temporary model below reconstructs standard
 * incoming/outgoing references before auto-layout so connectors are generated
 * even when the source XML only declares sourceRef/targetRef on sequence flows.
 * The deployed definition is never mutated.
 */
export async function prepareDiagramXml(xml: string): Promise<string> {
  if (BPMN_DIAGRAM_PATTERN.test(xml)) {
    return xml;
  }

  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(xml);

  for (const root of rootElement.rootElements ?? []) {
    addSequenceFlowReferences(root);
  }

  const { xml: normalizedXml } = await moddle.toXML(rootElement);
  return layoutProcess(normalizedXml);
}
