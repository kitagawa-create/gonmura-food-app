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
  status: MenuStatus;
};

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

  const [bulkMode, setBulkMode] = useState<"hidden" | "soldout" | "deleted" | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [applyingBulk, setApplyingBulk] = useState(false);

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

  const visibleMenus = useMemo(() => menus.filter((m) => m.status !== "deleted"), [menus]);

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
    for (const arr of groups.values()) {
      arr.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name, "ja");
      });
    }
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
        const menuDocId = newDocId ?? doc(collection(db, "menus")).id;
        await setDoc(doc(db, "menus", menuDocId), {
          id: menuDocId,
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
    const next: MenuStatus = menu.status === "hidden" ? "active" : "hidden";
    setMenus((prev) =>
      prev.map((x) => (x.id === menu.id ? { ...x, status: next } : x))
    );
    try {
      await updateDoc(doc(db, "menus", menu.id), {
        status: next,
        updatedAt: serverTimestamp(),
      });
      toast(next === "hidden" ? "非公開にしました" : "公開しました");
    } catch (e) {
      setMenus((prev) =>
        prev.map((x) => (x.id === menu.id ? { ...x, status: menu.status } : x))
      );
      setError(e instanceof Error ? e.message : "更新に失敗しました。");
      toast("更新に失敗しました");
    }
  }

  async function handleToggleSoldOut(menu: Menu) {
    const next: MenuStatus = menu.status === "soldout" ? "active" : "soldout";
    setMenus((prev) =>
      prev.map((x) => (x.id === menu.id ? { ...x, status: next } : x))
    );
    try {
      await updateDoc(doc(db, "menus", menu.id), {
        status: next,
        updatedAt: serverTimestamp(),
      });
      toast(next === "soldout" ? "売り切れに設定しました" : "売り切れを解除しました");
    } catch (e) {
      setMenus((prev) =>
        prev.map((x) => (x.id === menu.id ? { ...x, status: menu.status } : x))
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

  function enterBulkMode(mode: "hidden" | "soldout" | "deleted") {
    setBulkMode(mode);
    setSelectedIds(new Set());
  }

  function exitBulkMode() {
    setBulkMode(null);
    setSelectedIds(new Set());
  }

  async function applyBulkAction() {
    if (selectedIds.size === 0 || !bulkMode) return;
    setApplyingBulk(true);
    try {
      const batch = writeBatch(db);
      for (const id of selectedIds) {
        batch.update(doc(db, "menus", id), { status: bulkMode, updatedAt: serverTimestamp() });
      }
      await batch.commit();
      const label = bulkMode === "hidden" ? "非公開" : bulkMode === "soldout" ? "売り切れ" : "削除";
      toast(`${selectedIds.size}件を${label}にしました`);
      exitBulkMode();
      setBulkConfirmOpen(false);
    } catch {
      toast("一括変更に失敗しました");
    } finally {
      setApplyingBulk(false);
    }
  }

  const bulkLabel = bulkMode === "hidden" ? "非公開" : bulkMode === "soldout" ? "売り切れ" : "削除";

  return (
    <div className="w-full h-full flex flex-col -m-3 md:-m-6">
      {/* 固定ヘッダー */}
      <div className="shrink-0 px-3 md:px-6 pt-3 md:pt-6 pb-2 bg-[color:var(--color-bg-base)] border-b border-[color:var(--color-border)]">
        <AdminPageHeader
          title="メニュー管理"
          className="mb-3"
          rightSlot={
            role === "owner" ? (
              bulkMode ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[color:var(--color-text-muted)] font-medium">
                    {selectedIds.size}件選択中
                  </span>
                  <button
                    onClick={exitBulkMode}
                    className="rounded-xl border border-[color:var(--color-border)] px-4 py-2 text-sm text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={() => setBulkConfirmOpen(true)}
                    disabled={selectedIds.size === 0}
                    className={`rounded-xl px-4 py-2 text-sm text-white font-bold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed ${
                      bulkMode === "deleted"
                        ? "bg-[color:var(--color-accent-warn)]"
                        : bulkMode === "soldout"
                          ? "bg-[color:var(--color-accent-warn)]"
                          : "bg-[color:var(--color-text-muted)]"
                    }`}
                  >
                    {bulkLabel}にする
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => enterBulkMode("hidden")}
                    className="rounded-xl border border-[color:var(--color-border)] px-3 py-2 text-sm text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
                  >
                    非公開
                  </button>
                  <button
                    onClick={() => enterBulkMode("soldout")}
                    className="rounded-xl border border-[color:var(--color-accent-warn)]/40 px-3 py-2 text-sm text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10 transition-colors"
                  >
                    売り切れ
                  </button>
                  <button
                    onClick={() => enterBulkMode("deleted")}
                    className="rounded-xl border border-[color:var(--color-accent-warn)]/40 px-3 py-2 text-sm text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10 transition-colors"
                  >
                    削除
                  </button>
                  <button
                    onClick={() => {
                      setEditing(null);
                      setShowForm(true);
                    }}
                    className="rounded-xl bg-[color:var(--color-accent-char)] px-4 py-2 text-sm text-white font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors"
                  >
                    新規追加
                  </button>
                </div>
              )
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
      ) : visibleMenus.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">メニューがまだありません。</p>
      ) : (
        <div className="space-y-6">
          {(activeTab === "all"
            ? groupedMenus
            : (() => {
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
                  const isMoveTarget = role === "owner" && !bulkMode && movingMenuId !== null && movingMenuId !== m.id;
                  const isSelected = selectedIds.has(m.id);
                  const longPressRef = { current: null as ReturnType<typeof setTimeout> | null };
                  return (
                    <div
                      key={m.id}
                      draggable={role === "owner" && !bulkMode}
                      onDragStart={(e) => {
                        if (bulkMode) return;
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingMenuId(m.id);
                      }}
                      onDragEnter={() => { if (!bulkMode) setDragOverMenuId(m.id); }}
                      onDragOver={(e) => { if (!bulkMode) e.preventDefault(); }}
                      onDrop={(e) => {
                        if (bulkMode) return;
                        e.preventDefault();
                        handleMenuDrop(items, m.id);
                      }}
                      onDragEnd={() => {
                        setDraggingMenuId(null);
                        setDragOverMenuId(null);
                      }}
                      onTouchStart={() => {
                        if (role !== "owner" || bulkMode) return;
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
                      onClick={() => {
                        if (bulkMode) { toggleSelect(m.id); return; }
                        if (isMoveTarget) handleTapMoveMenu(items, m.id);
                      }}
                      className={`relative rounded-xl border bg-[color:var(--color-bg-card)] p-4 shadow-sm select-none ${
                        bulkMode ? "cursor-pointer" : ""
                      } ${
                        m.status === "hidden" ? "bg-[color:var(--color-bg-subtle)] opacity-60 border-dashed" : ""
                      } ${
                        isSelected
                          ? "border-[color:var(--color-accent-char)] ring-2 ring-[color:var(--color-accent-char)]/30"
                          : isMovingThis
                            ? "border-[color:var(--color-accent-char)] ring-2 ring-[color:var(--color-accent-char)]/30 bg-[color:var(--color-accent-char)]/5"
                            : m.status === "soldout"
                              ? "border-[color:var(--color-accent-warn)]"
                              : "border-[color:var(--color-border)]"
                      } ${isMoveTarget ? "cursor-pointer" : ""} ${isDragging ? "opacity-40" : ""}`}
                    >
                      {/* 一括選択モード: チェックボックス */}
                      {bulkMode && (
                        <div className="absolute left-3 top-3 z-10 pointer-events-none">
                          <div className={`h-5 w-5 rounded border-2 flex items-center justify-center ${
                            isSelected
                              ? "border-[color:var(--color-accent-char)] bg-[color:var(--color-accent-char)]"
                              : "border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]"
                          }`}>
                            {isSelected && (
                              <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="2,6 5,9 10,3" />
                              </svg>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 鉛筆アイコン編集ボタン（右上）: 一括モード時は非表示 */}
                      {role === "owner" && !bulkMode && (
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
                      <div className={`flex gap-3 ${bulkMode ? "pl-7" : ""}`}>
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
                          {(m.status === "hidden" || m.status === "soldout") && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {m.status === "hidden" && (
                                <span className="rounded-full bg-[color:var(--color-text-muted)] px-2 py-0.5 text-[10px] font-bold text-white">
                                  非公開中
                                </span>
                              )}
                              {m.status === "soldout" && (
                                <span className="rounded-full bg-[color:var(--color-accent-warn)] px-2 py-0.5 text-[10px] font-bold text-white">
                                  売り切れ中
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 下部ボタン行: 一括モード時は非表示 */}
                      {!bulkMode && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => {
                              if (m.status !== "hidden") {
                                setToggleConfirm({ menu: m, type: "available" });
                              } else {
                                handleToggleAvailable(m);
                              }
                            }}
                            aria-pressed={m.status === "hidden"}
                            className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
                              m.status === "hidden"
                                ? "border-[color:var(--color-accent-char)] bg-[color:var(--color-accent-char)] text-white hover:opacity-90"
                                : "border-[color:var(--color-accent-char)]/40 text-[color:var(--color-accent-char)] hover:bg-[color:var(--color-accent-char)]/10"
                            }`}
                          >
                            {m.status === "hidden" ? "公開する" : "非公開にする"}
                          </button>
                          <button
                            onClick={() => {
                              if (m.status !== "soldout") {
                                setToggleConfirm({ menu: m, type: "soldout" });
                              } else {
                                handleToggleSoldOut(m);
                              }
                            }}
                            aria-pressed={m.status === "soldout"}
                            className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
                              m.status === "soldout"
                                ? "border-[color:var(--color-accent-warn)] bg-[color:var(--color-accent-warn)] text-white hover:opacity-90"
                                : "border-[color:var(--color-accent-warn)]/40 text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10"
                            }`}
                          >
                            {m.status === "soldout" ? "売り切れ解除" : "売り切れにする"}
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
                      )}
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

      <ConfirmDialog
        open={bulkConfirmOpen}
        title={`選択した${selectedIds.size}件を${bulkLabel}にする`}
        message={
          bulkMode === "hidden"
            ? "選択したメニューをお客様から非表示にします。注文できなくなります。"
            : bulkMode === "soldout"
              ? "選択したメニューを売り切れに設定します。お客様は注文できなくなります。"
              : "選択したメニューを削除します。過去の売上データへの影響を防ぐためデータは内部に保持されます。"
        }
        confirmLabel={`${bulkLabel}にする`}
        confirmColor="red"
        onConfirm={applyBulkAction}
        onCancel={() => setBulkConfirmOpen(false)}
        loading={applyingBulk}
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
  onSave: (data: MenuFormData, imageBlob: Blob | null, id?: string) => Promise<void>;
}) {
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
    if (file) setCropFile(file);
    e.target.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (form.categoryIds.length === 0) return;
    setSaving(true);
    await onSave(form, croppedBlob, menu?.id);
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
          <Field label="価格(税込・円)" required>
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
              <div className="mb-2 relative w-full rounded-lg overflow-hidden" style={{ paddingTop: "75%" }}>
                <img
                  src={preview}
                  alt="プレビュー"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </div>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="w-full text-sm text-[color:var(--color-text-muted)] file:mr-3 file:rounded file:border-0 file:bg-[color:var(--color-bg-subtle)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[color:var(--color-text-primary)] hover:file:bg-[color:var(--color-border)]"
            />
            {croppedBlob && (
              <p className="mt-1 text-xs text-[color:var(--color-accent-negi)]">✓ 4:3でトリミング済み</p>
            )}
          </Field>
          <Field label="カテゴリ(複数選択可)" required>
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
            {form.categoryIds.length === 0 && (
              <p className="mt-1 text-xs text-[color:var(--color-accent-warn)]">カテゴリを1つ以上選択してください</p>
            )}
          </Field>
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
