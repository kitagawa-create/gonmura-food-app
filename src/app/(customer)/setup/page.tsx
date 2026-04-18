"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-context";

const PIN_KEY = "gonmura-table-pin";

export default function SetupPage() {
  const [tableInput, setTableInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [error, setError] = useState("");
  const { tableNumber, setTableNumber } = useCart();
  const router = useRouter();

  // 既に番号設定済みならメニューに飛ばす
  if (tableNumber !== null) {
    router.replace("/menu");
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseInt(tableInput, 10);
    if (isNaN(num) || num <= 0 || num > 50) {
      setError("テーブル番号は1〜50で入力してください");
      return;
    }
    if (!/^\d{4}$/.test(pinInput)) {
      setError("PINは4桁の数字で入力してください");
      return;
    }
    try {
      localStorage.setItem(PIN_KEY, pinInput);
    } catch {
      // ignore
    }
    setTableNumber(num);
    router.replace("/menu");
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-bg-base)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm md:max-w-md bg-[color:var(--color-bg-card)] rounded-2xl border border-[color:var(--color-border)] p-8 md:p-10">
        <h1 className="text-xl font-bold text-center text-[color:var(--color-text-primary)] mb-6">
          テーブル設定
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[color:var(--color-text-muted)] mb-1">
              テーブル番号
            </label>
            <select
              required
              value={tableInput}
              onChange={(e) => { setTableInput(e.target.value); setError(""); }}
              className="w-full bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)] rounded-xl px-4 py-3 text-center text-2xl text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-soy)]"
            >
              <option value="">選択してください</option>
              {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[color:var(--color-text-muted)] mb-1">
              PIN（4桁の数字）
            </label>
            <p className="text-xs text-[color:var(--color-text-muted)] mb-2">
              テーブル番号を変更する際に必要です
            </p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              required
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
              placeholder="0000"
              className="w-full bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)] rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-soy)]"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-[color:var(--color-accent-char)] text-white py-3 rounded-xl font-bold hover:opacity-90 transition-opacity"
          >
            設定完了
          </button>
        </form>

        {error && (
          <p className="mt-4 text-center text-sm text-[color:var(--color-accent-warn)]">{error}</p>
        )}
      </div>
    </div>
  );
}
