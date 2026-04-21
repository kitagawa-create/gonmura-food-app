"use client";

import { useEffect, useState, useCallback } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
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
  const [showAddDialog, setShowAddDialog] = useState(false);

  const [showChangePinDialog, setShowChangePinDialog] = useState(false);
  const [changePinInput, setChangePinInput] = useState("");
  const [changePinError, setChangePinError] = useState("");
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

  async function handleAddTable(tableNumber: string) {
    const dup = await getDocs(query(collection(db, "tables"), where("tableNumber", "==", tableNumber)));
    if (!dup.empty) throw new Error("このテーブル番号はすでに登録されています");
    const tableRef = doc(collection(db, "tables"));
    await setDoc(tableRef, {
      id: tableRef.id,
      tableNumber,
      deviceId: "",
      pin: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    toast("テーブルを追加しました");
  }

  async function changeAllPins() {
    if (!/^\d{4}$/.test(changePinInput)) {
      setChangePinError("4桁の数字で入力してください");
      return;
    }
    setSavingPin(true);
    try {
      const batch = writeBatch(db);
      for (const table of tables) {
        batch.update(doc(db, "tables", table.id), { pin: changePinInput, updatedAt: serverTimestamp() });
      }
      await batch.commit();
      toast("PINを変更しました");
      setShowChangePinDialog(false);
      setChangePinInput("");
      setChangePinError("");
    } catch {
      toast("PINの変更に失敗しました");
    } finally {
      setSavingPin(false);
    }
  }

  const confirmReset = useCallback(async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      await updateDoc(doc(db, "tables", resetTarget.id), { deviceId: "", pin: "", updatedAt: serverTimestamp() });
      toast("端末の紐付けを解除しました");
      setResetTarget(null);
    } catch {
      toast("紐付け解除に失敗しました");
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
  const currentPin = tables.length > 0
    ? (tables.every(t => t.pin === tables[0].pin) ? tables[0].pin : null)
    : null;

  return (
    <div className="w-full">
      <AdminPageHeader
        title="テーブル管理"
        rightSlot={
          <div className="flex gap-2">
            <button
              onClick={() => { setShowChangePinDialog(true); setChangePinInput(""); setChangePinError(""); }}
              className="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm text-[color:var(--color-text-muted)] font-bold hover:bg-[color:var(--color-bg-subtle)] transition-colors"
            >
              PIN変更
            </button>
            <button
              onClick={() => setShowAddDialog(true)}
              className="rounded-lg bg-[color:var(--color-accent-char)] px-4 py-2 text-sm text-white font-bold hover:opacity-90 transition-opacity"
            >
              ＋ テーブル追加
            </button>
          </div>
        }
      />

      {tables.length > 0 && (
        <div className="mb-6 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] px-5 py-4">
          <p className="text-xs text-[color:var(--color-text-muted)] mb-1">現在のPINコード（全テーブル共通）</p>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-mono font-bold tracking-[0.3em] text-[color:var(--color-text-primary)]">
              {currentPin ? currentPin : "----"}
            </span>
            {currentPin === null && (
              <span className="text-xs text-[color:var(--color-accent-warn)]">テーブルによって異なります</span>
            )}
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-lg font-bold text-[color:var(--color-text-primary)] truncate">
                    {table.tableNumber}
                  </p>
                  {unclaimed(table) && (
                    <span className="shrink-0 rounded-full bg-[color:var(--color-accent-negi)]/15 px-2 py-0.5 text-xs text-[color:var(--color-accent-negi)] font-medium">
                      未登録
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {!unclaimed(table) && (
                    <button
                      onClick={() => setResetTarget(table)}
                      className="rounded-lg border border-[color:var(--color-border)] px-3 py-1 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
                    >
                      端末とテーブルの紐付け解除
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
            </div>
          ))}
        </div>
      )}

      {showChangePinDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] shadow-xl p-6">
            <h2 className="text-lg font-bold text-[color:var(--color-text-primary)] mb-1">PINコードを変更</h2>
            <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
              全{tables.length}テーブルに新しいPINを設定します
            </p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              autoFocus
              value={changePinInput}
              onChange={(e) => { setChangePinInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setChangePinError(""); }}
              placeholder="4桁の数字"
              className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)] mb-2"
            />
            {changePinError && (
              <p className="text-xs text-[color:var(--color-accent-warn)] mb-2">{changePinError}</p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => setShowChangePinDialog(false)}
                className="flex-1 rounded-xl border border-[color:var(--color-border)] py-2.5 text-sm text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={changeAllPins}
                disabled={savingPin || changePinInput.length !== 4}
                className="flex-1 rounded-xl bg-[color:var(--color-accent-char)] py-2.5 text-sm text-white font-bold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingPin ? "変更中..." : "変更する"}
              </button>
            </div>
          </div>
        </div>
      )}
      <TableAddDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onAdd={handleAddTable}
      />
      <ConfirmDialog
        open={resetTarget !== null}
        title={`テーブル ${resetTarget?.tableNumber} の端末紐付けを解除`}
        message="このテーブルの端末紐付けを解除します。タブレット側は再セットアップが必要になります。"
        confirmLabel="解除する"
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

function TableAddDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (tableNumber: string) => Promise<void>;
}) {
  const [tableNumber, setTableNumber] = useState("");
  const [tableError, setTableError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTableNumber("");
      setTableError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = tableNumber.trim();
    if (!trimmed) return;
    setTableError(null);
    setSaving(true);
    try {
      await onAdd(trimmed);
      onClose();
    } catch (e) {
      setTableError(e instanceof Error ? e.message : "追加に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="relative flex w-full max-w-sm flex-col rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="absolute top-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="shrink-0 border-b border-[color:var(--color-border)] px-6 py-4 pr-16">
          <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">テーブル追加</h2>
        </div>

        <div className="px-6 py-4">
          <div className="mb-1 flex items-center gap-1.5">
            <label className="block text-xs text-[color:var(--color-text-muted)]">テーブル番号</label>
            <span className="text-[10px] font-medium text-white bg-[color:var(--color-accent-warn)] rounded px-1 py-0.5 leading-none">必須</span>
          </div>
          <input
            autoFocus
            type="text"
            maxLength={10}
            value={tableNumber}
            onChange={(e) => { setTableNumber(e.target.value); if (tableError) setTableError(null); }}
            placeholder="例：1, A-1, 101"
            className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
          />
          <p className={`mt-1 text-right text-xs ${tableNumber.length >= 8 ? "text-[color:var(--color-accent-warn)]" : "text-[color:var(--color-text-muted)]"}`}>
            {tableNumber.length}/10
          </p>
          {tableError && (
            <p className="mt-1 text-xs text-[color:var(--color-accent-warn)]">{tableError}</p>
          )}
        </div>

        <div className="shrink-0 flex justify-end gap-2 border-t border-[color:var(--color-border)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[color:var(--color-border)] px-4 py-2 text-sm text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={!tableNumber.trim() || saving}
            className="rounded-xl bg-[color:var(--color-accent-char)] px-4 py-2 text-sm text-white font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "追加中..." : "追加"}
          </button>
        </div>
      </form>
    </div>
  );
}
