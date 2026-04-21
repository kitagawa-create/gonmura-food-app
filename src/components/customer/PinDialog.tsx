"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type Props = {
  open: boolean;
  onSuccess: () => void;
  onCancel: () => void;
};

export function PinDialog({ open, onSuccess, onCancel }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPin("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pin.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setError(null);
    try {
      const snap = await getDoc(doc(db, "settings", "global"));
      const stored = snap.exists() ? ((snap.data().tableChangePin as string) ?? "") : "";
      if (!stored) {
        onSuccess();
        return;
      }
      if (trimmed !== stored) {
        setError("PINコードが違います");
        setPin("");
        return;
      }
      onSuccess();
    } catch {
      setError("確認に失敗しました");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xs rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-center text-[color:var(--color-text-primary)] mb-1">
          PINコードを入力
        </h2>
        <p className="text-sm text-center text-[color:var(--color-text-muted)] mb-5">
          スタッフにお声がけください
        </p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin}
          onChange={(e) => { setPin(e.target.value); if (error) setError(null); }}
          placeholder="••••"
          className="w-full text-center text-2xl tracking-widest bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
        />
        {error && (
          <p className="mt-2 text-xs text-center text-[color:var(--color-accent-warn)]">{error}</p>
        )}
        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={() => { setPin(""); setError(null); onCancel(); }}
            className="flex-1 rounded-xl border border-[color:var(--color-border)] py-2.5 text-sm text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={!pin.trim() || checking}
            className="flex-1 rounded-xl bg-[color:var(--color-accent-char)] py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {checking ? "確認中..." : "確認"}
          </button>
        </div>
      </form>
    </div>
  );
}
