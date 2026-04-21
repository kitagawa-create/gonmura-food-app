"use client";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  warning?: string;
  confirmLabel: string;
  confirmColor?: "red" | "green" | "blue";
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
};

export function ConfirmDialog({
  open,
  title,
  message,
  warning,
  confirmLabel,
  confirmColor = "red",
  onConfirm,
  onCancel,
  loading,
}: ConfirmDialogProps) {
  if (!open) return null;

  const colorClass =
    confirmColor === "green"
      ? "bg-[color:var(--color-accent-negi)] hover:opacity-90"
      : confirmColor === "blue"
        ? "bg-[color:var(--color-accent-char)] hover:opacity-90"
        : "bg-[color:var(--color-accent-warn)] hover:opacity-90";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-6 shadow-xl">
        <h2 className="text-lg font-bold text-[color:var(--color-text-primary)] mb-3">{title}</h2>
        <p className="text-sm text-[color:var(--color-text-muted)] mb-3">{message}</p>
        {warning && (
          <div className="rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 mb-4">
            <p className="text-sm text-[color:var(--color-accent-warn)]">{warning}</p>
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl border border-[color:var(--color-border)] px-4 py-2.5 text-sm text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-xl px-4 py-2.5 text-sm text-white font-bold transition-colors disabled:opacity-50 ${colorClass}`}
          >
            {loading ? "処理中..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
