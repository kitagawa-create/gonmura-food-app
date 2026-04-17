"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminRole } from "@/components/admin/AdminContext";
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
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { PageLoader } from "@/components/ui/PageLoader";
import { useToast } from "@/components/ui/Snackbar";
import type { Category } from "@/types";

export default function AdminCategoriesPage() {
  const role = useAdminRole();
  const router = useRouter();
  const { show: toast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [addNameError, setAddNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 並び替え状態 (DnD + 長押し→タップ移動)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);

  // 削除確認ダイアログ
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (role !== "owner") router.replace("/admin/orders");
  }, [role, router]);

  useEffect(() => {
    const q = query(collection(db, "categories"), orderBy("sortOrder", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setCategories(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Category, "id">) }))
      );
      setLoading(false);
    });
    return unsub;
  }, []);

  function findDuplicateName(name: string, excludeId?: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const hit = categories.find(
      (c) => c.id !== excludeId && c.name.trim() === trimmed
    );
    return hit ? `「${trimmed}」は既に登録されています` : null;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const dup = findDuplicateName(trimmed);
    if (dup) {
      setAddNameError(dup);
      return;
    }
    setAddNameError(null);
    setError(null);
    try {
      // 末尾追加: 既存の最大 sortOrder + 1
      const nextOrder =
        categories.length > 0
          ? Math.max(...categories.map((c) => c.sortOrder)) + 1
          : 0;
      await addDoc(collection(db, "categories"), {
        name: trimmed,
        sortOrder: nextOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewName("");
      toast("カテゴリを追加しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加に失敗しました。");
      toast("追加に失敗しました");
    }
  }

  async function handleRename(id: string, name: string) {
    setError(null);
    try {
      await updateDoc(doc(db, "categories", id), {
        name: name.trim(),
        updatedAt: serverTimestamp(),
      });
      toast("カテゴリを更新しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました。");
      toast("更新に失敗しました");
    }
  }

  async function requestDelete(category: Category) {
    setError(null);
    const menusQ = query(
      collection(db, "menus"),
      where("categoryIds", "array-contains", category.id)
    );
    const referenced = await getDocs(menusQ);
    if (!referenced.empty) {
      setError(
        `このカテゴリは ${referenced.size} 件のメニューから参照されているため削除できません。`
      );
      return;
    }
    setDeleteTarget(category);
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteDoc(doc(db, "categories", deleteTarget.id));
      setDeleteTarget(null);
      toast("カテゴリを削除しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました。");
      toast("削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }

  // 並び替えを Firestore へ反映 (writeBatchで原子的に)
  async function persistOrder(ordered: Category[]) {
    setSavingOrder(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      ordered.forEach((c, i) => {
        if (c.sortOrder !== i) {
          batch.update(doc(db, "categories", c.id), {
            sortOrder: i,
            updatedAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "並び順の保存に失敗しました。");
    } finally {
      setSavingOrder(false);
    }
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const fromIdx = categories.findIndex((c) => c.id === draggingId);
    const toIdx = categories.findIndex((c) => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;

    const next = [...categories];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setCategories(next);
    setDraggingId(null);
    setDragOverId(null);
    persistOrder(next);
  }

  // 長押し→タップ移動: 選択中の項目を targetId の位置に移動
  function handleTapMove(targetId: string) {
    if (!movingId || movingId === targetId) {
      setMovingId(null);
      return;
    }
    const fromIdx = categories.findIndex((c) => c.id === movingId);
    const toIdx = categories.findIndex((c) => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...categories];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setCategories(next);
    setMovingId(null);
    persistOrder(next);
  }

  if (role !== "owner") return null;

  return (
    <div className="w-full">
      <AdminPageHeader title="カテゴリ管理" />

      {error && (
        <p className="mb-4 rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 text-sm text-[color:var(--color-accent-warn)]">
          {error}
        </p>
      )}

      <form
        onSubmit={handleAdd}
        className="mb-6 flex flex-wrap items-start gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-4 shadow-sm"
      >
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs text-[color:var(--color-text-muted)]">名前</label>
          <input
            className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            maxLength={20}
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (addNameError) setAddNameError(null);
            }}
            placeholder="例: 丼もの"
          />
          {addNameError && (
            <p className="mt-1 text-sm text-[color:var(--color-accent-warn)]">
              {addNameError}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={!newName.trim() || addNameError !== null}
          className="mt-5 rounded-xl bg-[color:var(--color-accent-char)] px-4 py-2 text-sm text-white font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          追加
        </button>
      </form>

      {loading ? (
        <PageLoader />
      ) : categories.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">カテゴリがまだありません。</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-[color:var(--color-text-muted)]">
            {movingId ? "移動先をタップしてください" : "長押しで並び替え"}{savingOrder && " (保存中...)"}
          </p>
          <ul className="space-y-2">
            {categories.map((c, i) => (
              <CategoryRow
                key={c.id}
                index={i}
                category={c}
                isDragging={draggingId === c.id}
                isDragOver={dragOverId === c.id && draggingId !== c.id}
                isMoving={movingId === c.id}
                isMoveTarget={movingId !== null && movingId !== c.id}
                onDragStart={() => setDraggingId(c.id)}
                onDragEnter={() => setDragOverId(c.id)}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragOverId(null);
                }}
                onDrop={() => handleDrop(c.id)}
                onLongPress={() => setMovingId(c.id)}
                onTapMove={() => handleTapMove(c.id)}
                onRename={(name) => handleRename(c.id, name)}
                onDelete={() => requestDelete(c)}
                findDuplicate={findDuplicateName}
              />
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="カテゴリの削除"
        message={`「${deleteTarget?.name}」を削除しますか？`}
        warning="この操作は取り消せません。"
        confirmLabel="削除"
        confirmColor="red"
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  );
}

function CategoryRow({
  index,
  category,
  isDragging,
  isDragOver,
  isMoving,
  isMoveTarget,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  onLongPress,
  onTapMove,
  onRename,
  onDelete,
  findDuplicate,
}: {
  index: number;
  category: Category;
  isDragging: boolean;
  isDragOver: boolean;
  isMoving: boolean;
  isMoveTarget: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onLongPress: () => void;
  onTapMove: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
  findDuplicate: (name: string, excludeId?: string) => string | null;
}) {
  const [name, setName] = useState(category.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setName(category.name);
    setNameError(null);
    setEditing(false);
  }, [category]);

  const trimmed = name.trim();
  const dirty = trimmed !== category.name.trim();

  function handleSave() {
    if (!dirty || !trimmed) {
      setEditing(false);
      setName(category.name);
      return;
    }
    const dup = findDuplicate(trimmed, category.id);
    if (dup) {
      setNameError(dup);
      return;
    }
    setNameError(null);
    onRename(trimmed);
    setEditing(false);
  }

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      onTouchStart={() => {
        longPressTimer.current = setTimeout(() => {
          onLongPress();
          longPressTimer.current = null;
        }, 400);
      }}
      onTouchEnd={() => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
          if (isMoveTarget) onTapMove();
        }
      }}
      onTouchMove={() => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }}
      onClick={() => { if (isMoveTarget) onTapMove(); }}
      className={`rounded-xl border bg-[color:var(--color-bg-card)] p-3 shadow-sm transition-all select-none ${
        isDragging ? "opacity-40" : ""
      } ${isMoving ? "border-[color:var(--color-accent-char)] ring-2 ring-[color:var(--color-accent-char)]/30 bg-[color:var(--color-accent-char)]/5" : ""}${
        isMoveTarget ? " cursor-pointer" : ""
      } ${
        isDragOver
          ? "border-[color:var(--color-accent-char)] ring-2 ring-[color:var(--color-accent-char)]/30"
          : isMoving ? "" : "border-[color:var(--color-border)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="select-none px-2 text-[color:var(--color-text-muted)]"
          title="長押しで並び替え"
        >
          ⠿
        </span>
        <span className="w-8 shrink-0 text-right text-sm tabular-nums text-[color:var(--color-text-muted)]">
          {index + 1}.
        </span>
        {editing ? (
          <input
            autoFocus
            className="flex-1 rounded border border-[color:var(--color-accent-char)] bg-[color:var(--color-bg-base)] px-2 py-1 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            maxLength={20}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") { setEditing(false); setName(category.name); }
            }}
          />
        ) : (
          <span className="flex-1 px-2 py-1 text-sm text-[color:var(--color-text-primary)]">
            {category.name}
          </span>
        )}
        {editing ? (
          <button
            onClick={handleSave}
            className="rounded-lg bg-[color:var(--color-accent-char)] px-2 py-1 text-xs text-white hover:bg-[color:var(--color-accent-char-hover)] transition-colors"
          >
            保存
          </button>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg border border-[color:var(--color-border)] px-2 py-1 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
          >
            編集
          </button>
        )}
        <button
          onClick={onDelete}
          className="rounded-lg bg-[color:var(--color-accent-warn)] px-2 py-1 text-xs text-white hover:opacity-90 transition-colors"
        >
          削除
        </button>
      </div>
      {nameError && (
        <p className="mt-2 pl-8 text-sm text-[color:var(--color-accent-warn)]">
          {nameError}
        </p>
      )}
    </li>
  );
}
