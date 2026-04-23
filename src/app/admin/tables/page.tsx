"use client";

import { useEffect, useState, useCallback } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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

function formatElapsed(start: Date, now: Date): string {
  const mins = Math.floor((now.getTime() - start.getTime()) / 60_000);
  if (mins < 1) return "1分未満";
  if (mins < 60) return `${mins}分`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

export default function AdminTablesPage() {
  const role = useAdminRole();
  const { show: toast } = useToast();
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<Table | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Table | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "tables"), orderBy("tableNumber", "asc")),
      (snap) => {
        setTables(
          snap.docs
            .filter((d) => !d.data().deleted)
            .map((d) => ({ tableId: d.id, ...(d.data() as Omit<Table, "tableId">) }))
        );
        setLoading(false);
      }
    );
  }, []);

  async function handleAddTable(tableNumber: string) {
    const dup = await getDocs(query(collection(db, "tables"), where("tableNumber", "==", tableNumber)));
    const conflict = dup.docs.find((d) => !d.data().deleted);
    if (conflict) throw new Error("このテーブル番号はすでに登録されています");
    const tableRef = doc(collection(db, "tables"));
    await setDoc(tableRef, {
      tableId: tableRef.id,
      tableNumber,
      deviceId: "",
      deleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    toast("テーブルを追加しました");
  }

  async function handleEditTable(tableId: string, tableNumber: string) {
    const dup = await getDocs(query(collection(db, "tables"), where("tableNumber", "==", tableNumber)));
    const conflict = dup.docs.find((d) => d.id !== tableId && !d.data().deleted);
    if (conflict) throw new Error("このテーブル番号はすでに登録されています");
    await updateDoc(doc(db, "tables", tableId), {
      tableNumber,
      updatedAt: serverTimestamp(),
    });
    toast("テーブル名を更新しました");
  }

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await updateDoc(doc(db, "tables", deleteTarget.tableId), {
        deleted: true,
        updatedAt: serverTimestamp(),
      });
      toast("テーブルを削除しました");
      setDeleteTarget(null);
    } catch {
      toast("削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, toast]);

  if (loading) return <PageLoader />;

  return (
    <div className="w-full">
      <AdminPageHeader
        title="テーブル管理"
        rightSlot={
          role === "owner" ? (
            <button
              onClick={() => setShowAddDialog(true)}
              className="rounded-lg bg-[color:var(--color-accent-char)] px-4 py-2 text-sm text-white font-bold hover:opacity-90 transition-opacity"
            >
              ＋ テーブル追加
            </button>
          ) : undefined
        }
      />

      {tables.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--color-border)] py-16 text-center">
          <p className="text-sm text-[color:var(--color-text-muted)]">登録済みのテーブルはありません</p>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-1">「テーブル追加」でテーブルを登録してください</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
          {tables.map((table) => {
            const isOccupied = !!table.deviceId && table.deviceId !== "";
            return (
              <div
                key={table.tableId}
                className={`rounded-xl border p-4 shadow-sm flex flex-col gap-2 ${
                  isOccupied
                    ? "border-[color:var(--color-accent-negi)]/40 bg-[color:var(--color-accent-negi)]/5"
                    : "border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-[color:var(--color-text-primary)]">
                      {table.tableNumber}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      isOccupied
                        ? "bg-[color:var(--color-accent-negi)]/15 text-[color:var(--color-accent-negi)]"
                        : "bg-[color:var(--color-bg-subtle)] text-[color:var(--color-text-muted)]"
                    }`}>
                      {isOccupied ? "使用中" : "空き"}
                    </span>
                  </div>
                  {role === "owner" && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditTarget(table)}
                        aria-label="編集"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      {!isOccupied && (
                        <button
                          onClick={() => setDeleteTarget(table)}
                          aria-label="削除"
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--color-accent-warn)]/40 text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <p className={`text-xs text-[color:var(--color-text-muted)] ${!isOccupied ? "invisible" : ""}`}>
                  {formatElapsed(table.updatedAt.toDate(), now)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <TableAddDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onAdd={handleAddTable}
      />
      <TableEditDialog
        table={editTarget}
        onClose={() => setEditTarget(null)}
        onEdit={handleEditTable}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`テーブル ${deleteTarget?.tableNumber} を削除`}
        message="このテーブルを削除します。削除後も注文データは保持されます。"
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

function TableEditDialog({
  table,
  onClose,
  onEdit,
}: {
  table: Table | null;
  onClose: () => void;
  onEdit: (tableId: string, tableNumber: string) => Promise<void>;
}) {
  const [tableNumber, setTableNumber] = useState("");
  const [tableError, setTableError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (table) {
      setTableNumber(table.tableNumber);
      setTableError(null);
    }
  }, [table]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!table) return;
    const trimmed = tableNumber.trim();
    if (!trimmed) return;
    setTableError(null);
    setSaving(true);
    try {
      await onEdit(table.tableId, trimmed);
      onClose();
    } catch (e) {
      setTableError(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (!table) return null;

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
          <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">テーブル編集</h2>
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
            disabled={!tableNumber.trim() || tableNumber.trim() === table.tableNumber || saving}
            className="rounded-xl bg-[color:var(--color-accent-char)] px-4 py-2 text-sm text-white font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "更新中..." : "更新"}
          </button>
        </div>
      </form>
    </div>
  );
}
