declare module "bpmn-moddle" {
  export interface BpmnElement {
    $type: string;
    rootElements?: BpmnElement[];
    flowElements?: BpmnElement[];
    sourceRef?: BpmnElement;
    targetRef?: BpmnElement;
    incoming?: BpmnElement[];
    outgoing?: BpmnElement[];
  }

  export class BpmnModdle {
    fromXML(xml: string): Promise<{
      rootElement: BpmnElement;
      warnings?: unknown[];
    }>;

    toXML(element: BpmnElement): Promise<{
      xml: string;
    }>;
  }
}
