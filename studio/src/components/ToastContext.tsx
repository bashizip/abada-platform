import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from 'lucide-react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, title: string, message?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((type: ToastType, title: string, message?: string) => {
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
                ? 'border-[#E76F51]/50 bg-[#2B1B18] text-[#EAE3D9]'
                : toast.type === 'success'
                ? 'border-[#2A9D8F]/50 bg-[#162724] text-[#EAE3D9]'
                : toast.type === 'warning'
                ? 'border-[#F4A261]/50 bg-[#29221B] text-[#EAE3D9]'
                : 'border-[#3A322E] bg-[#25201D] text-[#EAE3D9]'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {toast.type === 'error' && <AlertCircle className="h-5 w-5 text-[#E76F51]" />}
              {toast.type === 'success' && <CheckCircle className="h-5 w-5 text-[#2A9D8F]" />}
              {toast.type === 'warning' && <AlertTriangle className="h-5 w-5 text-[#F4A261]" />}
              {toast.type === 'info' && <Info className="h-5 w-5 text-[#2A9D8F]" />}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold">{toast.title}</h4>
              {toast.message && <p className="text-[11px] text-[#A89F91] mt-0.5 leading-snug">{toast.message}</p>}
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="text-[#A89F91] hover:text-[#EAE3D9] transition-colors p-0.5"
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
