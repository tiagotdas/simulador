import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 w-full max-w-sm pointer-events-none px-4 sm:px-0"
    >
      {toasts.map((t) => {
        const styles =
          t.type === 'success'
            ? 'bg-[#0c1f1a] border-emerald-500/40 text-emerald-100'
            : t.type === 'error'
            ? 'bg-[#231016] border-rose-500/40 text-rose-100'
            : 'bg-[#101c2e] border-sky-500/40 text-sky-100';

        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl ${styles}`}
          >
            <span className="mt-0.5 shrink-0">
              {t.type === 'success' ? (
                <CheckCircle2 size={18} className="text-emerald-400" />
              ) : t.type === 'error' ? (
                <AlertCircle size={18} className="text-rose-400" />
              ) : (
                <Info size={18} className="text-sky-400" />
              )}
            </span>
            <p className="text-xs font-medium leading-relaxed flex-1">{t.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Fechar notificação"
              className="text-slate-400 hover:text-white transition-colors p-0.5"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
