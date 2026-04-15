"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { FadeImage } from "@/components/ui/FadeImage";
import { PageLoader } from "@/components/ui/PageLoader";
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
  writeBatch,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { Category, Menu } from "@/types";

type MenuFormData = {
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  categoryIds: string[];
  isAvailable: boolean;
};

const EMPTY_FORM: MenuFormData = {
  name: "",
  description: "",
  price: 0,
  imageUrl: "",
  categoryIds: [],
  isAvailable: true,
};

export default function AdminMenusPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Menu | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Menu | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [deleting, setDeleting] = useState(false);
  const [orderedMenuIds, setOrderedMenuIds] = useState<Set<string>>(new Set());
  const [orderedLoaded, setOrderedLoaded] = useState(false);
  const [draggingMenuId, setDraggingMenuId] = useState<string | null>(null);
  const [dragOverMenuId, setDragOverMenuId] = useState<string | null>(null);
  const [savingMenuOrder, setSavingMenuOrder] = useState(false);

  // 注文に含まれたことのあるメニューIDを取得（削除ボタン可否判定に使用）
  useEffect(() => {
    async function fetchOrderedMenuIds() {
      try {
        const snap = await getDocs(collection(db, "orders"));
        const ids = new Set<string>();
        for (const d of snap.docs) {
          const items = d.data().items as { menuId: string }[];
          if (items) {
            for (const item of items) {
              ids.add(item.menuId);
            }
          }
        }
        setOrderedMenuIds(ids);
      } finally {
        setOrderedLoaded(true);
      }
    }
    fetchOrderedMenuIds();
  }, []);

  useEffect(() => {
    const unsubMenus = onSnapshot(
      collection(db, "menus"),
      (snap) =>
        setMenus(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Menu, "id">) }))
        )
    );
    const unsubCats = onSnapshot(
      query(collection(db, "categories"), orderBy("sortOrder", "asc")),
      (snap) => {
        setCategories(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Category, "id">),
          }))
        );
        setLoading(false);
      }
    );
    return () => {
      unsubMenus();
      unsubCats();
    };
  }, []);

  const categoryMap = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  // カテゴリ順でメニューをグルーピング。複数カテゴリ所属のメニューは各カテゴリに重複表示する。
  const groupedMenus = useMemo(() => {
    const groups = new Map<string | null, Menu[]>();
    for (const m of menus) {
      const validCatIds = m.categoryIds.filter((cid) => categoryMap.has(cid));
      if (validCatIds.length === 0) {
        const arr = groups.get(null) ?? [];
        arr.push(m);
        groups.set(null, arr);
        continue;
      }
      for (const cid of validCatIds) {
        const arr = groups.get(cid) ?? [];
        arr.push(m);
        groups.set(cid, arr);
      }
    }
    // 各グループ内は sortOrder 昇順 (未設定は末尾)、同値は名前順
    for (const arr of groups.values()) {
      arr.sort((a, b) => {
        const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name, "ja");
      });
    }
    // セクションをカテゴリの sortOrder 順に並べ、最後に未分類
    const sections: { category: Category | null; items: Menu[] }[] = [];
    for (const c of categories) {
      const items = groups.get(c.id);
      if (items && items.length > 0) sections.push({ category: c, items });
    }
    const uncategorized = groups.get(null);
    if (uncategorized && uncategorized.length > 0) {
      sections.push({ category: null, items: uncategorized });
    }
    return sections;
  }, [menus, categories, categoryMap]);

  async function handleSave(data: MenuFormData, imageFile: File | null, id?: string) {
    setError(null);
    try {
      let imageUrl = data.imageUrl;
      if (imageFile) {
        const fileRef = ref(storage, `menus/${Date.now()}_${imageFile.name}`);
        await uploadBytes(fileRef, imageFile);
        imageUrl = await getDownloadURL(fileRef);
      }
      const saveData = {
        ...data,
        imageUrl,
        price: Math.trunc(Number(data.price)) || 0,
      };
      if (id) {
        await updateDoc(doc(db, "menus", id), {
          ...saveData,
          updatedAt: serverTimestamp(),
        });
      } else {
        // 新規: 末尾になるように既存最大 + 1
        const maxOrder = menus.reduce(
          (m, x) => Math.max(m, x.sortOrder ?? -1),
          -1
        );
        await addDoc(collection(db, "menus"), {
          ...saveData,
          sortOrder: maxOrder + 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました。");
    }
  }

  async function handleToggleAvailable(menu: Menu) {
    try {
      await updateDoc(doc(db, "menus", menu.id), {
        isAvailable: !menu.isAvailable,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました。");
    }
  }

  const persistMenuOrder = useCallback(async (orderedSectionItems: Menu[]) => {
    setSavingMenuOrder(true);
    setError(null);
    try {
      const base = orderedSectionItems.reduce(
        (m, x) => Math.min(m, x.sortOrder ?? Number.MAX_SAFE_INTEGER),
        Number.MAX_SAFE_INTEGER
      );
      const startAt = base === Number.MAX_SAFE_INTEGER ? 0 : base;
      const batch = writeBatch(db);
      orderedSectionItems.forEach((m, i) => {
        const next = startAt + i;
        if (m.sortOrder !== next) {
          batch.update(doc(db, "menus", m.id), {
            sortOrder: next,
            updatedAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "並び順の保存に失敗しました。");
    } finally {
      setSavingMenuOrder(false);
    }
  }, []);

  const handleMenuDrop = useCallback(
    (sectionItems: Menu[], targetId: string) => {
      const dragId = draggingMenuId;
      setDraggingMenuId(null);
      setDragOverMenuId(null);
      if (!dragId || dragId === targetId) return;
      const fromIdx = sectionItems.findIndex((m) => m.id === dragId);
      const toIdx = sectionItems.findIndex((m) => m.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...sectionItems];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      persistMenuOrder(next);
    },
    [draggingMenuId, persistMenuOrder]
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "menus", deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました。");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget]);

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">メニュー管理</h1>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="rounded-xl bg-orange-500 px-4 py-2 text-sm text-white font-bold hover:bg-orange-600 transition-colors"
        >
          新規追加
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* カテゴリタブ */}
      {!loading && categories.length > 0 && (
        <div className="mb-4 flex gap-1 overflow-x-auto no-scrollbar border-b border-neutral-800">
          <button
            onClick={() => setActiveTab("all")}
            className={`shrink-0 border-b-2 px-4 py-2 text-sm transition-colors ${
              activeTab === "all"
                ? "border-orange-400 font-semibold text-orange-400"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            すべて
            <span className="ml-1 text-xs">({menus.length})</span>
          </button>
          {categories.map((cat) => {
            const count = menus.filter((m) => m.categoryIds.includes(cat.id)).length;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveTab(cat.id)}
                className={`shrink-0 border-b-2 px-4 py-2 text-sm transition-colors ${
                  activeTab === cat.id
                    ? "border-orange-400 font-semibold text-orange-400"
                    : "border-transparent text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {cat.name}
                <span className="ml-1 text-xs">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {loading || !orderedLoaded ? (
        <PageLoader />
      ) : menus.length === 0 ? (
        <p className="text-sm text-neutral-500">メニューがまだありません。</p>
      ) : (
        <div className="space-y-6">
          {(activeTab === "all"
            ? groupedMenus
            : (() => {
                // 特定カテゴリタブ: 主カテゴリに関係なく categoryIds に含む全メニューを表示
                const cat = categories.find((c) => c.id === activeTab) ?? null;
                const items = menus
                  .filter((m) => m.categoryIds.includes(activeTab))
                  .sort((a, b) => {
                    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
                    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
                    if (ao !== bo) return ao - bo;
                    return a.name.localeCompare(b.name, "ja");
                  });
                return items.length > 0 ? [{ category: cat, items }] : [];
              })()
          ).map(({ category, items }) => (
            <section key={category?.id ?? "__uncategorized__"}>
              {activeTab === "all" && (
                <div className="mb-2 flex items-baseline gap-2 border-b border-neutral-800 pb-1">
                  <h2 className="text-lg font-bold text-white">
                    {category?.name ?? "未分類"}
                  </h2>
                  <span className="text-xs text-neutral-500">
                    {items.length}件
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {items.map((m) => {
                  const isDragging = draggingMenuId === m.id;
                  const isDragOver = dragOverMenuId === m.id && draggingMenuId !== m.id;
                  return (
                    <div
                      key={m.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingMenuId(m.id);
                      }}
                      onDragEnter={() => setDragOverMenuId(m.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleMenuDrop(items, m.id);
                      }}
                      onDragEnd={() => {
                        setDraggingMenuId(null);
                        setDragOverMenuId(null);
                      }}
                      className={`rounded-xl border bg-neutral-900 p-4 transition-all ${
                        m.isAvailable ? "" : "bg-neutral-800/50 opacity-60"
                      } ${isDragging ? "opacity-40" : ""} ${
                        isDragOver ? "border-orange-500 ring-2 ring-orange-500/30" : "border-neutral-800"
                      }`}
                    >
                      <div className="flex gap-3">
                        <span className="cursor-grab select-none self-start pt-1 text-neutral-500 active:cursor-grabbing" title="ドラッグで並び替え">
                          ⠿
                        </span>
                        {m.imageUrl && (
                          <FadeImage
                            src={m.imageUrl}
                            alt={m.name}
                            className="h-20 w-20 shrink-0 rounded"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-semibold text-white">{m.name}</h3>
                          <p className="text-sm text-orange-400">¥{m.price}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {m.categoryIds
                              .map((id) => categoryMap.get(id)?.name ?? "(不明)")
                              .join(", ") || "(カテゴリ未設定)"}
                          </p>
                          {m.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
                              {m.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => {
                            setEditing(m);
                            setShowForm(true);
                          }}
                          className="rounded-lg border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:bg-neutral-800 transition-colors"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => handleToggleAvailable(m)}
                          className="rounded-lg border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:bg-neutral-800 transition-colors"
                        >
                          {m.isAvailable ? "非公開にする" : "公開する"}
                        </button>
                        {!orderedMenuIds.has(m.id) && (
                          <button
                            onClick={() => setDeleteTarget(m)}
                            className="rounded-lg bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 transition-colors"
                          >
                            削除
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {showForm && (
        <MenuFormModal
          menu={editing}
          categories={categories}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`「${deleteTarget?.name}」を削除`}
        message="このメニューを完全に削除します。この操作は取り消せません。"
        confirmLabel="削除する"
        confirmColor="red"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  );
}

function MenuFormModal({
  menu,
  categories,
  onClose,
  onSave,
}: {
  menu: Menu | null;
  categories: Category[];
  onClose: () => void;
  onSave: (data: MenuFormData, imageFile: File | null, id?: string) => Promise<void>;
}) {
  const [form, setForm] = useState<MenuFormData>(
    menu
      ? {
          name: menu.name,
          description: menu.description,
          price: menu.price,
          imageUrl: menu.imageUrl,
          categoryIds: menu.categoryIds,
          isAvailable: menu.isAvailable,
        }
      : EMPTY_FORM
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(menu?.imageUrl || null);
  const [saving, setSaving] = useState(false);
  function toggleCategory(id: string) {
    setForm((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(id)
        ? f.categoryIds.filter((x) => x !== id)
        : [...f.categoryIds, id],
    }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);
    if (file) {
      setPreview(URL.createObjectURL(file));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave(form, imageFile, menu?.id);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-neutral-900 border border-neutral-800 p-6"
      >
        <h2 className="mb-4 text-lg font-bold text-white">
          {menu ? "メニュー編集" : "メニュー追加"}
        </h2>

        <div className="space-y-3">
          <Field label="名前">
            <input
              required
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="説明">
            <textarea
              rows={3}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>
          <Field label="価格（税込・円）">
            <input
              type="number"
              min={0}
              step={1}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
              value={form.price}
              onChange={(e) =>
                setForm({ ...form, price: Math.trunc(Number(e.target.value)) || 0 })
              }
            />
          </Field>
          <Field label="画像">
            {preview && (
              <img
                src={preview}
                alt="プレビュー"
                className="mb-2 h-32 w-32 rounded object-cover"
              />
            )}
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="w-full text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
            />
          </Field>
          <Field label="カテゴリ（複数選択可）">
            <div className="flex flex-wrap gap-2">
              {categories.length === 0 ? (
                <p className="text-xs text-gray-500">
                  カテゴリがまだありません。
                </p>
              ) : (
                categories.map((c) => {
                  const checked = form.categoryIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`cursor-pointer rounded-lg border px-3 py-1 text-xs ${
                        checked
                          ? "border-orange-500 bg-orange-500 text-white"
                          : "border-neutral-700 text-neutral-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggleCategory(c.id)}
                      />
                      {c.name}
                    </label>
                  );
                })
              )}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={form.isAvailable}
              onChange={(e) =>
                setForm({ ...form, isAvailable: e.target.checked })
              }
            />
            公開する
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-800 transition-colors"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-orange-500 px-4 py-2 text-sm text-white font-bold hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
