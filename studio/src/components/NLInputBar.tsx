import React, { useState } from 'react';
import { Sparkles, ArrowRight, RotateCcw, Lightbulb } from 'lucide-react';

interface NLInputBarProps {
  onGenerateWorkflow: (prompt: string, mode: 'new' | 'refine') => Promise<void>;
  isGenerating: boolean;
  hasActiveWorkflow: boolean;
}

export const NLInputBar: React.FC<NLInputBarProps> = ({
  onGenerateWorkflow,
  isGenerating,
  hasActiveWorkflow,
}) => {
  const [prompt, setPrompt] = useState<string>('');
  const [mode, setMode] = useState<'new' | 'refine'>('new');

  const samplePrompts = [
    'Automated invoice fraud analysis with DMN tax calculation and executive sign-off',
    'Corporate KYC verification with document OCR and sanctions check',
    'Supply chain escalation flow with dual AI risk evaluators and warehouse dispatch',
    'Insurance claim damage assessment with policy deductible matrix',
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    await onGenerateWorkflow(prompt, mode);
  };

  const handleSelectSample = async (sample: string) => {
    setPrompt(sample);
    await onGenerateWorkflow(sample, 'new');
  };

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 w-full max-w-3xl px-4 pointer-events-none">
      <div className="bg-[#25201D] border border-[#3A322E] rounded-2xl p-2.5 shadow-warm-lg pointer-events-auto space-y-2">
        {/* Input Bar Form */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div className="pl-2 flex items-center justify-center text-[#9D4EDD]">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>

          {hasActiveWorkflow && (
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'new' | 'refine')}
              className="bg-[#1A1614] border border-[#3A322E] rounded-lg px-2 py-1 text-xs text-[#EAE3D9] focus:outline-none"
            >
              <option value="new">Create New</option>
              <option value="refine">Refine Process</option>
            </select>
          )}

          <input
            id="workflow-prompt"
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={mode === 'new' ? "Describe a new business process..." : "E.g., 'Add a human approval step after fraud analysis'..."}
            className="flex-1 bg-transparent border-none text-xs text-[#EAE3D9] placeholder-[#A89F91] focus:outline-none px-2 font-medium"
            disabled={isGenerating}
          />

          <button
            type="submit"
            disabled={!prompt.trim() || isGenerating}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0 ${
              !prompt.trim() || isGenerating
                ? 'bg-[#3A322E] text-[#A89F91] cursor-not-allowed'
                : 'bg-gradient-to-r from-[#9D4EDD] to-[#F4A261] text-white hover:opacity-90 active:scale-95 shadow-warm-md glow-amethyst-subtle'
            }`}
          >
            {isGenerating ? (
              <>
                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                <span>Generating APL...</span>
              </>
            ) : (
              <>
                <span>Architect Workflow</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </form>

        {/* Quick Suggestion Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 text-[10px] text-[#A89F91] no-scrollbar">
          <span className="flex items-center gap-1 font-semibold text-[#F4A261] shrink-0">
            <Lightbulb className="w-3 h-3 text-[#F4A261]" />
            AI Templates:
          </span>
          {samplePrompts.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectSample(s)}
              className="px-2 py-0.5 rounded-full bg-[#1A1614] hover:bg-[#2F2926] border border-[#3A322E] text-[#EAE3D9] hover:border-[#9D4EDD]/50 transition-all shrink-0 whitespace-nowrap"
            >
              {s.length > 42 ? `${s.slice(0, 42)}...` : s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
