"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-context";

const TABLE_LOCKED_KEY = "gonmura-table-locked";

export default function SetupPage() {
  const [tableInput, setTableInput] = useState("");
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const { tableNumber, setTableNumber } = useCart();
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setLocked(localStorage.getItem(TABLE_LOCKED_KEY) === "1");
  }, []);

  function handleTableSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseInt(tableInput, 10);
    if (isNaN(num) || num <= 0) {
      setError("正しいテーブル番号を入力してください");
      return;
    }
    setTableNumber(num);
    router.replace("/menu");
  }

  // ロック中で番号も設定済みなら、編集 UI を出さず番号表示と店員呼び出し導線のみ
  if (locked && tableNumber !== null) {
    return (
      <div className="min-h-screen bg-[color:var(--color-bg-base)] flex items-center justify-center p-4">
        <div className="w-full max-w-sm md:max-w-md bg-[color:var(--color-bg-card)] rounded-2xl border border-[color:var(--color-border)] p-8 md:p-10 text-center space-y-4">
          <p className="text-sm text-[color:var(--color-text-muted)]">こちらは</p>
          <p className="text-5xl font-bold text-[color:var(--color-text-primary)]">
            {tableNumber}番
          </p>
          <p className="text-sm text-[color:var(--color-text-muted)]">テーブルです</p>
          <p className="text-xs text-[color:var(--color-text-muted)] pt-4 border-t border-[color:var(--color-border)]">
            番号を変更したい場合は店員までお声がけください
          </p>
          <button
            type="button"
            onClick={() => router.replace("/menu")}
            className="w-full bg-[color:var(--color-accent-char)] text-white py-3 rounded-xl font-bold hover:opacity-90 transition-opacity"
          >
            メニューを見る
          </button>
        </div>
      </div>
    );
  }

  // ロック中で番号未設定: フォールバック (店員呼び出し導線)
  if (locked && tableNumber === null) {
    return (
      <div className="min-h-screen bg-[color:var(--color-bg-base)] flex items-center justify-center p-4">
        <div className="w-full max-w-sm md:max-w-md bg-[color:var(--color-bg-card)] rounded-2xl border border-[color:var(--color-border)] p-8 md:p-10 text-center space-y-3">
          <p className="text-lg font-bold text-[color:var(--color-text-primary)]">
            テーブル番号が未設定です
          </p>
          <p className="text-sm text-[color:var(--color-text-muted)]">
            お手数ですが店員までお声がけください
          </p>
        </div>
      </div>
    );
  }

  // 通常 (ロック解除中): 編集可
  return (
    <div className="min-h-screen bg-[color:var(--color-bg-base)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm md:max-w-md bg-[color:var(--color-bg-card)] rounded-2xl border border-[color:var(--color-border)] p-8 md:p-10">
        <h1 className="text-xl font-bold text-center text-[color:var(--color-text-primary)] mb-6">
          テーブル設定
        </h1>

        <form onSubmit={handleTableSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[color:var(--color-text-muted)] mb-1">
              テーブル番号
            </label>
            <input
              type="number"
              min="1"
              required
              value={tableInput}
              onChange={(e) => setTableInput(e.target.value)}
              placeholder="例: 5"
              className="w-full bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)] rounded-xl px-4 py-3 text-center text-2xl text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-soy)]"
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
