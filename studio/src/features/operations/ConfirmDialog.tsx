import React, { useEffect, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { AlertTriangle, PauseCircle } from 'lucide-react';
import { MotionBackdrop, MotionPanel } from '@/components/ui';

export interface ConfirmRequest {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** A confirmation for an audited instance action (suspend, cancel, force fail). Esc keeps things as they are. */
export const ConfirmDialog: React.FC<{
  request: ConfirmRequest | null;
  onClose: () => void;
}> = ({ request, onClose }) => {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!request) return;
    keep.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request, onClose]);

  return (
    <AnimatePresence>
      {request && (
        <MotionBackdrop key="confirm" onClick={onClose}
          className="fixed inset-0 z-[var(--elevation-modal)] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
          <MotionPanel role="dialog" aria-modal="true" aria-label={request.title} initial="initial" animate="enter" exit="exit"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-panel border border-hairline bg-mocha p-5 shadow-warm-lg">
            <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-control border ${request.danger
              ? 'border-desert-rose/30 bg-desert-rose/10' : 'border-saffron/30 bg-saffron/10'}`}>
              {request.danger
                ? <AlertTriangle className="h-4 w-4 text-desert-rose" aria-hidden="true" />
                : <PauseCircle className="h-4 w-4 text-saffron" aria-hidden="true" />}
            </div>
            <h3 className="text-sm font-semibold text-linen">{request.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-sand">{request.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button ref={keep} type="button" onClick={onClose}
                className="rounded-control border border-hairline px-3 py-1.5 text-xs font-semibold text-sand transition-colors hover:border-hairline-strong hover:text-linen">
                Keep running
              </button>
              <button type="button" onClick={() => { onClose(); request.onConfirm(); }}
                className={`rounded-control px-3 py-1.5 text-xs font-semibold text-charcoal transition-colors ${request.danger
                  ? 'bg-desert-rose hover:bg-desert-rose-bright' : 'bg-saffron hover:bg-saffron-bright'}`}>
                {request.confirmLabel}
              </button>
            </div>
          </MotionPanel>
        </MotionBackdrop>
      )}
    </AnimatePresence>
  );
};
