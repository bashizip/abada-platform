import { useEffect, useMemo, useRef, useState } from 'react';
import { AplAPI, type AplValidationIssue } from '@/api/apl';
import { stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { issuesByNode } from '@/lib/apl/issues';
import type { WorkflowFile } from '@/types';

const DEBOUNCE_MS = 900;

/**
 * Engine validation of the document being edited on the canvas, debounced and
 * grouped by node so the canvas can badge the nodes and the inspector can list
 * a node's issues. An unreachable engine simply yields no issues.
 */
export function useAplValidation(workflow: WorkflowFile | null, enabled: boolean) {
  const [byNode, setByNode] = useState<Map<string, AplValidationIssue[]>>(new Map());
  const sequence = useRef(0);
  const source = useMemo(() => {
    if (!enabled || !workflow) return null;
    try {
      const document = workflowToAPL(workflow);
      return { yaml: stringifyAPLYaml(document), nodeIds: document.flow.nodes.map((node) => node.id) };
    } catch {
      return null;
    }
  }, [workflow, enabled]);

  useEffect(() => {
    if (!source) {
      sequence.current++;
      setByNode(new Map());
      return undefined;
    }
    const current = ++sequence.current;
    const timer = window.setTimeout(() => {
      AplAPI.validate(source.yaml)
        .then((result) => {
          if (current === sequence.current) setByNode(issuesByNode(result.issues, source.nodeIds));
        })
        .catch(() => {
          if (current === sequence.current) setByNode(new Map());
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [source]);

  const counts = useMemo(() => new Map([...byNode].map(([id, list]) => [id, list.length])), [byNode]);
  return { issuesByNode: byNode, issueCounts: counts };
}
