"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";

const TABLE_ID_KEY = "gonmura-table-id";
const TABLE_KEY = "gonmura-table";

export default function SetupPage() {
  const [step, setStep] = useState<"table" | "guests">("table");
  const [tables, setTables] = useState<Array<{ id: string; tableNumber: string }>>([]);
  const [occupiedTableIds, setOccupiedTableIds] = useState<Set<string>>(new Set());
  const [loadingTables, setLoadingTables] = useState(true);
  const [selectedTable, setSelectedTable] = useState<{ id: string; tableNumber: string } | null>(null);
  const [guestCountInput, setGuestCountInput] = useState(1);
  const { setTableNumber, setGuestCount } = useCart();
  const router = useRouter();

  useEffect(() => {
    const tableId = typeof window !== "undefined" ? localStorage.getItem(TABLE_ID_KEY) : null;
    const tableNum = (() => {
      try {
        const r = localStorage.getItem(TABLE_KEY);
        return r && r !== "null" ? JSON.parse(r) : null;
      } catch { return null; }
    })();
    if (tableId && tableNum) {
      router.replace("/menu");
      return;
    }

    async function load() {
      try {
        const [tablesSnap, ordersSnap] = await Promise.all([
          getDocs(query(collection(db, "tables"), orderBy("tableNumber"))),
          getDocs(query(collectionGroup(db, "orders"), where("status", "in", ["pending", "completed"]))),
        ]);

        const customerIds = [...new Set(
          ordersSnap.docs
            .filter((d) => d.ref.parent.parent !== null)
            .map((d) => d.ref.parent.parent!.id)
        )];

        const occupied = new Set<string>();
        if (customerIds.length > 0) {
          const customerDocs = await Promise.all(customerIds.map((id) => getDoc(doc(db, "customers", id))));
          for (const snap of customerDocs) {
            if (snap.exists()) {
              const tid = snap.data().tableId;
              if (tid) occupied.add(tid);
            }
          }
        }

        setOccupiedTableIds(occupied);
        setTables(tablesSnap.docs.map((d) => ({
          id: d.id,
          tableNumber: d.data().tableNumber as string,
        })));
      } catch {}
      setLoadingTables(false);
    }
    load();
  }, [router]);

  function handleSelectTable(t: { id: string; tableNumber: string }) {
    setSelectedTable(t);
    setGuestCountInput(1);
    setStep("guests");
  }

  function handleConfirm() {
    if (!selectedTable) return;
    localStorage.setItem(TABLE_ID_KEY, selectedTable.id);
    setTableNumber(selectedTable.tableNumber);
    setGuestCount(guestCountInput);
    router.replace("/menu");
  }

  if (loadingTables) {
    return (
      <div className="min-h-screen bg-[color:var(--color-bg-base)] flex items-center justify-center">
        <p className="text-[color:var(--color-text-muted)]">読み込み中...</p>
      </div>
    );
  }

  if (step === "guests" && selectedTable) {
    return (
      <div className="h-[100dvh] flex flex-col bg-[color:var(--color-bg-base)]">
        <header className="sticky top-0 z-10 bg-[color:var(--color-bg-base)] border-b border-[color:var(--color-border)]">
          <div className="flex items-center gap-3 px-4 sm:px-6 py-3">
            <button
              type="button"
              onClick={() => setStep("table")}
              aria-label="テーブル選択に戻る"
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full bg-[color:var(--color-bg-card)] text-[color:var(--color-text-primary)] border border-[color:var(--color-border)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.5 4.5L6 11l6.5 6.5" />
              </svg>
            </button>
            <h1 className="text-base font-bold text-[color:var(--color-text-primary)]">
              テーブル {selectedTable.tableNumber}
            </h1>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-sm">
            <p className="text-sm text-center text-[color:var(--color-text-muted)] mb-8">
              何名様ですか？
            </p>
            <div className="flex items-center justify-center gap-8 mb-8">
              <button
                type="button"
                onClick={() => setGuestCountInput((n) => Math.max(1, n - 1))}
                className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[color:var(--color-border)] text-3xl font-bold text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
              >
                −
              </button>
              <span className="w-20 text-center text-5xl font-black text-[color:var(--color-text-primary)] tabular-nums">
                {guestCountInput}
              </span>
              <button
                type="button"
                onClick={() => setGuestCountInput((n) => n + 1)}
                className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[color:var(--color-border)] text-3xl font-bold text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
              >
                ＋
              </button>
            </div>
            <button
              type="button"
              onClick={handleConfirm}
              className="w-full bg-[color:var(--color-accent-char)] text-white py-4 rounded-xl text-lg font-bold hover:opacity-90 transition-opacity"
            >
              注文を開始する
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-bg-base)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[color:var(--color-bg-card)] rounded-2xl border border-[color:var(--color-border)] p-8">
        <h1 className="text-xl font-bold text-center text-[color:var(--color-text-primary)] mb-6">
          テーブルを選択
        </h1>
        {tables.length === 0 ? (
          <p className="text-center text-sm text-[color:var(--color-text-muted)] py-8">
            登録済みのテーブルがありません。<br />管理者にお問い合わせください。
          </p>
        ) : (
          <div className="space-y-4">
            <select
              value={selectedTable?.id ?? ""}
              onChange={(e) => {
                setSelectedTable(tables.find((t) => t.id === e.target.value) ?? null);
              }}
              className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-xl px-4 py-3 text-base text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            >
              <option value="">テーブルを選択してください</option>
              {tables.map((t) => {
                const isOccupied = occupiedTableIds.has(t.id);
                return (
                  <option key={t.id} value={t.id}>
                    {t.tableNumber}番{isOccupied ? "（使用中）" : "（空き）"}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              disabled={!selectedTable}
              onClick={() => { if (selectedTable) { setGuestCountInput(1); setStep("guests"); } }}
              className="w-full bg-[color:var(--color-accent-char)] text-white py-4 rounded-xl text-lg font-bold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              次へ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
