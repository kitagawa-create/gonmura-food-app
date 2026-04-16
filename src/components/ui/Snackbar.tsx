"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type ToastState = { id: number; message: string } | null;

type ToastContextValue = {
  /** メッセージを表示。既存 toast があれば最新 1 件で置き換え。3 秒後に自動消去。 */
  show: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const show = useCallback((message: string) => {
    setToast({ id: Date.now(), message });
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 right-6 z-[60] animate-fade-in"
        >
          <div className="pointer-events-auto min-w-[220px] max-w-[360px] rounded-lg bg-[color:var(--color-bg-elevated)] px-4 py-3 text-sm font-medium text-[color:var(--color-text-on-dark)] shadow-lg">
            {toast.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
}
