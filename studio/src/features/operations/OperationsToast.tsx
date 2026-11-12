import React from 'react';
import { AnimatePresence, m } from 'motion/react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast as toastVariants, useMotionVariants } from '@/lib/motion';
import type { OperationsNotice } from './useOperationsNotice';

export const OperationsToast: React.FC<{
  notice: OperationsNotice | null;
  onDismiss: () => void;
}> = ({ notice, onDismiss }) => {
  const variants = useMotionVariants(toastVariants);
  return (
    <div className="pointer-events-none fixed bottom-24 right-5 z-[var(--elevation-toast)]" aria-live="polite">
      <AnimatePresence>
        {notice && (
          <m.div key={notice.message} variants={variants} initial="initial" animate="enter" exit="exit" role="status"
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-hairline bg-mocha px-4 py-2 text-xs font-medium text-linen shadow-warm-lg">
            {notice.tone === 'error'
              ? <AlertTriangle className="h-3.5 w-3.5 text-desert-rose" aria-hidden="true" />
              : <CheckCircle2 className="h-3.5 w-3.5 text-sage-green" aria-hidden="true" />}
            {notice.message}
            {notice.action && (
              <button type="button" onClick={() => { notice.action?.run(); onDismiss(); }}
                className="ml-1 font-semibold text-saffron underline-offset-2 hover:underline">
                {notice.action.label}
              </button>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
};
