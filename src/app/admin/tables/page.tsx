"use client";

import { useEffect, useState, useCallback } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
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

  const [addingTable, setAddingTable] = useState(false);
  const [newTableNumber, setNewTableNumber] = useState("");
  const [addError, setAddError] = useState("");
  const [savingAdd, setSavingAdd] = useState(false);

  const [editingPin, setEditingPin] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const [resetTarget, setResetTarget] = useState<Table | null>(null);
  const [resetting, setResetting] = useState(false);
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

  const addTable = useCallback(async () => {
    const num = newTableNumber.trim();
    if (!num || num.length > 20) {
      setAddError("テーブル番号を入力してください（20文字以内）");
      return;
    }
    const dup = await getDocs(query(collection(db, "tables"), where("tableNumber", "==", num)));
    if (!dup.empty) {
      setAddError("このテーブル番号はすでに登録されています");
      return;
    }
    setSavingAdd(true);
    try {
      await addDoc(collection(db, "tables"), {
        tableNumber: num,
        deviceId: "",
        pin: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast("テーブルを追加しました");
      setAddingTable(false);
      setNewTableNumber("");
      setAddError("");
    } catch {
      toast("テーブルの追加に失敗しました");
    } finally {
      setSavingAdd(false);
    }
  }, [newTableNumber, toast]);

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

  const confirmReset = useCallback(async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      await updateDoc(doc(db, "tables", resetTarget.id), { deviceId: "", pin: "", updatedAt: serverTimestamp() });
      toast("端末の紐付けを解除しました");
      setResetTarget(null);
    } catch {
      toast("リセットに失敗しました");
    } finally {
      setResetting(false);
    }
  }, [resetTarget, toast]);

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

  const unclaimed = (t: Table) => t.deviceId === "";

  return (
    <div className="w-full">
      <AdminPageHeader
        title="テーブル管理"
        rightSlot={
          addingTable ? null : (
            <button
              onClick={() => { setAddingTable(true); setNewTableNumber(""); setAddError(""); }}
              className="rounded-lg bg-[color:var(--color-accent-char)] px-4 py-2 text-sm text-white font-bold hover:opacity-90 transition-opacity"
            >
              + テーブル追加
            </button>
          )
        }
      />

      {addingTable && (
        <div className="mb-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-4 shadow-sm">
          <p className="text-sm font-medium text-[color:var(--color-text-primary)] mb-3">新しいテーブルを追加</p>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <input
                type="text"
                value={newTableNumber}
                maxLength={20}
                onChange={(e) => { setNewTableNumber(e.target.value); setAddError(""); }}
                placeholder="例：1, A-1, テーブル1"
                className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
              />
              <p className={`mt-1 text-right text-xs ${newTableNumber.length >= 18 ? "text-[color:var(--color-accent-warn)]" : "text-[color:var(--color-text-muted)]"}`}>
                {newTableNumber.length}/20
              </p>
              {addError && <p className="text-xs text-[color:var(--color-accent-warn)] mt-1">{addError}</p>}
            </div>
            <button
              onClick={addTable}
              disabled={savingAdd}
              className="shrink-0 rounded-lg bg-[color:var(--color-accent-char)] px-3 py-2 text-sm text-white font-bold disabled:opacity-50"
            >
              追加
            </button>
            <button
              onClick={() => { setAddingTable(false); setNewTableNumber(""); setAddError(""); }}
              className="shrink-0 rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-sm text-[color:var(--color-text-muted)]"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {tables.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--color-border)] py-16 text-center">
          <p className="text-sm text-[color:var(--color-text-muted)]">登録済みのテーブルはありません</p>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-1">「テーブル追加」でテーブルを登録してください</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {tables.map((table) => (
            <div
              key={table.id}
              className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-4 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-[color:var(--color-accent-char)] text-white text-2xl font-black">
                    T{table.tableNumber}
                  </span>
                  {unclaimed(table) && (
                    <span className="rounded-full bg-[color:var(--color-accent-negi)]/15 px-2 py-0.5 text-xs text-[color:var(--color-accent-negi)] font-medium">
                      空き
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {!unclaimed(table) && (
                    <button
                      onClick={() => setResetTarget(table)}
                      className="rounded-lg border border-[color:var(--color-border)] px-3 py-1 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
                    >
                      リセット
                    </button>
                  )}
                  <button
                    onClick={() => setDeleteTarget(table)}
                    className="rounded-lg border border-[color:var(--color-border)] px-3 py-1 text-xs text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10 transition-colors"
                  >
                    削除
                  </button>
                </div>
              </div>

              {!unclaimed(table) && (
                <>
                  <p className="text-xs text-[color:var(--color-text-muted)] mb-1">端末ID</p>
                  <p className="text-xs text-[color:var(--color-text-primary)] font-mono mb-3 truncate">
                    {table.deviceId.slice(0, 8)}...
                  </p>
                </>
              )}

              {!unclaimed(table) && role === "owner" && (
                <>
                  <p className="text-xs text-[color:var(--color-text-muted)] mb-1">PIN</p>
                  {editingPin === table.id ? (
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
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono text-[color:var(--color-text-primary)] tracking-widest">
                        {table.pin}
                      </span>
                      <button
                        onClick={() => { setEditingPin(table.id); setPinInput(""); setPinError(""); }}
                        className="rounded-lg border border-[color:var(--color-border)] px-3 py-1 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
                      >
                        変更
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={resetTarget !== null}
        title={`テーブル ${resetTarget?.tableNumber} の端末をリセット`}
        message="このテーブルの端末紐付けを解除します。タブレット側は再セットアップが必要になります。"
        confirmLabel="リセットする"
        confirmColor="red"
        onConfirm={confirmReset}
        onCancel={() => setResetTarget(null)}
        loading={resetting}
      />
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
