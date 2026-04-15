"use client";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  warning?: string;
  confirmLabel: string;
  confirmColor?: "red" | "green";
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
      ? "bg-green-600 hover:bg-green-700"
      : "bg-red-600 hover:bg-red-700";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-neutral-900 border border-neutral-800 p-6 shadow-xl">
        <h2 className="text-lg font-bold text-white mb-3">{title}</h2>
        <p className="text-sm text-neutral-400 mb-3">{message}</p>
        {warning && (
          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 mb-4">
            <p className="text-sm text-yellow-400">{warning}</p>
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl border border-neutral-700 px-4 py-2.5 text-sm text-neutral-400 hover:bg-neutral-800 transition-colors disabled:opacity-50"
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
