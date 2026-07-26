import { useEffect, useRef, useState } from "react";
import BpmnJS from "bpmn-js/lib/NavigatedViewer";
import { AlertTriangle } from "lucide-react";
import { prepareDiagramXml } from "@/lib/bpmn-diagram";

// Import the necessary CSS for the viewer and the BPMN font
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

interface BpmnViewerProps {
  xml: string;
  activeActivityIds?: string[];
}

export function BpmnViewer({ xml, activeActivityIds = [] }: BpmnViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewerRef.current) return;

    const viewer = new BpmnJS({
      container: viewerRef.current,
    });
    let cancelled = false;

    const importXml = async () => {
      setRenderError(null);
      try {
        const diagramXml = await prepareDiagramXml(xml);

        if (cancelled) return;
        await viewer.importXML(diagramXml);
        if (cancelled) return;

        const canvas = viewer.get("canvas") as {
          zoom: (value: string) => void;
          addMarker: (id: string, marker: string) => void;
        };
        canvas.zoom("fit-viewport");
        activeActivityIds.forEach((activityId) => {
          if (!activityId) return;
          try {
            canvas.addMarker(activityId, "highlight-active");
            canvas.addMarker(activityId, "highlight-pulse");
          } catch (error) {
            console.warn(
              `Failed to highlight BPMN activity ${activityId}`,
              error,
            );
          }
        });
      } catch (err) {
        console.error("Failed to import BPMN XML", err);
        if (!cancelled) {
          setRenderError(
            "This BPMN definition could not be rendered. Validate the XML or redeploy it with BPMN diagram layout data.",
          );
        }
      }
    };

    void importXml();

    return () => {
      cancelled = true;
      viewer.destroy();
    };
  }, [xml, activeActivityIds]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-background/50">
      <div ref={viewerRef} className="h-full w-full bpmn-container" />
      {renderError && (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-background/95 p-6"
        >
          <div className="max-w-md text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
            <p className="font-medium text-foreground">
              Diagram preview unavailable
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{renderError}</p>
          </div>
        </div>
      )}
    </div>
  );
}
