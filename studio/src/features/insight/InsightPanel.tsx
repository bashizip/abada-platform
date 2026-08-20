import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Loader2, CheckCircle2, XCircle, Brain } from 'lucide-react';
import { InsightAPI, InsightProposalSummary, InsightProposalDetail } from '@/api/insight';
import { useToast } from '@/components/ToastContext';

export const InsightPanel: React.FC = () => {
  const { showToast } = useToast();
  const [proposals, setProposals] = useState<InsightProposalSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<InsightProposalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, config] = await Promise.all([
        InsightAPI.listProposals(),
        InsightAPI.getLlmConfig().catch(() => null),
      ]);
      setProposals(p.items);
      setLlmConfigured(config !== null && config.configured);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load proposals');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReview = async (proposalId: number, approved: boolean) => {
    try {
      const detail = selectedProposal;
      if (!detail) return;
      await InsightAPI.reviewProposal(
        proposalId,
        approved ? 'APPROVE' : 'REJECT',
        approved ? 'Approved from Insight panel' : 'Rejected from Insight panel',
        detail.updatedAt
      );
      showToast('success', approved ? 'Proposal approved' : 'Proposal rejected');
      void load();
      setSelectedProposal(null);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Review failed');
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F4A261]/20 text-[#F4A261] font-medium">Pending</span>;
      case 'APPROVED':
        return <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#2A9D8F]/20 text-[#2A9D8F] font-medium">Approved</span>;
      case 'REJECTED':
        return <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E76F51]/20 text-[#E76F51] font-medium">Rejected</span>;
      default:
        return <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#3A322E] text-[#A89F91] font-medium">{status}</span>;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1A1614]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#3A322E]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#9D4EDD]" />
          <h2 className="text-sm font-semibold text-[#EAE3D9]">Insight Engine</h2>
          <span className="text-[10px] text-[#A89F91]">{proposals.length} proposals</span>
        </div>
        <div className="flex items-center gap-2">
          {llmConfigured !== null && (
            <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${
              llmConfigured
                ? 'bg-[#2A9D8F]/20 text-[#2A9D8F]'
                : 'bg-[#E76F51]/20 text-[#E76F51]'
            }`}>
              <Brain className="w-3 h-3" />
              {llmConfigured ? 'LLM Ready' : 'LLM Not Configured'}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Proposal list */}
        <div className="w-[380px] border-r border-[#3A322E] overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-[#9D4EDD] animate-spin" />
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {proposals.map(p => (
                <button
                  key={p.id}
                  onClick={async () => {
                    setDetailLoading(true);
                    try {
                      const detail = await InsightAPI.getProposal(p.id);
                      setSelectedProposal(detail);
                    } catch (err) {
                      showToast('error', err instanceof Error ? err.message : 'Failed to load proposal detail');
                    } finally {
                      setDetailLoading(false);
                    }
                  }}
                  className={`w-full text-left bg-[#25201D] border rounded-xl px-4 py-3 transition-all hover:border-[#9D4EDD]/30 ${
                    selectedProposal?.id === p.id
                      ? 'border-[#9D4EDD]/50'
                      : 'border-[#3A322E]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-[#EAE3D9]">Proposal #{String(p.id).padStart(6, '0')}</span>
                    {statusBadge(p.status)}
                  </div>
                  <p className="text-[11px] text-[#A89F91] line-clamp-2">{p.rationale || 'No rationale provided'}</p>
                  <div className="flex items-center gap-2 mt-2 text-[10px] text-[#A89F91]/60">
                    <span>Target: v{p.targetVersion}</span>
                    <span>·</span>
                    <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
              {proposals.length === 0 && !loading && (
                <div className="text-center py-12 text-[#A89F91] text-sm">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No proposals yet
                </div>
              )}
            </div>
          )}
        </div>

        {/* Proposal detail */}
        <div className="flex-1 overflow-auto p-4">
          {detailLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 text-[#9D4EDD] animate-spin" />
            </div>
          ) : selectedProposal ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#EAE3D9]">
                  Proposal #{String(selectedProposal.id).padStart(6, '0')}
                </h3>
                {statusBadge(selectedProposal.status)}
              </div>

              <div className="bg-[#25201D] border border-[#3A322E] rounded-xl p-4">
                <h4 className="text-[10px] text-[#A89F91] uppercase tracking-wider mb-1">Rationale</h4>
                <p className="text-xs text-[#EAE3D9] leading-relaxed">{selectedProposal.rationale}</p>
              </div>

              {selectedProposal.proposedSource && (
                <div className="bg-[#25201D] border border-[#3A322E] rounded-xl p-4">
                  <h4 className="text-[10px] text-[#A89F91] uppercase tracking-wider mb-2">Proposed Source</h4>
                  <pre className="text-[11px] text-[#EAE3D9] font-mono bg-[#1A1614] rounded-lg p-3 overflow-auto max-h-64">
                    {selectedProposal.proposedSource}
                  </pre>
                </div>
              )}

              {selectedProposal.status === 'PENDING' && (
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={() => void handleReview(selectedProposal.id, true)}
                    className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] transition-all"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => void handleReview(selectedProposal.id, false)}
                    className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg bg-[#E76F51] hover:bg-[#f0846b] text-[#1A1614] transition-all"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-[#A89F91]">
              <Sparkles className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Select a proposal to review</p>
              <p className="text-xs opacity-50 mt-1">AI-generated workflow optimizations appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
