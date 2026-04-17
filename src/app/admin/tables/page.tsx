"use client";

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  addDoc,
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
import { useToast } from "@/components/ui/Snackbar";

const PIN_KEY = "gonmura-table-pin";

export default function AdminTablesPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Table | null>(null);
  const [editTarget, setEditTarget] = useState<Table | null>(null);
  const [editNameDraft, setEditNameDraft] = useState("");
  const [addName, setAddName] = useState("");
  const [addNumber, setAddNumber] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [pinSaved, setPinSaved] = useState(false);
  const { show } = useToast();

  useEffect(() => {
    const pin = localStorage.getItem(PIN_KEY) ?? "";
    setCurrentPin(pin);
    setPinDraft(pin);
  }, []);

  useEffect(() => {
    const q = query(collection(db, "tables"), orderBy("number", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTables(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Table, "id">) }))
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const handleAddTable = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setAddError(null);
      const name = addName.trim();
      if (!name) {
        setAddError("テーブル名を入力してください");
        return;
      }
      const n = parseInt(addNumber, 10);
      if (isNaN(n) || n < 1) {
        setAddError("テーブル番号は1以上の整数で入力してください");
        return;
      }
      if (tables.some((t) => t.number === n)) {
        setAddError("この番号は既に使われています");
        return;
      }
      try {
        await addDoc(collection(db, "tables"), {
          name,
          number: n,
          guestCount: null,
          sessionStartedAt: null,
          createdAt: serverTimestamp(),
        });
        setAddName("");
        setAddNumber("");
        show(`テーブル「${name}」を追加しました`);
      } catch {
        setAddError("追加に失敗しました");
      }
    },
    [addName, addNumber, tables, show]
  );

  const handleEditSave = useCallback(async () => {
    if (!editTarget) return;
    const name = editNameDraft.trim();
    if (!name) return;
    try {
      await updateDoc(doc(db, "tables", editTarget.id), { name });
      show("テーブル名を更新しました");
      setEditTarget(null);
    } catch {
      show("更新に失敗しました");
    }
  }, [editTarget, editNameDraft, show]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, "tables", deleteTarget.id));
      show(`テーブル「${deleteTarget.name}」を削除しました`);
    } catch {
      show("削除に失敗しました");
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, show]);

  const handleResetSession = useCallback(
    async (table: Table) => {
      try {
        await updateDoc(doc(db, "tables", table.id), {
          guestCount: null,
          sessionStartedAt: null,
        });
        show(`「${table.name}」のセッションをリセットしました`);
      } catch {
        show("リセットに失敗しました");
      }
    },
    [show]
  );

  const handleSavePin = useCallback(() => {
    if (!/^\d{4}$/.test(pinDraft)) {
      show("PINは4桁の数字で入力してください");
      return;
    }
    localStorage.setItem(PIN_KEY, pinDraft);
    setCurrentPin(pinDraft);
    setPinSaved(true);
    setTimeout(() => setPinSaved(false), 1600);
  }, [pinDraft, show]);

  return (
    <div className="w-full max-w-3xl space-y-6">
      <AdminPageHeader
        title="テーブル管理"
        subtitle="テーブルを追加・編集し、お客様のテーブル選択に表示される名前を設定します。"
      />

      {/* テーブル一覧 */}
      <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-[color:var(--color-text-primary)]">
          テーブル一覧
        </h2>
        {loading ? (
          <p className="text-sm text-[color:var(--color-text-muted)]">読み込み中...</p>
        ) : tables.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)]">
            テーブルがありません。下のフォームから追加してください。
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-border)]">
            {tables.map((table) => (
              <li key={table.id} className="flex items-center gap-3 py-3">
                {editTarget?.id === table.id ? (
                  <>
                    <input
                      type="text"
                      value={editNameDraft}
                      onChange={(e) => setEditNameDraft(e.target.value)}
                      autoFocus
                      className="flex-1 rounded-lg border border-[color:var(--color-accent-char)] bg-[color:var(--color-bg-base)] px-3 py-1.5 text-sm text-[color:var(--color-text-primary)] focus:outline-none"
                    />
                    <button
                      onClick={handleEditSave}
                      className="rounded-lg bg-[color:var(--color-accent-char)] px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setEditTarget(null)}
                      className="rounded-lg border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:opacity-80"
                    >
                      キャンセル
                    </button>
                  </>
                ) : (
                  <>
                    <span className="inline-flex h-8 min-w-[40px] items-center justify-center rounded-md bg-[color:var(--color-accent-char)] px-2 text-sm font-bold text-white">
                      {table.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[color:var(--color-text-primary)]">
                        {table.name}
                      </p>
                      <p className="text-xs text-[color:var(--color-text-muted)]">
                        {table.guestCount != null
                          ? `${table.guestCount}名様 使用中`
                          : "待機中（未使用）"}
                      </p>
                    </div>
                    <button
                      onClick={() => handleResetSession(table)}
                      title="セッションリセット（精算後の人数をリセット）"
                      className="rounded-lg border border-[color:var(--color-border)] px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
                    >
                      リセット
                    </button>
                    <button
                      onClick={() => {
                        setEditTarget(table);
                        setEditNameDraft(table.name);
                      }}
                      className="rounded-lg border border-[color:var(--color-border)] px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => setDeleteTarget(table)}
                      className="rounded-lg border border-[color:var(--color-accent-warn)]/40 px-2 py-1 text-xs text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10"
                    >
                      削除
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* テーブル追加 */}
      <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-[color:var(--color-text-primary)]">
          新規テーブルを追加
        </h2>
        {addError && (
          <p className="mb-3 text-sm text-[color:var(--color-accent-warn)]">{addError}</p>
        )}
        <form onSubmit={handleAddTable} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[color:var(--color-text-muted)]">
              番号
            </label>
            <input
              type="number"
              min="1"
              value={addNumber}
              onChange={(e) => setAddNumber(e.target.value)}
              placeholder="例: 1"
              className="w-24 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-base)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            />
          </div>
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-xs font-medium text-[color:var(--color-text-muted)]">
              テーブル名
            </label>
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="例: 1番テーブル、窓際A席"
              maxLength={30}
              className="w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-base)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            />
          </div>
          <button
            type="submit"
            className="rounded-xl bg-[color:var(--color-accent-char)] px-5 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            追加
          </button>
        </form>
      </section>

      {/* PIN 設定 */}
      <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-[color:var(--color-text-primary)]">
          テーブル変更用 PIN
        </h2>
        <p className="mb-3 text-xs text-[color:var(--color-text-muted)]">
          お客様がテーブルを変更するときに求められます。現在:{" "}
          {currentPin ? "設定済み" : "未設定（デフォルト: 1234）"}
        </p>
        <div className="flex items-center gap-3">
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pinDraft}
            onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="4桁の数字"
            className="w-32 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-base)] px-3 py-2 text-lg tracking-[0.3em] text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
          />
          <button
            type="button"
            onClick={handleSavePin}
            className="rounded-xl bg-[color:var(--color-accent-char)] px-5 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            保存
          </button>
          {pinSaved && (
            <span className="rounded-full border border-[color:var(--color-accent-negi)]/40 bg-[color:var(--color-accent-negi)]/15 px-2 py-0.5 text-xs text-[color:var(--color-accent-negi)]">
              保存しました
            </span>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`テーブル「${deleteTarget?.name}」を削除`}
        message={`テーブル番号 ${deleteTarget?.number} を削除します。この操作は取り消せません。`}
        confirmLabel="削除する"
        confirmColor="red"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
