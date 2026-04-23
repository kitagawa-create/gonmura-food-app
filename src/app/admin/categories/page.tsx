"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminRole } from "@/components/admin/AdminContext";
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
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { PageLoader } from "@/components/ui/PageLoader";
import { useToast } from "@/components/ui/Snackbar";
import type { Category } from "@/types";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export default function AdminCategoriesPage() {
  const role = useAdminRole();
  const router = useRouter();
  const { show: toast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  useEffect(() => {
    if (role !== "owner") router.replace("/admin/orders");
  }, [role, router]);

  useEffect(() => {
    const q = query(collection(db, "categories"), orderBy("sortOrder", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setCategories(
        snap.docs.map((d) => {
          const raw = d.data() as Partial<Omit<Category, "categoryId">>;
          return {
            categoryId: d.id,
            name: typeof raw.name === "string" ? raw.name : "",
            sortOrder: typeof raw.sortOrder === "number" ? raw.sortOrder : Number.MAX_SAFE_INTEGER,
            sortOrderFeatured:
              typeof raw.sortOrderFeatured === "number" ? raw.sortOrderFeatured : Number.MAX_SAFE_INTEGER,
            sortOrderSide: typeof raw.sortOrderSide === "number" ? raw.sortOrderSide : Number.MAX_SAFE_INTEGER,
            createdAt: raw.createdAt as Category["createdAt"],
            updatedAt: raw.updatedAt as Category["updatedAt"],
          };
        })
      );
      setLoading(false);
    });
    return unsub;
  }, []);

  // おすすめカテゴリだけ先頭固定、それ以外は通常カテゴリとして扱う
  const osusumeCategory = categories.find((c) => c.name === "おすすめ") ?? null;
  const otherCategories = categories.filter((c) => c.name !== "おすすめ");

  function findDuplicateName(name: string, excludeId?: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const hit = categories.find(
      (c) => c.categoryId !== excludeId && c.name.trim() === trimmed
    );
    return hit ? `「${trimmed}」は既に登録されています` : null;
  }

  async function handleAdd(name: string) {
    setError(null);
    try {
      const nextOrder =
        otherCategories.length > 0
          ? Math.max(...otherCategories.map((c) => c.sortOrder)) + 1
          : 0;
      const categoryRef = doc(collection(db, "categories"));
      await setDoc(categoryRef, {
        categoryId: categoryRef.id,
        name,
        sortOrder: nextOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast("カテゴリを追加しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加に失敗しました。");
      toast("追加に失敗しました");
      throw e;
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
      where("categoryIds", "array-contains", category.categoryId)
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
      await deleteDoc(doc(db, "categories", deleteTarget.categoryId));
      setDeleteTarget(null);
      toast("カテゴリを削除しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました。");
      toast("削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }

  // おすすめ以外の並び順を保存
  async function persistOrder(ordered: Category[]) {
    setSavingOrder(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      ordered.forEach((c, i) => {
        if (c.sortOrder !== i) {
          batch.update(doc(db, "categories", c.categoryId), {
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = otherCategories.findIndex((c) => c.categoryId === active.id);
    const newIdx = otherCategories.findIndex((c) => c.categoryId === over.id);
    const next = arrayMove(otherCategories, oldIdx, newIdx);
    setCategories([
      ...(osusumeCategory ? [osusumeCategory] : []),
      ...next,
    ]);
    persistOrder(next);
  }

  if (role !== "owner") return null;

  return (
    <div className="w-full">
      <AdminPageHeader
        title="カテゴリ管理"
        rightSlot={
          <button
            onClick={() => setShowAddDialog(true)}
            className="rounded-lg bg-[color:var(--color-accent-char)] px-4 py-2 text-sm text-white font-bold hover:opacity-90 transition-opacity"
          >
            ＋ カテゴリ追加
          </button>
        }
      />

      {error && (
        <p className="mb-4 rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 text-sm text-[color:var(--color-accent-warn)]">
          {error}
        </p>
      )}

      {loading ? (
        <PageLoader />
      ) : categories.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">カテゴリがまだありません。</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-[color:var(--color-text-muted)]">
            ハンドルをドラッグして並び替え{savingOrder && " (保存中...)"}
          </p>
          <ul className="space-y-2">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={otherCategories.map((c) => c.categoryId)} strategy={verticalListSortingStrategy}>
                {otherCategories.map((c, i) => (
                  <CategoryRow
                    key={c.categoryId}
                    index={i}
                    category={c}
                    onRename={(name) => handleRename(c.categoryId, name)}
                    onDelete={() => requestDelete(c)}
                    findDuplicate={findDuplicateName}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </ul>
        </>
      )}

      <CategoryAddDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onAdd={handleAdd}
        findDuplicate={findDuplicateName}
      />
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


function CategoryAddDialog({
  open,
  onClose,
  onAdd,
  findDuplicate,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (name: string) => Promise<void>;
  findDuplicate: (name: string) => string | null;
}) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setNameError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const dup = findDuplicate(trimmed);
    if (dup) { setNameError(dup); return; }
    setNameError(null);
    setSaving(true);
    try {
      await onAdd(trimmed);
      onClose();
    } catch {
      // エラーは親で表示済み
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
          <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">カテゴリ追加</h2>
        </div>

        <div className="px-6 py-4">
          <div className="mb-1 flex items-center gap-1.5">
            <label className="block text-xs text-[color:var(--color-text-muted)]">名前</label>
            <span className="text-[10px] font-medium text-white bg-[color:var(--color-accent-warn)] rounded px-1 py-0.5 leading-none">必須</span>
          </div>
          <input
            autoFocus
            className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            maxLength={20}
            value={name}
            onChange={(e) => { setName(e.target.value); if (nameError) setNameError(null); }}
            placeholder="例: ドリンク, デザート, セット"
          />
          <p className={`mt-1 text-right text-xs ${name.length >= 18 ? "text-[color:var(--color-accent-warn)]" : "text-[color:var(--color-text-muted)]"}`}>
            {name.length}/20
          </p>
          {nameError && (
            <p className="mt-1 text-xs text-[color:var(--color-accent-warn)]">{nameError}</p>
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
            disabled={!name.trim() || saving}
            className="rounded-xl bg-[color:var(--color-accent-char)] px-4 py-2 text-sm text-white font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "追加中..." : "追加"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CategoryRow({
  index,
  category,
  onRename,
  onDelete,
  findDuplicate,
}: {
  index: number;
  category: Category;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
  findDuplicate: (name: string, excludeId?: string) => string | null;
}) {
  const [name, setName] = useState(category.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.categoryId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const trimmed = name.trim();
  const dirty = trimmed !== category.name.trim();

  function handleSave() {
    if (!dirty || !trimmed) {
      setEditing(false);
      setName(category.name);
      return;
    }
    const dup = findDuplicate(trimmed, category.categoryId);
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
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border bg-[color:var(--color-bg-card)] p-3 shadow-sm transition-shadow ${
        isDragging
          ? "opacity-50 shadow-xl z-50"
          : "border-[color:var(--color-border)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none px-2 text-xl text-[color:var(--color-text-muted)] active:cursor-grabbing"
          title="ドラッグして並び替え"
        >
          ⠿
        </span>
        <span className="w-8 shrink-0 text-right text-sm tabular-nums text-[color:var(--color-text-muted)]">
          {index + 1}.
        </span>
        {editing ? (
          <div className="flex-1">
            <input
              autoFocus
              className="w-full rounded border border-[color:var(--color-accent-char)] bg-[color:var(--color-bg-base)] px-2 py-1 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
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
            <p className={`mt-0.5 text-right text-xs ${name.length >= 18 ? "text-[color:var(--color-accent-warn)]" : "text-[color:var(--color-text-muted)]"}`}>
              {name.length}/20
            </p>
          </div>
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
