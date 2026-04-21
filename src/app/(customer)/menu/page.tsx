"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, collectionGroup, query, where, getDocs, orderBy, onSnapshot, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Menu, Category, CartItemTopping, CartItem } from "@/types";
import { normalizeMenu } from "@/lib/order-utils";
import { useCart } from "@/lib/cart-context";
import { FadeImage } from "@/components/ui/FadeImage";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import { CartPanel } from "@/components/customer/CartPanel";
import Link from "next/link";

const TABLE_KEY = "gonmura-table";
const TABLE_ID_KEY = "gonmura-table-id";

type SelectionLine = { menu: Menu; quantity: number };

// カテゴリ名からメニューの役割を判定するヘルパー
function menuBelongsToCategory(menu: Menu, categories: Category[], categoryName: string): boolean {
  return menu.categoryIds.some((cid) => {
    const cat = categories.find((c) => c.id === cid);
    return cat?.name === categoryName;
  });
}

export default function MenuPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [menusLoaded, setMenusLoaded] = useState(false);
  const [imagesReady, setImagesReady] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [selectedNote, setSelectedNote] = useState("");
  // ラーメンモーダルのトッピング/サイド選択 (menuId → quantity)
  const [extraQty, setExtraQty] = useState<Record<string, number>>({});
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [showGuestCountDialog, setShowGuestCountDialog] = useState(false);
  const [guestCountInput, setGuestCountInput] = useState<number>(1);
  const [showTableSelectDialog, setShowTableSelectDialog] = useState(false);
  const [dialogTables, setDialogTables] = useState<{ id: string; tableNumber: string }[]>([]);
  const [dialogTablesLoading, setDialogTablesLoading] = useState(false);
  const { addItem, updateItem, totalItems, tableNumber, setTableNumber, clearCart, resetSession, guestCount, setGuestCount, customerId } =
    useCart();
  const router = useRouter();
  const prevHasUnpaidRef = useRef<boolean | undefined>(undefined);
  const [hasUnpaidOrders, setHasUnpaidOrders] = useState(() => customerId !== null);
  const [ordersLoaded, setOrdersLoaded] = useState(false);

  useEffect(() => {
    if (tableNumber === null) {
      const timer = setTimeout(() => {
        const saved = localStorage.getItem(TABLE_KEY);
        if (!saved || saved === "null") {
          router.replace("/setup");
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [tableNumber, router]);

  // テーブルが削除されたら /setup へ
  useEffect(() => {
    const tableId = typeof window !== "undefined" ? localStorage.getItem(TABLE_ID_KEY) : null;
    if (!tableId) return;
    return onSnapshot(doc(db, "tables", tableId), (snap) => {
      if (!snap.exists()) {
        localStorage.removeItem(TABLE_ID_KEY);
        setTableNumber(null);
      }
    });
  }, [setTableNumber]);

  useEffect(() => {
    setOrdersLoaded(false);
    prevHasUnpaidRef.current = undefined;
    if (tableNumber === null) {
      setHasUnpaidOrders(false);
      return;
    }
    if (customerId === null) {
      setHasUnpaidOrders(false);
      setOrdersLoaded(true);
      return;
    }
    const unsub = onSnapshot(
      query(collectionGroup(db, "orders"), where("customerId", "==", customerId)),
      (snap) => {
        const statuses = snap.docs.map((d) => (d.data() as { status: string }).status);
        const hasUnpaid = statuses.some((s) => s === "pending" || s === "completed");
        const hasPaid = statuses.some((s) => s === "paid");
        if ((prevHasUnpaidRef.current === undefined || prevHasUnpaidRef.current === true) && !hasUnpaid && hasPaid) {
          resetSession();
        }
        prevHasUnpaidRef.current = hasUnpaid;
        setHasUnpaidOrders(hasUnpaid);
        setOrdersLoaded(true);
      },
      () => {
        setHasUnpaidOrders(false);
        setOrdersLoaded(true);
      }
    );
    return unsub;
  }, [tableNumber, customerId, resetSession]);

  // 公開中のメニューを購読 (status 変更を即時反映)
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "menus"), where("status", "in", ["active", "soldout"])),
      (snap) => {
        setMenus(snap.docs.map((d) => normalizeMenu(d.id, d.data() as Record<string, unknown>)));
        setMenusLoaded(true);
      }
    );
    return unsub;
  }, []);

  // 初回のメニュー取得時に全画像をプリロード。
  // 完了するまでカードを描画しないことで、スケルトン→画像のチラつきを防ぐ。
  useEffect(() => {
    if (!menusLoaded || imagesReady) return;
    const urls = menus.map((m) => m.imageUrl).filter((u): u is string => !!u);
    if (urls.length === 0) {
      setImagesReady(true);
      return;
    }
    let cancelled = false;
    Promise.all(
      urls.map(
        (url) =>
          new Promise<void>((resolve) => {
            const img = new window.Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = url;
          })
      )
    ).then(() => {
      if (!cancelled) setImagesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [menusLoaded, menus, imagesReady]);

  // カテゴリは変更頻度低 - 一度だけ
  useEffect(() => {
    (async () => {
      const snap = await getDocs(query(collection(db, "categories"), orderBy("sortOrder", "asc")));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Category);
      setCategories(data);
      if (data.length > 0) setActiveCategory((cur) => cur ?? data[0].id);
      setLoading(false);
    })();
  }, []);

  // モーダルが開いている商品が非公開化または売り切れになったら強制クローズ
  useEffect(() => {
    if (!selectedMenu) return;
    const stillThere = menus.find((m) => m.id === selectedMenu.id);
    if (!stillThere || stillThere.status === "soldout") {
      setSelectedMenu(null);
      setExtraQty({});
    }
  }, [menus, selectedMenu]);

  // 商品モーダル表示中は背景スクロールを無効化
  useEffect(() => {
    if (selectedMenu) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [selectedMenu]);

  // 初回セッション or 全精算後: orders読み込み済み・未払いなし・客数未設定のとき表示
  useEffect(() => {
    if (tableNumber === null) return;
    if (!ordersLoaded) return;
    if (guestCount !== null) return;
    if (hasUnpaidOrders) return;
    setGuestCountInput(1);
    setShowGuestCountDialog(true);
  }, [tableNumber, guestCount, ordersLoaded, hasUnpaidOrders]);

  const filteredMenus = activeCategory
    ? (() => {
        const isOsusume = categories.find((c) => c.id === activeCategory)?.name === "おすすめ";
        return menus
          .filter((menu) => menu.categoryIds.includes(activeCategory))
          .sort((a, b) => {
            const aOrder = isOsusume ? a.sortOrderFeatured : a.sortOrder;
            const bOrder = isOsusume ? b.sortOrderFeatured : b.sortOrder;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.name.localeCompare(b.name, "ja");
          });
      })()
    : [];

  const activeCategoryName = categories.find((c) => c.id === activeCategory)?.name;

  const categoriesWithMenus = useMemo(
    () => categories.filter((cat) => menus.some((m) => m.categoryIds.includes(cat.id))),
    [categories, menus]
  );

  useEffect(() => {
    if (categoriesWithMenus.length === 0) return;
    if (!activeCategory || categoriesWithMenus.some((c) => c.id === activeCategory)) return;
    setActiveCategory(categoriesWithMenus[0].id);
  }, [categoriesWithMenus, activeCategory]);

  // 「トッピング」カテゴリの商品
  const toppings = useMemo(
    () =>
      menus
        .filter((m) => menuBelongsToCategory(m, categories, "トッピング") && m.status !== "soldout")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [menus, categories]
  );

  // 選択中の商品が「ラーメン」カテゴリかどうか
  const isRamenFlow = selectedMenu
    ? menuBelongsToCategory(selectedMenu, categories, "ラーメン")
    : false;

  const extraLines: SelectionLine[] = isRamenFlow
    ? Object.entries(extraQty)
        .filter(([, q]) => q > 0)
        .map(([id, q]) => {
          const m = menus.find((x) => x.id === id);
          return m ? { menu: m, quantity: q } : null;
        })
        .filter((x): x is SelectionLine => x !== null)
    : [];

  // ラーメンコンボは 1 杯 = 1 コンボ固定。非ラーメンのみ selectedQuantity を使う。
  const effectiveQty = isRamenFlow ? 1 : selectedQuantity;
  const baseSubtotal = selectedMenu ? selectedMenu.price * effectiveQty : 0;
  const extrasSubtotal = extraLines.reduce((s, l) => s + l.menu.price * l.quantity, 0);
  const modalTotal = baseSubtotal + extrasSubtotal;

  function closeModal() {
    setSelectedMenu(null);
    setExtraQty({});
    setSelectedNote("");
    setEditingLineId(null);
  }

  function handleEditCartItem(item: CartItem) {
    const menu = menus.find((m) => m.id === item.menuId);
    if (!menu) return;
    setEditingLineId(item.lineId);
    setSelectedMenu(menu);
    setSelectedQuantity(item.quantity);
    setSelectedNote(item.note);
    const qty: Record<string, number> = {};
    for (const t of item.toppings) qty[t.menuId] = t.quantity;
    setExtraQty(qty);
  }

  // --- スワイプ / マウスドラッグでカテゴリ切替 ---
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_THRESHOLD = 30; // px — 感度高め

  const swipeToCategory = useCallback(
    (dx: number, dy: number) => {
      if (categoriesWithMenus.length === 0 || !activeCategory) return;
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
      const idx = categoriesWithMenus.findIndex((c) => c.id === activeCategory);
      if (idx < 0) return;
      if (dx < 0 && idx < categoriesWithMenus.length - 1) {
        setActiveCategory(categoriesWithMenus[idx + 1].id);
      } else if (dx > 0 && idx > 0) {
        setActiveCategory(categoriesWithMenus[idx - 1].id);
      }
    },
    [categoriesWithMenus, activeCategory]
  );

  // タッチ (スマホ / タブレット)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    pointerRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!pointerRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - pointerRef.current.x;
      const dy = t.clientY - pointerRef.current.y;
      pointerRef.current = null;
      swipeToCategory(dx, dy);
    },
    [swipeToCategory]
  );

  // マウスドラッグ (PC)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!pointerRef.current) return;
      const dx = e.clientX - pointerRef.current.x;
      const dy = e.clientY - pointerRef.current.y;
      pointerRef.current = null;
      swipeToCategory(dx, dy);
    },
    [swipeToCategory]
  );

  if (loading || tableNumber === null || !menusLoaded || !imagesReady) {
    return <FullScreenLoader />;
  }

  return (
    <div className="h-[100dvh] w-full bg-[color:var(--color-bg-base)] grid grid-cols-1 grid-rows-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_240px] sm:grid-rows-1 md:grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* メインカラム (メニュー側)。min-w-0 で画像 intrinsic 幅による左カラム伸長を防ぎ、
          w-full で常にトラック幅いっぱいに広がるよう固定。 */}
      <div className="flex min-w-0 min-h-0 w-full flex-1 flex-col overflow-y-auto">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 bg-[color:var(--color-bg-card)] border-b border-[color:var(--color-border)]">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[color:var(--color-text-primary)] tracking-wide">
              Gonmura Food
            </h1>
            <div className="flex items-center gap-2">
              <p className="text-xs text-[color:var(--color-text-muted)]">テーブル {tableNumber}</p>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem(TABLE_ID_KEY);
                  setTableNumber(null);
                }}
                className="text-[10px] text-[color:var(--color-text-muted)] underline hover:text-[color:var(--color-text-primary)] transition-colors"
              >
                変更
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/order/history"
              className="text-xs bg-[color:var(--color-bg-subtle)] text-[color:var(--color-text-primary)] border border-[color:var(--color-border)] px-3 py-1.5 rounded-full hover:opacity-80 transition-opacity"
            >
              注文履歴
            </Link>
          </div>
        </div>
        {/* カテゴリタブ */}
        <div className="max-w-screen-2xl mx-auto px-2 sm:px-4 lg:px-6 flex overflow-x-auto no-scrollbar">
          {categoriesWithMenus.map((category) => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeCategory === category.id
                  ? "text-[color:var(--color-accent-char)] border-b-2 border-[color:var(--color-accent-char)]"
                  : "text-[color:var(--color-text-muted)] border-b-2 border-transparent hover:text-[color:var(--color-text-primary)]"
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      </header>

      {/* メニュー一覧 (左右スワイプ / マウスドラッグでカテゴリ移動) */}
      <main
        className="w-full px-4 sm:px-6 lg:px-8 py-4 lg:py-6"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        {filteredMenus.length === 0 ? (
          <p className="text-[color:var(--color-text-muted)] text-center py-12">
            このカテゴリにはメニューがありません
          </p>
        ) : (
          <div
            key={activeCategory}
            className="grid w-full gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
          >
            {filteredMenus.map((menu) => {
              const sold = menu.status === "soldout";
              return (
                <button
                  key={menu.id}
                  type="button"
                  disabled={sold}
                  aria-disabled={sold}
                  aria-label={sold ? `${menu.name} (売り切れ)` : menu.name}
                  onClick={() => {
                    if (sold) return;
                    setSelectedMenu(menu);
                    setSelectedQuantity(1);
                    setExtraQty({});
                  }}
                  className={`relative flex w-full flex-col text-left rounded-xl overflow-hidden bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] transition-colors ${
                    sold
                      ? "cursor-not-allowed"
                      : "hover:border-[color:var(--color-accent-soy)]"
                  }`}
                >
                  {/* 画像領域: padding-top:75% で確実に 4:3 固定。aspect-ratio だけだと
                      大きな縦長画像や一部ブラウザで高さが滲むことがあるためこちらを採用。 */}
                  {menu.imageUrl ? (
                    <div
                      className={`relative w-full shrink-0 overflow-hidden rounded-t-xl ${
                        sold ? "opacity-40 grayscale" : ""
                      }`}
                      style={{ paddingTop: "75%" }}
                    >
                      <div className="absolute inset-0">
                        <FadeImage
                          src={menu.imageUrl}
                          alt={menu.name}
                          className="w-full h-full"
                        />
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`relative w-full shrink-0 overflow-hidden bg-[color:var(--color-bg-subtle)] ${
                        sold ? "opacity-40 grayscale" : ""
                      }`}
                      style={{ paddingTop: "75%" }}
                      aria-hidden
                    >
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-[color:var(--color-text-muted)]">
                        画像なし
                      </div>
                    </div>
                  )}
                  {/* テキスト領域: 各行を固定高 + 固定余白で、全カードの縦位置を揃える */}
                  <div
                    className={`flex flex-col p-4 gap-2 ${sold ? "opacity-60" : ""}`}
                  >
                    <h3 className="h-12 text-base font-bold leading-6 line-clamp-2 text-[color:var(--color-text-primary)]">
                      {menu.name}
                    </h3>
                    <p className="h-10 text-sm leading-5 line-clamp-2 text-[color:var(--color-text-muted)]">
                      {menu.description || "\u00A0"}
                    </p>
                    <p className="h-7 text-lg font-bold leading-7 text-[color:var(--color-accent-char)]">
                      {menu.price.toLocaleString()}円
                    </p>
                  </div>
                  {sold && (
                    <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-[22%]">
                      <span className="rounded-full bg-[color:var(--color-accent-warn)]/90 px-5 py-2 text-base font-bold text-white shadow-md">
                        売り切れ
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </main>
      </div>
      {/* カート (sm+ は右カラム 100dvh / sm 未満は下段 max 45dvh) */}
      <aside className="shrink-0 max-h-[45dvh] overflow-hidden border-t border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] sm:max-h-none sm:border-t-0 sm:border-l">
        <CartPanel hasOrders={hasUnpaidOrders} onEditItem={handleEditCartItem} />
      </aside>

      {/* 商品詳細モーダル */}
      {selectedMenu && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-0 md:p-6"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-lg md:max-w-xl lg:max-w-2xl max-h-[100dvh] md:max-h-[90dvh] flex flex-col bg-[color:var(--color-bg-card)] rounded-t-2xl md:rounded-2xl overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
              {/* 画像: モバイルは上段フル幅、md+は左列2/5 */}
              <div className="shrink-0 md:w-2/5 bg-[color:var(--color-bg-subtle)] max-h-[25dvh] md:max-h-none overflow-hidden">
                <div className="relative w-full overflow-hidden" style={{ paddingTop: "75%" }}>
                  <div className="absolute inset-0">
                    {selectedMenu.imageUrl ? (
                      <FadeImage
                        src={selectedMenu.imageUrl}
                        alt={selectedMenu.name}
                        className="w-full h-full"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-sm text-[color:var(--color-text-muted)]">画像なし</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* コンテンツ: md+は独立スクロール */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div>
                  <h2 className="text-xl font-bold text-[color:var(--color-text-primary)]">
                    {selectedMenu.name}
                  </h2>
                  {selectedMenu.description && (
                    <p className="text-sm text-[color:var(--color-text-muted)] mt-2">
                      {selectedMenu.description}
                    </p>
                  )}
                  <p className="text-2xl font-bold text-[color:var(--color-accent-char)] mt-3">
                    {selectedMenu.price.toLocaleString()}円
                  </p>
                </div>

                {/* 数量ステッパー (ラーメンは 1 杯固定のため非ラーメンのみ) */}
                {!isRamenFlow && (
                  <div className="flex items-center justify-between rounded-xl bg-[color:var(--color-bg-subtle)] p-3">
                    <span className="text-sm text-[color:var(--color-text-primary)]">数量</span>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setSelectedQuantity((q) => Math.max(1, q - 1))}
                        disabled={selectedQuantity <= 1}
                        aria-label="数量を減らす"
                        className="w-11 h-11 rounded-full bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] text-[color:var(--color-text-primary)] text-xl font-bold hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-xl font-bold text-[color:var(--color-text-primary)] tabular-nums">
                        {selectedQuantity}
                      </span>
                      <button
                        onClick={() => setSelectedQuantity((q) => Math.min(99, q + 1))}
                        disabled={selectedQuantity >= 99}
                        aria-label="数量を増やす"
                        className="w-11 h-11 rounded-full bg-[color:var(--color-accent-char)] text-white text-xl font-bold hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}

                {/* ラーメン選択時のみ: トッピング選択 */}
                {isRamenFlow && toppings.length > 0 && (
                  <section>
                    <h3 className="text-sm font-bold text-[color:var(--color-text-primary)] mb-2">
                      トッピングを追加
                    </h3>
                    <ul className="space-y-2">
                      {toppings.map((t) => {
                        const q = extraQty[t.id] ?? 0;
                        return (
                          <li
                            key={t.id}
                            className="flex items-center gap-3 rounded-xl bg-[color:var(--color-bg-subtle)] px-3 py-2"
                          >
                            {t.imageUrl && (
                              <FadeImage
                                src={t.imageUrl}
                                alt={t.name}
                                className="w-12 h-12 rounded-lg shrink-0"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-[color:var(--color-text-primary)] truncate">
                                {t.name}
                              </p>
                              <p className="text-xs text-[color:var(--color-accent-char)] font-bold">
                                +{t.price.toLocaleString()}円
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setExtraQty((prev) => ({
                                    ...prev,
                                    [t.id]: Math.max(0, (prev[t.id] ?? 0) - 1),
                                  }))
                                }
                                disabled={q <= 0}
                                aria-label={`${t.name}を減らす`}
                                className="w-9 h-9 rounded-full bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] text-[color:var(--color-text-primary)] font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                −
                              </button>
                              <span className="w-6 text-center text-sm font-bold text-[color:var(--color-text-primary)] tabular-nums">
                                {q}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setExtraQty((prev) => ({
                                    ...prev,
                                    [t.id]: Math.min(20, (prev[t.id] ?? 0) + 1),
                                  }))
                                }
                                aria-label={`${t.name}を追加`}
                                className="w-9 h-9 rounded-full bg-[color:var(--color-accent-soy)] text-white font-bold hover:opacity-90"
                              >
                                +
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {/* 備考欄 */}
                <div>
                  <label className="block text-sm font-bold text-[color:var(--color-text-primary)] mb-1">
                    備考・アレルギー
                  </label>
                  <textarea
                    value={selectedNote}
                    onChange={(e) => setSelectedNote(e.target.value)}
                    placeholder="例: 辛め、ネギ抜き、アレルギー情報など"
                    maxLength={100}
                    rows={2}
                    className="w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)] resize-none"
                  />
                  <p className={`mt-1 text-right text-xs ${selectedNote.length >= 90 ? "text-[color:var(--color-accent-warn)]" : "text-[color:var(--color-text-muted)]"}`}>
                    {selectedNote.length}/100
                  </p>
                </div>

              </div>
            </div>

            <div className="border-t border-[color:var(--color-border)] p-4 flex gap-3 bg-[color:var(--color-bg-card)]">
              <button
                onClick={closeModal}
                className="flex-1 py-3 rounded-xl border border-[color:var(--color-border)] text-[color:var(--color-text-primary)] font-medium hover:opacity-80 transition-opacity"
              >
                閉じる
              </button>
              <button
                onClick={() => {
                  if (!selectedMenu) return;
                  if (isRamenFlow) {
                    const toppings: CartItemTopping[] = extraLines.map((l) => ({
                      menuId: l.menu.id,
                      name: l.menu.name,
                      price: l.menu.price,
                      quantity: l.quantity,
                    }));
                    if (editingLineId) {
                      updateItem(editingLineId, { quantity: 1, toppings, note: selectedNote.trim() });
                    } else {
                      addItem(
                        {
                          menuId: selectedMenu.id,
                          name: selectedMenu.name,
                          price: selectedMenu.price,
                          toppings,
                          ...(selectedNote.trim() ? { note: selectedNote.trim() } : {}),
                        },
                        1
                      );
                    }
                  } else {
                    if (editingLineId) {
                      updateItem(editingLineId, { quantity: selectedQuantity, toppings: [], note: selectedNote.trim() });
                    } else {
                      addItem(
                        {
                          menuId: selectedMenu.id,
                          name: selectedMenu.name,
                          price: selectedMenu.price,
                          ...(selectedNote.trim() ? { note: selectedNote.trim() } : {}),
                        },
                        selectedQuantity
                      );
                    }
                  }
                  closeModal();
                }}
                className="flex-[2] py-3 rounded-xl bg-[color:var(--color-accent-char)] text-white font-bold hover:opacity-90 transition-opacity"
              >
                {editingLineId ? `変更を保存 ¥${modalTotal.toLocaleString()}` : `カートに追加 ¥${modalTotal.toLocaleString()}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 人数選択ダイアログ（精算後の新規セッション開始時） */}
      {showGuestCountDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div
            className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-xl font-bold text-[color:var(--color-text-primary)] text-center">
              いらっしゃいませ
            </h2>
            <p className="mb-5 text-sm text-[color:var(--color-text-muted)] text-center">
              何名様でしょうか？
            </p>
            <div className="flex items-center justify-center gap-6 mb-2">
              <button
                type="button"
                onClick={() => setGuestCountInput((n) => Math.max(1, n - 1))}
                className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[color:var(--color-border)] text-2xl font-bold text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
              >
                −
              </button>
              <span className="w-16 text-center text-4xl font-black text-[color:var(--color-text-primary)] tabular-nums">
                {guestCountInput}
              </span>
              <button
                type="button"
                onClick={() => setGuestCountInput((n) => Math.min(20, n + 1))}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-accent-char)] text-white text-2xl font-bold hover:opacity-90 transition-opacity"
              >
                +
              </button>
            </div>
            <p className="text-center text-sm text-[color:var(--color-text-muted)] mb-5">名様</p>
            <button
              type="button"
              onClick={() => {
                setGuestCount(guestCountInput);
                setShowGuestCountDialog(false);
                const osusume = categoriesWithMenus.find((c) => c.name === "おすすめ") ?? categoriesWithMenus[0];
                if (osusume) setActiveCategory(osusume.id);
              }}
              className="w-full rounded-xl bg-[color:var(--color-accent-char)] py-3 text-base font-bold text-white hover:opacity-90 transition-opacity"
            >
              決定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
