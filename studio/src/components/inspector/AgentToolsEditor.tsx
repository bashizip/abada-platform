import React, { useEffect, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { AgentToolRef } from '@/types';
import { toolRefOf } from '@/types';
import {
  bindTool, entryFor, loadToolCatalog, setToolPolicy, tighterPolicies, toolEntryProblem,
  type CatalogTool, type ToolPolicy,
} from '@/lib/apl/toolServers';

const FIELD = 'w-full bg-[#1A1614] border border-[#3A322E] rounded-lg px-2 py-1 text-[11px] text-[#EAE3D9] focus:outline-none focus:border-[#9D4EDD]';
const POLICY_LABEL: Record<ToolPolicy, string> = { read: 'read', write: 'write', approval_required: 'approval required' };

const splitGroups = (value: string) => value.split(',').map((group) => group.trim()).filter(Boolean);

/**
 * The agent's tools, picked from the project's tool servers. A node may only
 * tighten a server's policy; approval-required tools name who approves them.
 * Names no server offers stay listed, with why they will not run.
 */
export const AgentToolsEditor: React.FC<{
  projectId?: string;
  tools: AgentToolRef[];
  onChange: (tools: AgentToolRef[]) => void;
  /** Injected in tests. */
  loadCatalog?: (projectId: string) => Promise<CatalogTool[]>;
}> = ({ projectId, tools, onChange, loadCatalog = loadToolCatalog }) => {
  const [catalog, setCatalog] = useState<CatalogTool[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    loadCatalog(projectId).then((loaded) => { if (!cancelled) setCatalog(loaded); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [projectId, loadCatalog]);

  const known = new Set((catalog ?? []).map((tool) => tool.ref));
  const strays = tools.filter((entry) => !known.has(toolRefOf(entry)));

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-[#A89F91] block">Tools (from the project's tool servers)</label>
      {!projectId && <p className="text-[10px] text-[#A89F91]">Open the process in a project to pick its tools.</p>}
      {error && <p className="text-[10px] text-[#E76F51]">Could not load the tool servers: {error}</p>}
      {projectId && catalog && catalog.length === 0 && (
        <p className="text-[10px] text-[#A89F91]">This project has no tool servers yet. Add a TOOL_SERVER resource in the explorer.</p>
      )}
      {catalog && catalog.length > 0 && (
        <div className="rounded-lg border border-[#3A322E] divide-y divide-[#3A322E] bg-[#1A1614]">
          {catalog.map((tool) => {
            const entry = entryFor(tools, tool.ref);
            const policy = (entry && typeof entry !== 'string' && entry.policy) || tool.policy;
            const approvers = entry && typeof entry !== 'string' ? entry.approvers ?? [] : [];
            const problem = entry ? toolEntryProblem(entry, tool) : null;
            return (
              <div key={tool.ref} className="space-y-1 px-2 py-1.5">
                <label className="flex items-center gap-2 text-xs text-[#EAE3D9] cursor-pointer">
                  <input type="checkbox" checked={!!entry} aria-label={`Use ${tool.ref}`}
                    onChange={(event) => onChange(bindTool(tools, tool.ref, event.target.checked))}
                    className="accent-[#9D4EDD]" />
                  <span className="font-mono">{tool.ref}</span>
                  <span className="ml-auto rounded border border-[#3A322E] px-1 text-[9px] text-[#A89F91]">
                    {POLICY_LABEL[tool.policy]}
                  </span>
                </label>
                {tool.description && <p className="pl-6 text-[10px] text-[#A89F91]">{tool.description}</p>}
                {entry && (
                  <div className="space-y-1 pl-6">
                    <select aria-label={`Policy of ${tool.ref}`} value={policy} className={FIELD}
                      onChange={(event) => onChange(setToolPolicy(tools, tool, event.target.value as ToolPolicy, approvers))}>
                      {tighterPolicies(tool.policy).map((option) => (
                        <option key={option} value={option}>{POLICY_LABEL[option]}{option === tool.policy ? ' (server)' : ''}</option>
                      ))}
                    </select>
                    {policy === 'approval_required' && (
                      <input aria-label={`Approvers of ${tool.ref}`} className={FIELD}
                        placeholder={tool.approvers.length ? `server: ${tool.approvers.join(', ')}` : 'finance, support'}
                        defaultValue={approvers.join(', ')} key={`${tool.ref}-${approvers.join(',')}`}
                        onBlur={(event) => onChange(setToolPolicy(tools, tool, policy, splitGroups(event.target.value)))} />
                    )}
                    {problem && <p className="text-[10px] text-[#E76F51]">{problem}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {catalog && strays.map((entry) => (
        <div key={toolRefOf(entry)} className="flex items-center gap-2 text-[10px] text-[#F4A261]">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          <span className="font-mono">{toolRefOf(entry)}</span>
          <span className="text-[#A89F91]">{toolEntryProblem(entry, undefined)}</span>
          <button type="button" aria-label={`Remove ${toolRefOf(entry)}`} className="ml-auto text-[#A89F91] hover:text-[#E76F51]"
            onClick={() => onChange(bindTool(tools, toolRefOf(entry), false))}>
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
};
