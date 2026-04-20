"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";

const DEVICE_ID_KEY = "gonmura-device-id";
const TABLE_ID_KEY = "gonmura-table-id";

function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export default function SetupPage() {
  const [selectedTableId, setSelectedTableId] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tables, setTables] = useState<Array<{ id: string; tableNumber: string }>>([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const { setTableNumber } = useCart();
  const router = useRouter();

  useEffect(() => {
    async function init() {
      const existingId = typeof window !== "undefined" ? localStorage.getItem(TABLE_ID_KEY) : null;

      if (existingId) {
        try {
          const snap = await getDoc(doc(db, "tables", existingId));
          if (snap.exists() && snap.data().deviceId) {
            router.replace("/menu");
            return;
          }
          // ドキュメントが削除 or 管理者にリセットされた場合はローカルをクリア
          localStorage.removeItem(TABLE_ID_KEY);
        } catch {
          localStorage.removeItem(TABLE_ID_KEY);
        }
      }

      try {
        const snap = await getDocs(query(collection(db, "tables"), where("deviceId", "==", "")));
        setTables(
          snap.docs
            .map((d) => ({ id: d.id, tableNumber: d.data().tableNumber as string }))
            .sort((a, b) => a.tableNumber.localeCompare(b.tableNumber, "ja", { numeric: true }))
        );
      } catch {}
      setLoadingTables(false);
    }

    init();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTableId) {
      setError("テーブルを選択してください");
      return;
    }
    if (!/^\d{4}$/.test(pinInput)) {
      setError("PINは4桁の数字で入力してください");
      return;
    }
    setSaving(true);
    try {
      const deviceId = getOrCreateDeviceId();
      await updateDoc(doc(db, "tables", selectedTableId), {
        deviceId,
        pin: pinInput,
        updatedAt: serverTimestamp(),
      });
      localStorage.setItem(TABLE_ID_KEY, selectedTableId);
      const selected = tables.find((t) => t.id === selectedTableId);
      if (selected) setTableNumber(selected.tableNumber);
      router.replace("/menu");
    } catch {
      setError("セットアップに失敗しました。再試行してください");
      setSaving(false);
    }
  }

  if (loadingTables) {
    return (
      <div className="min-h-screen bg-[color:var(--color-bg-base)] flex items-center justify-center">
        <p className="text-[color:var(--color-text-muted)]">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-bg-base)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm md:max-w-md bg-[color:var(--color-bg-card)] rounded-2xl border border-[color:var(--color-border)] p-8 md:p-10">
        <h1 className="text-xl font-bold text-center text-[color:var(--color-text-primary)] mb-6">
          テーブル設定
        </h1>

        {tables.length === 0 ? (
          <p className="text-center text-sm text-[color:var(--color-text-muted)] py-8">
            利用可能なテーブルがありません。<br />管理者にお問い合わせください。
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-[color:var(--color-text-muted)] mb-1">
                テーブル番号
              </label>
              <select
                required
                value={selectedTableId}
                onChange={(e) => { setSelectedTableId(e.target.value); setError(""); }}
                className="w-full bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)] rounded-xl px-4 py-3 text-center text-2xl text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-soy)]"
              >
                <option value="">選択してください</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>{t.tableNumber}</option>
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
              disabled={saving}
              className="w-full bg-[color:var(--color-accent-char)] text-white py-3 rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? "設定中..." : "設定完了"}
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 text-center text-sm text-[color:var(--color-accent-warn)]">{error}</p>
        )}
      </div>
    </div>
  );
}
