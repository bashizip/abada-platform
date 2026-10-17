import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from 'lucide-react';
import type { Emphasis, SoundName } from 'cuelume';
import { playCue } from '@/lib/sound';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

/** The cue a toast plays for what it reports. Routine toasts stay subtle. */
const TOAST_CUES: Record<ToastType, SoundName> = {
  info: 'ready',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

export interface ToastOptions {
  /** How much the reported outcome matters; `strong` for deploys and publishes. */
  emphasis?: Emphasis;
}

interface ToastContextValue {
  showToast: (type: ToastType, title: string, message?: string, options?: ToastOptions) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((type: ToastType, title: string, message?: string, options?: ToastOptions) => {
    playCue(TOAST_CUES[type], { emphasis: options?.emphasis ?? 'subtle' });
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 shadow-xl transition-all duration-300 ${
              toast.type === 'error'
                ? 'border-desert-rose/50 bg-[#2B1B18] text-linen'
                : toast.type === 'success'
                ? 'border-mineral-teal/50 bg-[#162724] text-linen'
                : toast.type === 'warning'
                ? 'border-saffron/50 bg-[#29221B] text-linen'
                : 'border-hairline bg-mocha text-linen'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {toast.type === 'error' && <AlertCircle className="h-5 w-5 text-desert-rose" />}
              {toast.type === 'success' && <CheckCircle className="h-5 w-5 text-mineral-teal" />}
              {toast.type === 'warning' && <AlertTriangle className="h-5 w-5 text-saffron" />}
              {toast.type === 'info' && <Info className="h-5 w-5 text-mineral-teal" />}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold">{toast.title}</h4>
              {toast.message && <p className="text-[11px] text-sand mt-0.5 leading-snug">{toast.message}</p>}
            </div>
            <button
              type="button"
              data-cuelume-close
              data-cuelume-emphasis="subtle"
              onClick={() => removeToast(toast.id)}
              className="text-sand hover:text-linen transition-colors p-0.5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
