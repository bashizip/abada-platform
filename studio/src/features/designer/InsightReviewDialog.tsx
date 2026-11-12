import React from 'react';
import { AlertCircle, RotateCcw, Sparkles, X } from 'lucide-react';
import { MotionBackdrop, MotionPanel } from '@/components/ui';

interface InsightReviewDialogProps {
  state: 'loading' | 'empty' | 'error';
  message?: string;
  onRetry: () => void;
  onClose: () => void;
}

export const InsightReviewDialog: React.FC<InsightReviewDialogProps> = ({ state, message, onRetry, onClose }) => (
  <MotionBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-veil/80 backdrop-blur-sm p-4">
    <MotionPanel className="w-full max-w-md rounded-2xl border border-hairline bg-mocha shadow-warm-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-hairline bg-charcoal">
        <Sparkles className="w-4 h-4 text-amethyst" />
        <div><h2 className="text-sm font-semibold">Review AI Optimization</h2><p className="text-[10px] text-sand">Insight Engine · governed proposal review</p></div>
        <button onClick={onClose} aria-label="Close optimization review" className="ml-auto"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-6 text-center">
        {state === 'loading' && <><RotateCcw className="w-6 h-6 mx-auto text-amethyst animate-spin" /><p className="mt-3 text-xs text-sand">Loading pending proposals…</p></>}
        {state === 'empty' && <><Sparkles className="w-7 h-7 mx-auto text-moss" /><p className="mt-3 text-sm font-semibold">No pending optimization</p><p className="mt-1 text-xs text-sand">Insight has no draft or in-review proposal for this process.</p></>}
        {state === 'error' && <><AlertCircle className="w-7 h-7 mx-auto text-desert-rose" /><p className="mt-3 text-sm font-semibold">Insight could not be loaded</p><p className="mt-1 text-xs text-sand break-words">{message}</p><button onClick={onRetry} className="mt-4 px-3 py-2 rounded-lg bg-amethyst text-xs font-semibold">Retry</button></>}
      </div>
    </MotionPanel>
  </MotionBackdrop>
);
