"use client";

import { useEffect, useState, useCallback } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Table } from "@/types";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { PageLoader } from "@/components/ui/PageLoader";
import { useToast } from "@/components/ui/Snackbar";
import { useAdminRole } from "@/components/admin/AdminContext";
import { useRouter } from "next/navigation";

export default function AdminTablesPage() {
  const role = useAdminRole();
  const router = useRouter();
  const { show: toast } = useToast();
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPin, setEditingPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Table | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (role !== "owner") router.replace("/admin/orders");
  }, [role, router]);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "tables"), orderBy("tableNumber", "asc")),
      (snap) => {
        setTables(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Table, "id">) })));
        setLoading(false);
      }
    );
  }, []);

  const savePin = useCallback(async (tableId: string) => {
    if (!/^\d{4}$/.test(pinInput)) {
      setPinError("4桁の数字で入力してください");
      return;
    }
    setSavingPin(true);
    try {
      await updateDoc(doc(db, "tables", tableId), { pin: pinInput, updatedAt: serverTimestamp() });
      toast("PINを変更しました");
      setEditingPin(null);
      setPinInput("");
      setPinError("");
    } catch {
      toast("PINの変更に失敗しました");
    } finally {
      setSavingPin(false);
    }
  }, [pinInput, toast]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "tables", deleteTarget.id));
      toast("テーブルを削除しました");
      setDeleteTarget(null);
    } catch {
      toast("削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, toast]);

  if (role !== "owner") return null;
  if (loading) return <PageLoader />;

  return (
    <div className="w-full">
      <AdminPageHeader title="テーブル管理" />

      {tables.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--color-border)] py-16 text-center">
          <p className="text-sm text-[color:var(--color-text-muted)]">登録済みのテーブルはありません</p>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-1">タブレットでセットアップすると自動で追加されます</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {tables.map((table) => (
            <div
              key={table.id}
              className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-4 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-[color:var(--color-accent-char)] text-white text-2xl font-black">
                  T{table.tableNumber}
                </span>
                <button
                  onClick={() => setDeleteTarget(table)}
                  className="rounded-lg border border-[color:var(--color-border)] px-3 py-1 text-xs text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10 transition-colors"
                >
                  削除
                </button>
              </div>

              <p className="text-xs text-[color:var(--color-text-muted)] mb-1">端末ID</p>
              <p className="text-xs text-[color:var(--color-text-primary)] font-mono mb-3 truncate">
                {table.deviceId.slice(0, 8)}...
              </p>

              {role === "owner" && <p className="text-xs text-[color:var(--color-text-muted)] mb-1">PIN</p>}
              {role === "owner" && editingPin === table.id ? (
                <div className="flex gap-2 items-start">
                  <div className="flex-1">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      autoFocus
                      value={pinInput}
                      onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
                      placeholder="4桁"
                      className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
                    />
                    {pinError && <p className="text-xs text-[color:var(--color-accent-warn)] mt-1">{pinError}</p>}
                  </div>
                  <button
                    onClick={() => savePin(table.id)}
                    disabled={savingPin}
                    className="shrink-0 rounded-lg bg-[color:var(--color-accent-char)] px-3 py-1.5 text-xs text-white font-bold disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => { setEditingPin(null); setPinInput(""); setPinError(""); }}
                    className="shrink-0 rounded-lg border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)]"
                  >
                    取消
                  </button>
                </div>
              ) : role === "owner" ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono text-[color:var(--color-text-primary)] tracking-widest">
                    ••••
                  </span>
                  <button
                    onClick={() => { setEditingPin(table.id); setPinInput(""); setPinError(""); }}
                    className="rounded-lg border border-[color:var(--color-border)] px-3 py-1 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
                  >
                    変更
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`テーブル ${deleteTarget?.tableNumber} を削除`}
        message="このテーブルの設定を削除します。タブレット側は再セットアップが必要になります。"
        confirmLabel="削除する"
        confirmColor="red"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  );
}
