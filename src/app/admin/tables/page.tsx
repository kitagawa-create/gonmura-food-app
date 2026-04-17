"use client";

import { useEffect, useState, useCallback } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { useToast } from "@/components/ui/Snackbar";
import type { Customer, TableConfig } from "@/types";

const TABLE_COUNT = 50;

export default function AdminTablesPage() {
  const [tableNames, setTableNames] = useState<Map<number, string>>(new Map());
  const [activeCustomers, setActiveCustomers] = useState<Customer[]>([]);
  const [editingTable, setEditingTable] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [moveSource, setMoveSource] = useState<{ tableNumber: number; customerId: string } | null>(null);
  const [moveDest, setMoveDest] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const { show: toast } = useToast();

  useEffect(() => {
    getDocs(collection(db, "tables")).then((snap) => {
      const map = new Map<number, string>();
      snap.docs.forEach((d) => {
        const data = d.data() as TableConfig;
        if (data.number && data.name) map.set(data.number, data.name);
      });
      setTableNames(map);
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, "customers"), where("status", "==", "active"));
    return onSnapshot(q, (snap) => {
      setActiveCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Customer));
    });
  }, []);

  const activeMap = new Map(activeCustomers.map((c) => [c.tableNumber, c]));

  function startEdit(num: number) {
    setEditingTable(num);
    setEditingName(tableNames.get(num) ?? "");
  }

  async function saveName(num: number) {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingTable(null);
      return;
    }
    setSaving(true);
    try {
      await setDoc(doc(db, "tables", String(num)), { number: num, name: trimmed }, { merge: true });
      setTableNames((prev) => new Map(prev).set(num, trimmed));
      setEditingTable(null);
      toast("保存しました");
    } catch {
      toast("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const moveTable = useCallback(async () => {
    if (!moveSource || moveDest === null || moving) return;
    setMoving(true);
    try {
      const ordersSnap = await getDocs(
        query(
          collection(db, "orders"),
          where("customerId", "==", moveSource.customerId),
          where("status", "in", ["pending", "completed"])
        )
      );
      const batch = writeBatch(db);
      batch.update(doc(db, "customers", moveSource.customerId), {
        tableNumber: moveDest,
        updatedAt: serverTimestamp(),
      });
      ordersSnap.docs.forEach((d) => {
        batch.update(d.ref, { tableNumber: moveDest, updatedAt: serverTimestamp() });
      });
      await batch.commit();
      setMoveSource(null);
      setMoveDest(null);
      toast("席を移動しました");
    } catch {
      toast("移動に失敗しました");
    } finally {
      setMoving(false);
    }
  }, [moveSource, moveDest, moving, toast]);

  const tables = Array.from({ length: TABLE_COUNT }, (_, i) => i + 1);

  return (
    <div className="w-full">
      <AdminPageHeader title="テーブル管理" subtitle="テーブル名の設定・席移動" />

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
        {tables.map((num) => {
          const customer = activeMap.get(num);
          const name = tableNames.get(num);
          const isEditing = editingTable === num;

          return (
            <div
              key={num}
              className={`rounded-xl border p-3 flex flex-col gap-2 ${
                customer
                  ? "border-[color:var(--color-accent-negi)]/40 bg-[color:var(--color-accent-negi)]/5"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[color:var(--color-text-muted)]">No.{num}</span>
                {customer ? (
                  <span className="text-[10px] font-semibold text-[color:var(--color-accent-negi)] bg-[color:var(--color-accent-negi)]/15 rounded-full px-1.5 py-0.5">
                    使用中
                  </span>
                ) : (
                  <span className="text-[10px] text-[color:var(--color-text-muted)] bg-[color:var(--color-bg-subtle)] rounded-full px-1.5 py-0.5">
                    空席
                  </span>
                )}
              </div>

              {isEditing ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName(num);
                    if (e.key === "Escape") setEditingTable(null);
                  }}
                  onBlur={() => saveName(num)}
                  maxLength={10}
                  disabled={saving}
                  placeholder={`テーブル${num}`}
                  className="w-full rounded-lg border border-[color:var(--color-accent-char)] bg-[color:var(--color-bg-subtle)] px-2 py-1 text-xs text-[color:var(--color-text-primary)] focus:outline-none"
                />
              ) : (
                <button
                  onClick={() => startEdit(num)}
                  title="クリックして名前を編集"
                  className="text-left text-sm font-semibold text-[color:var(--color-text-primary)] hover:text-[color:var(--color-accent-char)] transition-colors leading-tight min-h-[1.25rem]"
                >
                  {name ?? (
                    <span className="text-xs text-[color:var(--color-text-muted)] italic">未設定</span>
                  )}
                </button>
              )}

              {customer && (
                <div className="space-y-1.5 pt-0.5 border-t border-[color:var(--color-accent-negi)]/20">
                  <p className="text-[11px] text-[color:var(--color-text-muted)]">{customer.guestCount}名</p>
                  <button
                    onClick={() => {
                      setMoveSource({ tableNumber: num, customerId: customer.id });
                      setMoveDest(null);
                    }}
                    className="w-full text-[11px] font-medium text-[color:var(--color-accent-char)] border border-[color:var(--color-accent-char)]/40 rounded-lg px-2 py-1 hover:bg-[color:var(--color-accent-char)]/5 transition-colors"
                  >
                    席移動
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {moveSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-6">
            <h2 className="text-lg font-bold text-[color:var(--color-text-primary)] mb-1">席移動</h2>
            <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
              {tableNames.get(moveSource.tableNumber) ?? `テーブル${moveSource.tableNumber}`} の客を移動先に変更します
            </p>
            <div className="grid grid-cols-5 gap-2 mb-5 max-h-52 overflow-y-auto pr-1">
              {tables
                .filter((n) => n !== moveSource.tableNumber)
                .map((n) => {
                  const occupied = activeMap.has(n);
                  const selected = moveDest === n;
                  return (
                    <button
                      key={n}
                      onClick={() => !occupied && setMoveDest(n)}
                      disabled={occupied}
                      className={`rounded-lg border py-2 px-1 text-xs font-medium transition-colors ${
                        selected
                          ? "border-[color:var(--color-accent-char)] bg-[color:var(--color-accent-char)] text-white"
                          : occupied
                          ? "border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] text-[color:var(--color-text-muted)] opacity-40 cursor-not-allowed"
                          : "border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] text-[color:var(--color-text-primary)] hover:border-[color:var(--color-accent-char)]"
                      }`}
                    >
                      {tableNames.get(n) ? (
                        <span className="block truncate leading-tight">{tableNames.get(n)}</span>
                      ) : (
                        <span>{n}</span>
                      )}
                    </button>
                  );
                })}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setMoveSource(null); setMoveDest(null); }}
                className="flex-1 rounded-xl border border-[color:var(--color-border)] py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
              >
                キャンセル
              </button>
              <button
                onClick={moveTable}
                disabled={moveDest === null || moving}
                className="flex-1 rounded-xl bg-[color:var(--color-accent-char)] py-2.5 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {moving ? "移動中..." : "移動する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
