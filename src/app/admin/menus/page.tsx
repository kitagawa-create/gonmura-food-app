"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { FadeImage } from "@/components/ui/FadeImage";
import { PageLoader } from "@/components/ui/PageLoader";
import {
  addDoc,
  collection,
  doc,
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
import { normalizeMenu } from "@/lib/order-utils";
import { useAdminRole } from "@/components/admin/AdminContext";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { useToast } from "@/components/ui/Snackbar";

type MenuFormData = {
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  categoryIds: string[];
  isAvailable: boolean;
  isSoldOut: boolean;
};

const EMPTY_FORM: MenuFormData = {
  name: "",
  description: "",
  price: 0,
  imageUrl: "",
  categoryIds: [],
  isAvailable: true,
  isSoldOut: false,
};


export default function AdminMenusPage() {
  const role = useAdminRole();
  const { show: toast } = useToast();
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Menu | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Menu | null>(null);
  const [toggleConfirm, setToggleConfirm] = useState<{
    menu: Menu;
    type: "available" | "soldout";
  } | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [deleting, setDeleting] = useState(false);
  const [movingMenuId, setMovingMenuId] = useState<string | null>(null);
  const [draggingMenuId, setDraggingMenuId] = useState<string | null>(null);
  const [dragOverMenuId, setDragOverMenuId] = useState<string | null>(null);
  const [savingMenuOrder, setSavingMenuOrder] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const unsubMenus = onSnapshot(
      collection(db, "menus"),
      (snap) =>
        setMenus(
          snap.docs.map((d) => normalizeMenu(d.id, d.data() as Record<string, unknown>))
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
  const visibleMenus = useMemo(() => menus.filter((m) => !m.isDeleted), [menus]);

  const groupedMenus = useMemo(() => {
    const groups = new Map<string | null, Menu[]>();
    for (const m of visibleMenus) {
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
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
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
        toast("メニューを更新しました");
      } else {
        // 新規: 末尾になるように既存最大 + 1
        const maxOrder = menus.reduce(
          (m, x) => x.sortOrder < Number.MAX_SAFE_INTEGER ? Math.max(m, x.sortOrder) : m,
          -1
        );
        await addDoc(collection(db, "menus"), {
          ...saveData,
          sortOrder: maxOrder + 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast("メニューを追加しました");
      }
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました。");
      toast("保存に失敗しました");
    }
  }

  async function handleToggleAvailable(menu: Menu) {
    const next = !menu.isAvailable;
    setMenus((prev) =>
      prev.map((x) => (x.id === menu.id ? { ...x, isAvailable: next } : x))
    );
    try {
      await updateDoc(doc(db, "menus", menu.id), {
        isAvailable: next,
        updatedAt: serverTimestamp(),
      });
      toast("公開状態を更新しました");
    } catch (e) {
      setMenus((prev) =>
        prev.map((x) => (x.id === menu.id ? { ...x, isAvailable: !next } : x))
      );
      setError(e instanceof Error ? e.message : "更新に失敗しました。");
      toast("更新に失敗しました");
    }
  }

  async function handleToggleSoldOut(menu: Menu) {
    const next = !menu.isSoldOut;
    setMenus((prev) =>
      prev.map((x) => (x.id === menu.id ? { ...x, isSoldOut: next } : x))
    );
    try {
      await updateDoc(doc(db, "menus", menu.id), {
        isSoldOut: next,
        updatedAt: serverTimestamp(),
      });
      toast(next ? "売り切れに設定しました" : "売り切れを解除しました");
    } catch (e) {
      setMenus((prev) =>
        prev.map((x) => (x.id === menu.id ? { ...x, isSoldOut: !next } : x))
      );
      setError(e instanceof Error ? e.message : "更新に失敗しました。");
      toast("更新に失敗しました");
    }
  }

  const persistMenuOrder = useCallback(async (orderedSectionItems: Menu[]) => {
    setSavingMenuOrder(true);
    setError(null);
    try {
      const base = orderedSectionItems.reduce(
        (m, x) => Math.min(m, x.sortOrder),
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

  // 長押し→タップ移動 (iPad 対応)
  const handleTapMoveMenu = useCallback(
    (sectionItems: Menu[], targetId: string) => {
      if (!movingMenuId || movingMenuId === targetId) {
        setMovingMenuId(null);
        return;
      }
      const fromIdx = sectionItems.findIndex((m) => m.id === movingMenuId);
      const toIdx = sectionItems.findIndex((m) => m.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...sectionItems];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      setMovingMenuId(null);
      persistMenuOrder(next);
    },
    [movingMenuId, persistMenuOrder]
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await updateDoc(doc(db, "menus", deleteTarget.id), {
        isDeleted: true,
        isAvailable: false,
        updatedAt: serverTimestamp(),
      });
      setDeleteTarget(null);
      toast("メニューを削除しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました。");
      toast("削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, toast]);

  return (
    <div className="w-full h-full flex flex-col -m-3 md:-m-6">
      {/* 固定ヘッダー (スクロールしない) */}
      <div className="shrink-0 px-3 md:px-6 pt-3 md:pt-6 pb-2 bg-[color:var(--color-bg-base)] border-b border-[color:var(--color-border)]">
        <AdminPageHeader
          title="メニュー管理"
          className="mb-3"
          rightSlot={
            role === "owner" ? (
              <button
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
                className="rounded-xl bg-[color:var(--color-accent-char)] px-4 py-2 text-sm text-white font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors"
              >
                新規追加
              </button>
            ) : undefined
          }
        />

        {/* カテゴリタブ */}
        {!loading && categories.length > 0 && (
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            <button
              onClick={() => handleTabChange("all")}
              className={`shrink-0 border-b-2 px-4 py-2 text-sm transition-colors ${
                activeTab === "all"
                  ? "border-[color:var(--color-accent-char)] font-semibold text-[color:var(--color-accent-char)]"
                  : "border-transparent text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
              }`}
            >
              すべて
              <span className="ml-1 text-xs">({visibleMenus.length})</span>
            </button>
            {categories.map((cat) => {
              const count = visibleMenus.filter((m) => m.categoryIds.includes(cat.id)).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => handleTabChange(cat.id)}
                  className={`shrink-0 border-b-2 px-4 py-2 text-sm transition-colors ${
                    activeTab === cat.id
                      ? "border-[color:var(--color-accent-char)] font-semibold text-[color:var(--color-accent-char)]"
                      : "border-transparent text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
                  }`}
                >
                  {cat.name}
                  <span className="ml-1 text-xs">({count})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* スクロール領域 */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-3 md:px-6 py-3">

      {error && (
        <p className="mb-4 rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 text-sm text-[color:var(--color-accent-warn)]">
          {error}
        </p>
      )}

      {loading ? (
        <PageLoader />
      ) : menus.filter((m) => !m.isDeleted).length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">メニューがまだありません。</p>
      ) : (
        <div className="space-y-6">
          {(activeTab === "all"
            ? groupedMenus
            : (() => {
                // 特定カテゴリタブ: 主カテゴリに関係なく categoryIds に含む全メニューを表示
                const cat = categories.find((c) => c.id === activeTab) ?? null;
                const items = visibleMenus
                  .filter((m) => m.categoryIds.includes(activeTab))
                  .sort((a, b) => {
                    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                    return a.name.localeCompare(b.name, "ja");
                  });
                return items.length > 0 ? [{ category: cat, items }] : [];
              })()
          ).map(({ category, items }) => (
            <section key={category?.id ?? "__uncategorized__"}>
              {activeTab === "all" && (
                <div className="mb-2 flex items-baseline gap-2 border-b border-[color:var(--color-border)] pb-1">
                  <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">
                    {category?.name ?? "未分類"}
                  </h2>
                  <span className="text-xs text-[color:var(--color-text-muted)]">
                    {items.length}件
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {items.map((m) => {
                  const isDragging = draggingMenuId === m.id;
                  const isMovingThis = movingMenuId === m.id;
                  const isMoveTarget = role === "owner" && movingMenuId !== null && movingMenuId !== m.id;
                  const longPressRef = { current: null as ReturnType<typeof setTimeout> | null };
                  return (
                    <div
                      key={m.id}
                      draggable={role === "owner"}
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
                      onTouchStart={() => {
                        if (role !== "owner") return;
                        longPressRef.current = setTimeout(() => {
                          setMovingMenuId(m.id);
                          longPressRef.current = null;
                        }, 400);
                      }}
                      onTouchEnd={() => {
                        if (longPressRef.current) {
                          clearTimeout(longPressRef.current);
                          longPressRef.current = null;
                          if (isMoveTarget) handleTapMoveMenu(items, m.id);
                        }
                      }}
                      onTouchMove={() => {
                        if (longPressRef.current) {
                          clearTimeout(longPressRef.current);
                          longPressRef.current = null;
                        }
                      }}
                      onClick={() => { if (isMoveTarget) handleTapMoveMenu(items, m.id); }}
                      className={`relative rounded-xl border bg-[color:var(--color-bg-card)] p-4 shadow-sm select-none ${
                        m.isAvailable ? "" : "bg-[color:var(--color-bg-subtle)] opacity-60 border-dashed"
                      } ${
                        isMovingThis
                          ? "border-[color:var(--color-accent-char)] ring-2 ring-[color:var(--color-accent-char)]/30 bg-[color:var(--color-accent-char)]/5"
                          : m.isSoldOut
                            ? "border-[color:var(--color-accent-warn)]"
                            : "border-[color:var(--color-border)]"
                      } ${isMoveTarget ? "cursor-pointer" : ""} ${isDragging ? "opacity-40" : ""}`}
                    >
                      {/* 鉛筆アイコン編集ボタン（右上） */}
                      {role === "owner" && (
                        <button
                          onClick={() => {
                            setEditing(m);
                            setShowForm(true);
                          }}
                          className="absolute right-2 top-2 rounded-lg border border-[color:var(--color-border)] p-1.5 text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
                          aria-label="編集"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                      )}
                      <div className="flex gap-3">
                        {m.imageUrl && (
                          <FadeImage
                            src={m.imageUrl}
                            alt={m.name}
                            className="h-20 w-20 shrink-0 rounded"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-semibold text-[color:var(--color-text-primary)] pr-8">{m.name}</h3>
                          <p className="text-sm text-[color:var(--color-accent-char)]">¥{m.price}</p>
                          <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
                            {m.categoryIds
                              .map((id) => categoryMap.get(id)?.name ?? "(不明)")
                              .join(", ") || "(カテゴリ未設定)"}
                          </p>
                          {m.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-[color:var(--color-text-muted)]">
                              {m.description}
                            </p>
                          )}
                          {/* 非公開・売り切れバッジ */}
                          {(!m.isAvailable || m.isSoldOut) && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {!m.isAvailable && (
                                <span className="rounded-full bg-[color:var(--color-text-muted)] px-2 py-0.5 text-[10px] font-bold text-white">
                                  非公開中
                                </span>
                              )}
                              {m.isSoldOut && (
                                <span className="rounded-full bg-[color:var(--color-accent-warn)] px-2 py-0.5 text-[10px] font-bold text-white">
                                  売り切れ中
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* 下部ボタン行: 非公開・売り切れ左寄せ、削除右端 */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => {
                            if (m.isAvailable) {
                              setToggleConfirm({ menu: m, type: "available" });
                            } else {
                              handleToggleAvailable(m);
                            }
                          }}
                          aria-pressed={!m.isAvailable}
                          className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
                            !m.isAvailable
                              ? "border-[color:var(--color-accent-char)] bg-[color:var(--color-accent-char)] text-white hover:opacity-90"
                              : "border-[color:var(--color-accent-char)]/40 text-[color:var(--color-accent-char)] hover:bg-[color:var(--color-accent-char)]/10"
                          }`}
                        >
                          {m.isAvailable ? "非公開にする" : "公開する"}
                        </button>
                        <button
                          onClick={() => {
                            if (!m.isSoldOut) {
                              setToggleConfirm({ menu: m, type: "soldout" });
                            } else {
                              handleToggleSoldOut(m);
                            }
                          }}
                          aria-pressed={!!m.isSoldOut}
                          className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
                            m.isSoldOut
                              ? "border-[color:var(--color-accent-warn)] bg-[color:var(--color-accent-warn)] text-white hover:opacity-90"
                              : "border-[color:var(--color-accent-warn)]/40 text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10"
                          }`}
                        >
                          {m.isSoldOut ? "売り切れ解除" : "売り切れにする"}
                        </button>
                        {role === "owner" && (
                          <button
                            onClick={() => setDeleteTarget(m)}
                            className="ml-auto rounded-lg bg-[color:var(--color-accent-warn)] px-3 py-1 text-xs text-white hover:opacity-90 transition-colors"
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

      </div>{/* スクロール領域 閉じ */}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`「${deleteTarget?.name}」を削除`}
        message="このメニューを削除します。過去の売上データへの影響を防ぐためデータは内部に保持されます。"
        confirmLabel="削除する"
        confirmColor="red"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />

      <ConfirmDialog
        open={toggleConfirm !== null}
        title={
          toggleConfirm?.type === "available"
            ? `「${toggleConfirm.menu.name}」を非公開にする`
            : `「${toggleConfirm?.menu.name}」を売り切れにする`
        }
        message={
          toggleConfirm?.type === "available"
            ? "このメニューをお客様から非表示にします。注文できなくなります。"
            : "このメニューを売り切れに設定します。お客様は注文できなくなります。"
        }
        confirmLabel={toggleConfirm?.type === "available" ? "非公開にする" : "売り切れにする"}
        confirmColor="red"
        onConfirm={() => {
          if (!toggleConfirm) return;
          if (toggleConfirm.type === "available") {
            handleToggleAvailable(toggleConfirm.menu);
          } else {
            handleToggleSoldOut(toggleConfirm.menu);
          }
          setToggleConfirm(null);
        }}
        onCancel={() => setToggleConfirm(null)}
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
          isSoldOut: menu.isSoldOut,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] shadow-xl"
      >
        {/* 閉じる: 右上固定 */}
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

        {/* ヘッダー (固定) */}
        <div className="shrink-0 border-b border-[color:var(--color-border)] px-6 py-4 pr-16">
          <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">
            {menu ? "メニュー編集" : "メニュー追加"}
          </h2>
        </div>

        {/* ボディ (スクロール) */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

        <div className="space-y-3">
          <Field label="名前">
            <input
              required
              maxLength={30}
              className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <p className={`mt-1 text-right text-xs ${form.name.length >= 27 ? "text-[color:var(--color-accent-warn)]" : "text-[color:var(--color-text-muted)]"}`}>
              {form.name.length}/30
            </p>
          </Field>
          <Field label="説明">
            <textarea
              rows={3}
              maxLength={200}
              className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
            <p className={`mt-1 text-right text-xs ${form.description.length >= 180 ? "text-[color:var(--color-accent-warn)]" : "text-[color:var(--color-text-muted)]"}`}>
              {form.description.length}/200
            </p>
          </Field>
          <Field label="価格(税込・円)">
            <input
              type="text"
              inputMode="numeric"
              className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
              value={form.price === 0 ? "" : String(form.price)}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setForm({ ...form, price: v === "" ? 0 : Math.trunc(Number(v)) });
              }}
              placeholder="0"
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
              className="w-full text-sm text-[color:var(--color-text-muted)] file:mr-3 file:rounded file:border-0 file:bg-[color:var(--color-bg-subtle)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[color:var(--color-text-primary)] hover:file:bg-[color:var(--color-border)]"
            />
          </Field>
          <Field label="カテゴリ(複数選択可)">
            <div className="flex flex-wrap gap-2">
              {categories.length === 0 ? (
                <p className="text-xs text-[color:var(--color-text-muted)]">
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
                          ? "border-[color:var(--color-accent-char)] bg-[color:var(--color-accent-char)] text-white"
                          : "border-[color:var(--color-border)] text-[color:var(--color-text-muted)]"
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
          <label className="flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
            <input
              type="checkbox"
              checked={form.isAvailable}
              onChange={(e) =>
                setForm({ ...form, isAvailable: e.target.checked })
              }
            />
            公開する
          </label>
          <label className="flex items-center gap-2 text-sm text-[color:var(--color-accent-warn)]">
            <input
              type="checkbox"
              checked={form.isSoldOut}
              onChange={(e) =>
                setForm({ ...form, isSoldOut: e.target.checked })
              }
            />
            売り切れ中
          </label>
        </div>

        </div>

        {/* フッター (sticky 下部固定) */}
        <div className="sticky bottom-0 shrink-0 flex justify-end border-t border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] px-6 py-4 rounded-b-2xl">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-[color:var(--color-accent-char)] px-6 py-2 text-sm text-white font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors disabled:opacity-50"
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
      <label className="mb-1 block text-xs text-[color:var(--color-text-muted)]">{label}</label>
      {children}
    </div>
  );
}
