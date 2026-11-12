import React from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ToolApprovalDTO } from '@/api/engine';
import { JsonViewer } from '@/components/json/JsonViewer';
import { jsonHeight } from '@/components/json/jsonLayout';

interface ToolApprovalCardProps {
  approval: ToolApprovalDTO;
}

/** The arguments as shown to the approver, or null when the evidence policy hides them. */
export function approvalArguments(approval: ToolApprovalDTO): unknown {
  if (approval.arguments === null || approval.arguments === undefined) return null;
  return approval.arguments;
}

/**
 * What an agent proposes to do: the tool, its server, the agent that asked,
 * and the arguments the decision binds to. Approving runs exactly this call;
 * rejecting sends the comment back to the agent.
 */
export const ToolApprovalCard: React.FC<ToolApprovalCardProps> = ({ approval }) => {
  const args = approvalArguments(approval);
  return (
    <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl p-5 shadow-warm-md space-y-3"
      data-testid="tool-approval-card">
      <h3 className="text-sm font-semibold text-[#F4A261] flex items-center gap-2">
        <ShieldCheck className="w-4 h-4" />
        Tool call awaiting approval
      </h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-[#A89F91]">Tool</dt>
          <dd className="font-mono text-[#EAE3D9]">{approval.tool}</dd>
        </div>
        <div>
          <dt className="text-[#A89F91]">Server</dt>
          <dd className="font-mono text-[#EAE3D9]">{approval.server ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[#A89F91]">Proposed by</dt>
          <dd className="text-[#EAE3D9]">
            agent <span className="font-mono">{approval.agentActivityId}</span>
            {approval.model && <span className="text-[#A89F91]"> · {approval.model}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-[#A89F91]">Step</dt>
          <dd className="text-[#EAE3D9]">attempt {approval.attempt}, step {approval.sequence}</dd>
        </div>
      </dl>
      <div>
        <p className="text-xs text-[#A89F91] mb-1">
          Arguments{approval.payloadMode === 'redacted' ? ' (sensitive values redacted)' : ''}
        </p>
        {args === null ? (
          <p className="text-xs text-[#A89F91] italic">Hidden by the project's evidence policy.</p>
        ) : (
          <JsonViewer data={args} label="arguments" compact defaultDepth={2} height={jsonHeight(args, 2, 12)} />
        )}
      </div>
      <p className="text-[11px] text-[#A89F91] break-all">
        Your decision binds to this exact call (digest <span className="font-mono">{approval.argumentsDigest.slice(0, 16)}…</span>).
        Approving runs it once; rejecting sends your comment to the agent.
      </p>
    </div>
  );
};
