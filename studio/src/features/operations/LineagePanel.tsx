import React, { useEffect, useState } from 'react';
import { ChevronRight, Workflow } from 'lucide-react';
import { EngineAPI, LineageDTO, LineageLinkDTO } from '@/api/engine';

interface LineagePanelProps {
  projectId?: string;
  instanceId: string;
  /** Opens a related instance; links are plain text without it. */
  onOpenInstance?: (instanceId: string) => void;
}

const humanize = (value: string) => value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const STATUS_TONE: Record<string, string> = {
  RUNNING: 'text-[#2A9D8F]',
  COMPLETED: 'text-[#90A955]',
  FAILED: 'text-[#E76F51]',
  CANCELLED: 'text-[#A89F91]',
  SUSPENDED: 'text-[#F4A261]',
};

/**
 * Call-process lineage of an instance: the chain of callers from the root
 * down to this instance, and the children its call steps started. Hidden for
 * an instance that neither was called nor called anything.
 */
export const LineagePanel: React.FC<LineagePanelProps> = ({ projectId, instanceId, onOpenInstance }) => {
  const [lineage, setLineage] = useState<LineageDTO | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    EngineAPI.getLineage(projectId, instanceId)
      .then((loaded) => { if (!cancelled) setLineage(loaded); })
      .catch(() => { if (!cancelled) setLineage(null); });
    return () => { cancelled = true; };
  }, [projectId, instanceId]);

  if (!lineage || (lineage.ancestors.length === 0 && lineage.children.length === 0)) return null;

  const link = (target: LineageLinkDTO) => onOpenInstance ? (
    <button type="button" onClick={() => onOpenInstance(target.instanceId)}
      className="font-semibold text-[#EAE3D9] underline-offset-2 hover:text-[#F4A261] hover:underline"
      title={target.instanceId}>
      {humanize(target.processDefinitionId)}
    </button>
  ) : <span className="font-semibold text-[#EAE3D9]" title={target.instanceId}>{humanize(target.processDefinitionId)}</span>;

  return (
    <div className="shrink-0 border-b border-[#3A322E] bg-[#1A1614] px-4 py-2 text-[11px] text-[#A89F91]"
      aria-label="Process lineage">
      {lineage.ancestors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <Workflow className="h-3.5 w-3.5 text-[#F4A261]" aria-hidden />
          <span className="mr-1">Called by</span>
          {lineage.ancestors.map((ancestor, index) => (
            <React.Fragment key={ancestor.instanceId}>
              {index > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
              {link(ancestor)}
            </React.Fragment>
          ))}
          <ChevronRight className="h-3 w-3" aria-hidden />
          <span>this instance (depth {lineage.depth})</span>
        </div>
      )}
      {lineage.children.length > 0 && (
        <div className={lineage.ancestors.length > 0 ? 'mt-1.5' : ''}>
          <div className="mb-1 flex items-center gap-1">
            <Workflow className="h-3.5 w-3.5 text-[#F4A261]" aria-hidden />
            <span>Called processes ({lineage.children.length})</span>
          </div>
          <ul className="space-y-0.5 pl-5">
            {lineage.children.map((child) => (
              <li key={child.instanceId} className="flex flex-wrap items-center gap-2">
                {link(child)}
                {child.parentActivityId && <span>from {humanize(child.parentActivityId)}</span>}
                <span className={`font-mono text-[10px] ${STATUS_TONE[child.status] ?? ''}`}>{child.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
