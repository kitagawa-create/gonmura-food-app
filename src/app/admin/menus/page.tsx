"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { FadeImage } from "@/components/ui/FadeImage";
import { PageLoader } from "@/components/ui/PageLoader";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { Category, Menu, MenuStatus } from "@/types";
import { normalizeMenu, taxIncluded } from "@/lib/order-utils";
import { useAdminRole } from "@/components/admin/AdminContext";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { useToast } from "@/components/ui/Snackbar";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type MenuFormData = {
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  categoryIds: string[];
  status: MenuStatus;
};

const FIXED_SIDE_CATEGORY = {
  categoryId: "__fixed_side__",
  name: "サイド",
  sortOrder: Number.MAX_SAFE_INTEGER - 1,
} as const;

const EMPTY_FORM: MenuFormData = {
  name: "",
  description: "",
  price: 0,
  imageUrl: "",
  categoryIds: [],
  status: "active",
};

type CropRect = { x: number; y: number; w: number; h: number };

function cropToJpeg(blob: Blob, crop: CropRect, outputW = 800): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const outputH = Math.round(outputW * 3 / 4);
      const canvas = document.createElement("canvas");
      canvas.width = outputW;
      canvas.height = outputH;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas context unavailable")); return; }
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, outputW, outputH);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.85
      );
    };
    img.onerror = reject;
    img.src = url;
  });
}



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
  const [deleting, setDeleting] = useState(false);
  const [savingMenuOrder, setSavingMenuOrder] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const [activeTab, setActiveTab] = useState<string>("");
  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<"soldout" | "active" | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [applyingBulk, setApplyingBulk] = useState(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

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
            categoryId: d.id,
            ...(d.data() as Omit<Category, "categoryId">),
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
    for (const c of categories) m.set(c.categoryId, c);
    return m;
  }, [categories]);

  const visibleMenus = useMemo(() => menus.filter((m) => m.status !== "deleted"), [menus]);

  const osusumeId = useMemo(
    () => categories.find((c) => c.name === "おすすめ")?.categoryId,
    [categories]
  );
  const sideId = FIXED_SIDE_CATEGORY.categoryId;

  function sortByCategory(items: Menu[], categoryId: string | null): Menu[] {
    const isOsusume = categoryId !== null && categoryId === osusumeId;
    const isSide = categoryId !== null && categoryId === sideId;
    return [...items].sort((a, b) => {
      const aOrder = isOsusume ? a.sortOrderFeatured : isSide ? a.sortOrderSide : a.sortOrder;
      const bOrder = isOsusume ? b.sortOrderFeatured : isSide ? b.sortOrderSide : b.sortOrder;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name, "ja");
    });
  }

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
      if (m.categoryIds.some((cid) => categoryMap.get(cid)?.name === "サイド")) {
        const arr = groups.get(sideId) ?? [];
        arr.push(m);
        groups.set(sideId, arr);
      }
    }
    const sections: { category: Category | null; items: Menu[] }[] = [];
    for (const c of categories) {
      const items = groups.get(c.categoryId);
      if (items && items.length > 0) {
        sections.push({ category: c, items: sortByCategory(items, c.categoryId) });
      }
    }
    const sideItems = groups.get(sideId);
    if (sideItems && sideItems.length > 0) {
      sections.push({ category: FIXED_SIDE_CATEGORY as unknown as Category, items: sortByCategory(sideItems, sideId) });
    }
    const uncategorized = groups.get(null);
    if (uncategorized && uncategorized.length > 0) {
      sections.push({ category: null, items: sortByCategory(uncategorized, null) });
    }
    return sections;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menus, categories, categoryMap, osusumeId, sideId]);

  function getStoragePath(url: string): string | null {
    try {
      const m = new URL(url).pathname.match(/\/o\/(.+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  }

  async function handleSave(data: MenuFormData, imageBlob: Blob | null, id?: string) {
    setError(null);
    try {
      let imageUrl = data.imageUrl;
      let newDocId: string | undefined;

      if (imageBlob) {
        const menuId = id ?? doc(collection(db, "menus")).id;
        if (!id) newDocId = menuId;

        if (id && data.imageUrl) {
          const oldPath = getStoragePath(data.imageUrl);
          if (oldPath) await deleteObject(ref(storage, oldPath)).catch(() => {});
        }

        const fileRef = ref(storage, `menus/${menuId}.jpg`);
        await uploadBytes(fileRef, imageBlob);
        imageUrl = await getDownloadURL(fileRef);
      }

      const saveData = {
        ...data,
        imageUrl,
        price: Math.trunc(Number(data.price)) || 0,
      };

      if (id) {
        await updateDoc(doc(db, "menus", id), { ...saveData, updatedAt: serverTimestamp() });
        toast("メニューを更新しました");
      } else {
        const maxOrder = menus.reduce(
          (m, x) => x.sortOrder < Number.MAX_SAFE_INTEGER ? Math.max(m, x.sortOrder) : m,
          -1
        );
        const maxFeaturedOrder = menus.reduce(
          (m, x) => x.sortOrderFeatured < Number.MAX_SAFE_INTEGER ? Math.max(m, x.sortOrderFeatured) : m,
          -1
        );
        const maxSideOrder = menus.reduce(
          (m, x) => x.sortOrderSide < Number.MAX_SAFE_INTEGER ? Math.max(m, x.sortOrderSide) : m,
          -1
        );
        const menuDocId = newDocId ?? doc(collection(db, "menus")).id;
        await setDoc(doc(db, "menus", menuDocId), {
          menuId: menuDocId,
          ...saveData,
          sortOrder: maxOrder + 1,
          sortOrderFeatured: maxFeaturedOrder + 1,
          sortOrderSide: maxSideOrder + 1,
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

  const persistMenuOrder = useCallback(
    async (orderedSectionItems: Menu[], fieldName: "sortOrder" | "sortOrderFeatured" | "sortOrderSide") => {
      setSavingMenuOrder(true);
      setError(null);
      try {
        const base = orderedSectionItems.reduce(
          (m, x) => Math.min(m, x[fieldName]),
          Number.MAX_SAFE_INTEGER
        );
        const startAt = base === Number.MAX_SAFE_INTEGER ? 0 : base;
        const batch = writeBatch(db);
        orderedSectionItems.forEach((m, i) => {
          const next = startAt + i;
          if (m[fieldName] !== next) {
            batch.update(doc(db, "menus", m.menuId), {
              [fieldName]: next,
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
    },
    []
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await updateDoc(doc(db, "menus", deleteTarget.menuId), {
        status: "deleted",
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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyPendingAction() {
    if (selectedIds.size === 0 || !pendingAction) return;
    setApplyingBulk(true);
    try {
      const batch = writeBatch(db);
      for (const id of selectedIds) {
        batch.update(doc(db, "menus", id), { status: pendingAction, updatedAt: serverTimestamp() });
      }
      await batch.commit();
      const label = pendingAction === "soldout" ? "売り切れ" : "解除";
      const toastMsg = `${selectedIds.size}件を${label}しました`;
      toast(toastMsg);
      setSelectedIds(new Set());
      setPendingAction(null);
      setBulkConfirmOpen(false);
    } catch {
      toast("変更に失敗しました");
    } finally {
      setApplyingBulk(false);
    }
  }

  const actionLabel = pendingAction === "soldout" ? "売り切れ" : "解除";

  const selectedSoldoutCount = useMemo(
    () => visibleMenus.filter((m) => selectedIds.has(m.menuId) && m.status === "soldout").length,
    [selectedIds, visibleMenus]
  );

  const effectiveTab = activeTab || categories[0]?.categoryId || "";

  const currentSection = useMemo(() => {
    if (!effectiveTab) return null;
    const cat = categories.find((c) => c.categoryId === effectiveTab) ?? null;
    const items = sortByCategory(
      visibleMenus.filter((m) =>
        effectiveTab === sideId
          ? m.categoryIds.some((cid) => categoryMap.get(cid)?.name === "サイド")
          : m.categoryIds.includes(effectiveTab)
      ),
      effectiveTab
    );
    const fieldName: "sortOrder" | "sortOrderFeatured" | "sortOrderSide" =
      cat?.categoryId === osusumeId ? "sortOrderFeatured" : cat?.categoryId === sideId ? "sortOrderSide" : "sortOrder";
    return { category: cat, items, fieldName };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTab, categories, visibleMenus, osusumeId, sideId]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !currentSection) return;
    const { items, fieldName } = currentSection;
    const oldIdx = items.findIndex((m) => m.menuId === String(active.id));
    const newIdx = items.findIndex((m) => m.menuId === String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    persistMenuOrder(arrayMove(items, oldIdx, newIdx), fieldName);
  }

  return (
    <div className="w-full h-full flex flex-col -m-3 md:-m-6">
      {/* 固定ヘッダー */}
      <div className="shrink-0 px-3 md:px-6 pt-3 md:pt-6 pb-2 bg-[color:var(--color-bg-base)] border-b border-[color:var(--color-border)]">
        <AdminPageHeader
          title="メニュー管理"
          className="mb-3"
          rightSlot={
            role === "owner" ? (
              <button
                onClick={() => { setEditing(null); setShowForm(true); }}
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
            {categories.map((cat) => {
              const isActive = effectiveTab === cat.categoryId;
              const count = visibleMenus.filter((m) => m.categoryIds.includes(cat.categoryId)).length;
              return (
                <button
                  key={cat.categoryId}
                  onClick={() => handleTabChange(cat.categoryId)}
                  className={`shrink-0 border-b-2 px-4 py-2 text-sm transition-colors ${
                    isActive
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
      ) : visibleMenus.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">メニューがまだありません。</p>
      ) : !currentSection || currentSection.items.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">このカテゴリにメニューがありません。</p>
      ) : (
        (() => {
          const { items } = currentSection;
          return (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map((m) => m.menuId)} strategy={rectSortingStrategy}>
                <div className="grid w-full gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {items.map((m, menuIdx) => (
                    <SortableMenuCard
                      key={m.menuId}
                      menu={m}
                      index={menuIdx}
                      isOwner={role === "owner"}
                      categoryMap={categoryMap}
                      isSelected={selectedIds.has(m.menuId)}
                      onSelect={() => toggleSelect(m.menuId)}
                      onEdit={() => { setEditing(m); setShowForm(true); }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          );
        })()
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
          onDelete={role === "owner" && editing ? () => {
            setShowForm(false);
            setEditing(null);
            setDeleteTarget(editing);
          } : undefined}
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
        open={bulkConfirmOpen}
        title={`選択した${selectedIds.size}件を${actionLabel}`}
        message={
          pendingAction === "soldout"
            ? "選択したメニューを売り切れに設定します。お客様は注文できなくなります。"
            : "選択したメニューを販売中に戻します。お客様から注文できるようになります。"
        }
        confirmLabel={pendingAction === "active" ? "解除する" : "売り切れにする"}
        confirmColor={pendingAction === "active" ? "blue" : "red"}
        onConfirm={applyPendingAction}
        onCancel={() => { setBulkConfirmOpen(false); setPendingAction(null); }}
        loading={applyingBulk}
      />

      {/* 下部アクションバー（選択時のみ表示） */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-14 md:left-60 right-0 z-40 border-t border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] shadow-lg">
          <div className="flex items-center gap-3 px-4 py-3 overflow-x-auto">
            <div className="shrink-0 text-sm font-medium text-[color:var(--color-text-primary)]">
              {selectedIds.size}件選択中
            </div>
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <button
                onClick={() => { setPendingAction("soldout"); setBulkConfirmOpen(true); }}
                className="rounded-lg border border-[color:var(--color-accent-warn)]/40 px-3 py-2 text-sm text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10 transition-colors"
              >
                売り切れ
              </button>
              <button
                onClick={() => { setPendingAction("active"); setBulkConfirmOpen(true); }}
                disabled={selectedSoldoutCount < selectedIds.size}
                className="rounded-lg border border-[color:var(--color-accent-warn)]/40 px-3 py-2 text-sm text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                解除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableMenuCard({
  menu,
  index,
  isOwner,
  categoryMap: _categoryMap,
  isSelected,
  onSelect,
  onEdit,
}: {
  menu: Menu;
  index: number;
  isOwner: boolean;
  categoryMap: Map<string, Category>;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: menu.menuId });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const sold = menu.status === "soldout";
  const hidden = menu.status === "hidden";

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`relative flex w-full flex-col rounded-xl overflow-hidden bg-[color:var(--color-bg-card)] border transition-shadow cursor-pointer ${
        isDragging ? "opacity-50 shadow-xl z-50" : ""
      } ${
        isSelected
          ? "border-[color:var(--color-accent-char)] ring-4 ring-[color:var(--color-accent-char)]/40"
          : sold
            ? "border-[color:var(--color-accent-warn)]"
            : hidden
              ? "border-dashed border-[color:var(--color-border)] opacity-60"
              : "border-[color:var(--color-border)]"
      } pb-8`}
    >
      {/* 画像領域: お客様画面と同じ 4:3 */}
      {menu.imageUrl ? (
        <div
          className={`relative w-full shrink-0 overflow-hidden rounded-t-xl ${sold ? "opacity-40 grayscale" : ""}`}
          style={{ paddingTop: "75%" }}
        >
          <div className="absolute inset-0">
            <FadeImage src={menu.imageUrl} alt={menu.name} className="w-full h-full" />
          </div>
        </div>
      ) : (
        <div
          className={`relative w-full shrink-0 overflow-hidden bg-[color:var(--color-bg-subtle)] ${sold ? "opacity-40 grayscale" : ""}`}
          style={{ paddingTop: "75%" }}
        >
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[color:var(--color-text-muted)]">
            画像なし
          </div>
        </div>
      )}

      {/* テキスト領域: お客様画面と完全同一 */}
      <div className={`flex flex-col p-4 pb-6 gap-2.5 ${sold ? "opacity-60" : ""}`}>
        <h3 className="text-base font-bold leading-6 line-clamp-2 text-[color:var(--color-text-primary)]">
          <span className="mr-1 text-base font-bold text-[color:var(--color-text-muted)]">{index + 1}.</span>
          {menu.name}
        </h3>
        <p className="text-sm leading-5 line-clamp-2 text-[color:var(--color-text-muted)]">
          {menu.description || " "}
        </p>
        <p className="text-lg font-bold leading-6 text-[color:var(--color-accent-char)]">
          {taxIncluded(menu.price).toLocaleString()}円<span className="ml-1 text-xs font-normal text-[color:var(--color-text-muted)] whitespace-nowrap">（税抜{menu.price.toLocaleString()}円）</span>
        </p>
      </div>

      {/* 売り切れオーバーレイ: お客様画面と同一 */}
      {sold && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-[22%]">
          <span className="rounded-full bg-[color:var(--color-accent-warn)]/90 px-5 py-2 text-base font-bold text-white shadow-md">
            売り切れ
          </span>
        </div>
      )}
      {hidden && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-[22%]">
          <span className="rounded-full bg-[color:var(--color-text-muted)]/90 px-5 py-2 text-base font-bold text-white shadow-md">
            非公開
          </span>
        </div>
      )}

      {/* ドラッグハンドル（下部中央・owner のみ） */}
      {isOwner && (
        <div
          {...attributes}
          {...listeners}
          className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/80 shadow-sm cursor-grab touch-none text-[color:var(--color-text-muted)] active:cursor-grabbing"
          title="ドラッグして並び替え"
        >
          ⠿
        </div>
      )}

      {/* 編集ボタン（右上・owner のみ） */}
      {isOwner && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/80 border border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:bg-white transition-colors shadow-sm"
          aria-label="編集"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      )}

    </div>
  );
}

function MenuFormModal({
  menu,
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  menu: Menu | null;
  categories: Category[];
  onClose: () => void;
  onSave: (data: MenuFormData, imageBlob: Blob | null, id?: string) => Promise<void>;
  onDelete?: () => void;
}) {
  const osusumeCategory = useMemo(
    () => categories.find((c) => c.name === "おすすめ"),
    [categories]
  );
  const sideCategory = FIXED_SIDE_CATEGORY as unknown as Category;
  const mainCategories = useMemo(
    () => [...categories.filter((c) => c.name !== "おすすめ"), sideCategory],
    [categories, sideCategory]
  );

  const initPrimaryId = menu
    ? (menu.categoryIds.find((id) => id !== osusumeCategory?.categoryId && id !== sideCategory.categoryId) ?? "")
    : "";
  const initIsOsusume = menu
    ? (osusumeCategory ? menu.categoryIds.includes(osusumeCategory.categoryId) : false)
    : false;

  const [primaryCategoryId, setPrimaryCategoryId] = useState(initPrimaryId);
  const [isOsusume, setIsOsusume] = useState(initIsOsusume);
  const [form, setForm] = useState<MenuFormData>(
    menu
      ? {
          name: menu.name,
          description: menu.description,
          price: menu.price,
          imageUrl: menu.imageUrl,
          categoryIds: menu.categoryIds,
          status: menu.status,
        }
      : EMPTY_FORM
  );
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(menu?.imageUrl || null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file) setCropFile(file);
    e.target.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!primaryCategoryId) return;
    setSaving(true);
    const categoryIds = [
      primaryCategoryId,
      ...(isOsusume && osusumeCategory ? [osusumeCategory.categoryId] : []),
    ];
    await onSave({ ...form, categoryIds }, croppedBlob, menu?.menuId);
    setSaving(false);
  }

  return (
    <>
    {cropFile && (
      <ImageCropModal
        file={cropFile}
        onConfirm={(blob, previewUrl) => {
          setCroppedBlob(blob);
          setPreview(previewUrl);
          setCropFile(null);
        }}
        onCancel={() => setCropFile(null)}
      />
    )}
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] shadow-xl"
      >
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="削除"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--color-accent-warn)]/40 bg-[color:var(--color-bg-card)] text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="shrink-0 border-b border-[color:var(--color-border)] px-6 py-4 pr-24">
          <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">
            {menu ? "メニュー編集" : "メニュー追加"}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">

        <div className="space-y-3">
          <Field label="名前" required>
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
          <Field label="価格(税抜・円)" required>
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
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="sr-only"
            />
            {preview ? (
              <div className="relative w-full rounded-lg overflow-hidden" style={{ paddingTop: "75%" }}>
                <img
                  src={preview}
                  alt="プレビュー"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-white/90 text-[color:var(--color-text-muted)] hover:bg-white transition-colors shadow-sm"
                  aria-label="画像を変更"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[color:var(--color-border)] py-8 text-[color:var(--color-text-muted)] hover:border-[color:var(--color-accent-char)] hover:text-[color:var(--color-accent-char)] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span className="text-sm">タップして画像を選択</span>
              </button>
            )}
            {croppedBlob && (
              <p className="mt-1 text-xs text-[color:var(--color-accent-negi)]">✓ 4:3でトリミング済み</p>
            )}
          </Field>
          <Field label="カテゴリ" required>
            {mainCategories.length === 0 ? (
              <p className="text-xs text-[color:var(--color-text-muted)]">カテゴリがまだありません。</p>
            ) : (
              <select
                className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
                value={primaryCategoryId}
                onChange={(e) => setPrimaryCategoryId(e.target.value)}
              >
                <option value="">カテゴリを選択...</option>
                {mainCategories.map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>{c.name}</option>
                ))}
              </select>
            )}
            {!primaryCategoryId && (
              <p className="mt-1 text-xs text-[color:var(--color-accent-warn)]">カテゴリを選択してください</p>
            )}
          </Field>
          {osusumeCategory && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[color:var(--color-border)] px-3 py-2.5 hover:bg-[color:var(--color-bg-subtle)] transition-colors">
              <div className={`h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                isOsusume
                  ? "border-[color:var(--color-accent-char)] bg-[color:var(--color-accent-char)]"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]"
              }`}>
                {isOsusume && (
                  <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2,6 5,9 10,3" />
                  </svg>
                )}
              </div>
              <input
                type="checkbox"
                className="sr-only"
                checked={isOsusume}
                onChange={(e) => setIsOsusume(e.target.checked)}
              />
              <span className="text-sm text-[color:var(--color-text-primary)]">おすすめに表示する</span>
            </label>
          )}
          <Field label="公開状態" required>
            <select
              className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as MenuStatus })}
            >
              <option value="active">公開中</option>
              <option value="soldout">売り切れ</option>
              <option value="hidden">非公開</option>
            </select>
          </Field>
        </div>

        </div>

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
    </>
  );
}

function ImageCropModal({
  file,
  onConfirm,
  onCancel,
}: {
  file: File;
  onConfirm: (blob: Blob, previewUrl: string) => void;
  onCancel: () => void;
}) {
  const src = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  const [natW, setNatW] = useState(0);
  const [natH, setNatH] = useState(0);
  const [position, setPosition] = useState(50);
  const [confirming, setConfirming] = useState(false);

  const ratio = natW > 0 ? natW / natH : 1;
  const isWider = ratio > 4 / 3 + 0.01;
  const isTaller = ratio < 4 / 3 - 0.01;
  const objPos = isWider ? `${position}% 50%` : `50% ${position}%`;

  function getCropRect(): CropRect {
    if (isWider) {
      const cropW = Math.round(natH * 4 / 3);
      const x = Math.round((natW - cropW) * position / 100);
      return { x, y: 0, w: cropW, h: natH };
    } else if (isTaller) {
      const cropH = Math.round(natW * 3 / 4);
      const y = Math.round((natH - cropH) * position / 100);
      return { x: 0, y, w: natW, h: cropH };
    } else {
      return { x: 0, y: 0, w: natW, h: natH };
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      const crop = getCropRect();
      const result = await cropToJpeg(file, crop);
      const previewUrl = URL.createObjectURL(result);
      onConfirm(result, previewUrl);
    } catch {
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md bg-[color:var(--color-bg-card)] rounded-2xl overflow-hidden border border-[color:var(--color-border)] shadow-xl">
        <div className="px-5 py-4 border-b border-[color:var(--color-border)]">
          <h3 className="font-bold text-[color:var(--color-text-primary)]">画像をトリミング</h3>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">4:3の枠に合わせて切り取ります</p>
        </div>

        <div className="relative w-full bg-[color:var(--color-bg-subtle)]" style={{ paddingTop: "75%" }}>
          <img
            src={src}
            alt="crop preview"
            onLoad={(e) => {
              setNatW(e.currentTarget.naturalWidth);
              setNatH(e.currentTarget.naturalHeight);
            }}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ objectPosition: objPos }}
          />
          <div className="absolute inset-0 ring-2 ring-inset ring-[color:var(--color-accent-char)] pointer-events-none" />
        </div>

        {(isWider || isTaller) && (
          <div className="px-5 py-3 border-t border-[color:var(--color-border)]">
            <p className="text-xs text-[color:var(--color-text-muted)] mb-2">
              {isWider ? "← 左右にスライドして位置を調整 →" : "↑ 上下にスライドして位置を調整 ↓"}
            </p>
            <input
              type="range"
              min={0}
              max={100}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              className="w-full accent-[color:var(--color-accent-char)]"
            />
          </div>
        )}

        <div className="flex gap-2 px-5 py-4 border-t border-[color:var(--color-border)]">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-[color:var(--color-border)] py-2.5 text-sm text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming || natW === 0}
            className="flex-[2] rounded-xl bg-[color:var(--color-accent-char)] py-2.5 text-sm text-white font-bold disabled:opacity-50"
          >
            {confirming ? "処理中..." : "この範囲でトリミング"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <label className="block text-xs text-[color:var(--color-text-muted)]">{label}</label>
        {required ? (
          <span className="text-[10px] font-medium text-white bg-[color:var(--color-accent-warn)] rounded px-1 py-0.5 leading-none">必須</span>
        ) : (
          <span className="text-[10px] text-[color:var(--color-text-muted)] bg-[color:var(--color-bg-subtle)] rounded px-1 py-0.5 leading-none">任意</span>
        )}
      </div>
      {children}
    </div>
  );
}
