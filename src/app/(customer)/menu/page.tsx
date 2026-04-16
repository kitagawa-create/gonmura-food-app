"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, getDocs, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Menu, MenuKind, Category, CartItem } from "@/types";
import { useCart } from "@/lib/cart-context";
import { FadeImage } from "@/components/ui/FadeImage";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import Link from "next/link";

const TABLE_KEY = "gonmura-table";

function kindOf(menu: Menu): MenuKind {
  return menu.kind ?? "side";
}

type SelectionLine = { menu: Menu; quantity: number };

export default function MenuPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  // ラーメンモーダルのトッピング/サイド選択 (menuId → quantity)
  const [extraQty, setExtraQty] = useState<Record<string, number>>({});
  const [showTableChange, setShowTableChange] = useState(false);
  const [newTableInput, setNewTableInput] = useState("");
  const [tableChangeError, setTableChangeError] = useState("");
  const [hasUnpaidOrders, setHasUnpaidOrders] = useState(false);
  const { addItem, totalItems, totalAmount, tableNumber, setTableNumber, clearCart } = useCart();
  const router = useRouter();

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

  useEffect(() => {
    if (tableNumber === null) {
      setHasUnpaidOrders(false);
      return;
    }
    const q = query(
      collection(db, "orders"),
      where("tableNumber", "==", tableNumber),
      where("status", "in", ["pending", "preparing", "completed"])
    );
    const unsub = onSnapshot(q, (snap) => setHasUnpaidOrders(!snap.empty));
    return unsub;
  }, [tableNumber]);

  // 公開中のメニューを購読 (isAvailable 即時反映)
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "menus"), where("isAvailable", "==", true)),
      (snap) => {
        setMenus(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Menu));
      }
    );
    return unsub;
  }, []);

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
    if (!stillThere || stillThere.isSoldOut === true) {
      setSelectedMenu(null);
      setExtraQty({});
    }
  }, [menus, selectedMenu]);

  const filteredMenus = activeCategory
    ? menus
        .filter((menu) => menu.categoryIds.includes(activeCategory))
        .sort((a, b) => {
          const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
          const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return a.name.localeCompare(b.name, "ja");
        })
    : [];

  const activeCategoryName = categories.find((c) => c.id === activeCategory)?.name;
  const isRecommend = activeCategoryName === "おすすめ";

  const toppings = useMemo(
    () =>
      menus
        .filter((m) => kindOf(m) === "topping" && m.isSoldOut !== true)
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)),
    [menus]
  );
  const recommends = useMemo(
    () =>
      menus
        .filter(
          (m) => (kindOf(m) === "side" || kindOf(m) === "drink") && m.isSoldOut !== true
        )
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)),
    [menus]
  );

  const selectedKind = selectedMenu ? kindOf(selectedMenu) : "side";
  const isRamenFlow = selectedKind === "ramen";

  const extraLines: SelectionLine[] = isRamenFlow
    ? Object.entries(extraQty)
        .filter(([, q]) => q > 0)
        .map(([id, q]) => {
          const m = menus.find((x) => x.id === id);
          return m ? { menu: m, quantity: q } : null;
        })
        .filter((x): x is SelectionLine => x !== null)
    : [];

  const ramenSubtotal = selectedMenu ? selectedMenu.price * selectedQuantity : 0;
  const extrasSubtotal = extraLines.reduce((s, l) => s + l.menu.price * l.quantity, 0);
  const modalTotal = ramenSubtotal + extrasSubtotal;

  // --- スワイプでカテゴリ切替 ---
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchRef.current || categories.length === 0 || !activeCategory) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchRef.current.x;
      const dy = t.clientY - touchRef.current.y;
      touchRef.current = null;
      // 横方向が縦方向より大きく、50px 以上の場合のみスワイプ判定
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      const idx = categories.findIndex((c) => c.id === activeCategory);
      if (idx < 0) return;
      if (dx < 0 && idx < categories.length - 1) {
        setActiveCategory(categories[idx + 1].id);
      } else if (dx > 0 && idx > 0) {
        setActiveCategory(categories[idx - 1].id);
      }
    },
    [categories, activeCategory]
  );

  if (loading || tableNumber === null) {
    return <FullScreenLoader />;
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-bg-base)] pb-28">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 bg-[color:var(--color-bg-card)] border-b border-[color:var(--color-border)]">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[color:var(--color-text-primary)] tracking-wide">
              Gonmura Food
            </h1>
            <div className="flex items-center gap-2">
              <p className="text-xs text-[color:var(--color-text-muted)]">テーブル {tableNumber}</p>
              {!hasUnpaidOrders && (
                <button
                  type="button"
                  onClick={() => {
                    setNewTableInput("");
                    setTableChangeError("");
                    setShowTableChange(true);
                  }}
                  className="text-[10px] text-[color:var(--color-text-muted)] underline hover:text-[color:var(--color-text-primary)] transition-colors"
                >
                  変更
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/order/history"
              className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] transition-colors"
            >
              注文履歴
            </Link>
            <Link
              href="/bill"
              className="text-xs bg-[color:var(--color-bg-subtle)] text-[color:var(--color-text-primary)] border border-[color:var(--color-border)] px-3 py-1.5 rounded-full hover:opacity-80 transition-opacity"
            >
              お会計
            </Link>
          </div>
        </div>
        {/* カテゴリタブ */}
        <div className="max-w-screen-2xl mx-auto px-2 sm:px-4 lg:px-6 flex overflow-x-auto no-scrollbar">
          {categories.map((category) => (
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

      {/* メニュー一覧 (左右スワイプでカテゴリ移動) */}
      <main
        className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-6"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {filteredMenus.length === 0 ? (
          <p className="text-[color:var(--color-text-muted)] text-center py-12">
            このカテゴリにはメニューがありません
          </p>
        ) : isRecommend ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-5">
            {filteredMenus.map((menu) => {
              const sold = menu.isSoldOut === true;
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
                  className={`relative w-full text-left rounded-xl overflow-hidden bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] transition-colors ${
                    sold
                      ? "cursor-not-allowed"
                      : "hover:border-[color:var(--color-accent-soy)]"
                  }`}
                >
                  {menu.imageUrl && (
                    <div className={sold ? "opacity-40 grayscale" : ""}>
                      <FadeImage
                        src={menu.imageUrl}
                        alt={menu.name}
                        className="w-full h-40 sm:h-48 md:h-44 lg:h-48"
                      />
                    </div>
                  )}
                  <div className={`p-4 ${sold ? "opacity-60" : ""}`}>
                    <h3 className="text-base lg:text-lg font-bold text-[color:var(--color-text-primary)]">
                      {menu.name}
                    </h3>
                    <p className="text-sm text-[color:var(--color-text-muted)] mt-1 line-clamp-2">
                      {menu.description}
                    </p>
                    <p className="text-lg lg:text-xl font-bold text-[color:var(--color-accent-char)] mt-2">
                      {menu.price.toLocaleString()}円
                    </p>
                  </div>
                  {sold && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="rounded-full bg-[color:var(--color-accent-warn)]/90 px-5 py-2 text-base font-bold text-white shadow-md">
                        売り切れ
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 lg:gap-4">
            {filteredMenus.map((menu) => {
              const sold = menu.isSoldOut === true;
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
                  className={`relative text-left rounded-xl overflow-hidden bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] transition-colors ${
                    sold
                      ? "cursor-not-allowed"
                      : "hover:border-[color:var(--color-accent-soy)]"
                  }`}
                >
                  {menu.imageUrl && (
                    <div className={sold ? "opacity-40 grayscale" : ""}>
                      <FadeImage
                        src={menu.imageUrl}
                        alt={menu.name}
                        className="w-full h-28 sm:h-32 md:h-36 lg:h-40"
                      />
                    </div>
                  )}
                  <div className={`p-3 lg:p-4 ${sold ? "opacity-60" : ""}`}>
                    <h3 className="text-sm lg:text-base font-semibold text-[color:var(--color-text-primary)] leading-tight line-clamp-2">
                      {menu.name}
                    </h3>
                    <p className="text-sm lg:text-base font-bold text-[color:var(--color-accent-char)] mt-1">
                      {menu.price.toLocaleString()}円
                    </p>
                  </div>
                  {sold && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="rounded-full bg-[color:var(--color-accent-warn)]/90 px-3 py-1 text-sm font-bold text-white shadow-md">
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

      {/* フローティングカートボタン */}
      <Link
        href="/order"
        className="fixed bottom-6 right-6 z-20 bg-[color:var(--color-accent-char)] text-white rounded-full shadow-lg px-5 py-3 flex items-center gap-2 hover:opacity-90 transition-opacity"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"
          />
        </svg>
        <span className="font-bold">{totalItems}点</span>
        <span className="opacity-80">¥{totalAmount.toLocaleString()}</span>
      </Link>

      {/* 商品詳細モーダル */}
      {selectedMenu && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-0 md:p-6"
          onClick={() => {
            setSelectedMenu(null);
            setExtraQty({});
          }}
        >
          <div
            className="w-full max-w-lg md:max-w-xl lg:max-w-2xl max-h-[100dvh] md:max-h-[90dvh] flex flex-col bg-[color:var(--color-bg-card)] rounded-t-2xl md:rounded-2xl overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-y-auto">
              {selectedMenu.imageUrl && (
                <FadeImage
                  src={selectedMenu.imageUrl}
                  alt={selectedMenu.name}
                  className="w-full h-48 md:h-56 lg:h-64"
                />
              )}
              <div className="p-5 space-y-5">
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

                {/* 数量ステッパー */}
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

                {/* ラーメン選択時のみ: サイド/ドリンク推薦 */}
                {isRamenFlow && recommends.length > 0 && (
                  <section>
                    <h3 className="text-sm font-bold text-[color:var(--color-text-primary)] mb-2">
                      こちらもいかがですか
                    </h3>
                    <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
                      {recommends.map((r) => {
                        const q = extraQty[r.id] ?? 0;
                        return (
                          <div
                            key={r.id}
                            className="shrink-0 w-32 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] overflow-hidden"
                          >
                            {r.imageUrl && (
                              <FadeImage src={r.imageUrl} alt={r.name} className="w-full h-20" />
                            )}
                            <div className="p-2">
                              <p className="text-xs font-semibold text-[color:var(--color-text-primary)] line-clamp-2 leading-snug">
                                {r.name}
                              </p>
                              <p className="text-xs text-[color:var(--color-accent-char)] font-bold mt-1">
                                ¥{r.price.toLocaleString()}
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  setExtraQty((prev) => ({
                                    ...prev,
                                    [r.id]: Math.min(20, (prev[r.id] ?? 0) + 1),
                                  }))
                                }
                                className="mt-2 w-full py-1 rounded-md bg-[color:var(--color-accent-soy)] text-white text-xs font-bold hover:opacity-90"
                              >
                                {q > 0 ? `+1 (${q})` : "追加"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            </div>

            <div className="border-t border-[color:var(--color-border)] p-4 flex gap-3 bg-[color:var(--color-bg-card)]">
              <button
                onClick={() => {
                  setSelectedMenu(null);
                  setExtraQty({});
                }}
                className="flex-1 py-3 rounded-xl border border-[color:var(--color-border)] text-[color:var(--color-text-primary)] font-medium hover:opacity-80 transition-opacity"
              >
                閉じる
              </button>
              <button
                onClick={() => {
                  if (!selectedMenu) return;
                  const lines: { item: Omit<CartItem, "quantity">; qty: number }[] = [
                    {
                      item: {
                        menuId: selectedMenu.id,
                        name: selectedMenu.name,
                        price: selectedMenu.price,
                      },
                      qty: selectedQuantity,
                    },
                  ];
                  for (const l of extraLines) {
                    lines.push({
                      item: { menuId: l.menu.id, name: l.menu.name, price: l.menu.price },
                      qty: l.quantity,
                    });
                  }
                  for (const l of lines) addItem(l.item, l.qty);
                  setSelectedMenu(null);
                  setExtraQty({});
                }}
                className="flex-[2] py-3 rounded-xl bg-[color:var(--color-accent-char)] text-white font-bold hover:opacity-90 transition-opacity"
              >
                カートに追加 ¥{modalTotal.toLocaleString()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* テーブル番号変更モーダル */}
      {showTableChange && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowTableChange(false)}
        >
          <div
            className="w-full max-w-sm bg-[color:var(--color-bg-card)] rounded-2xl border border-[color:var(--color-border)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-[color:var(--color-text-primary)] mb-4">
              テーブル番号を変更
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const num = parseInt(newTableInput, 10);
                if (isNaN(num) || num <= 0) {
                  setTableChangeError("正しいテーブル番号を入力してください");
                  return;
                }
                if (num === tableNumber) {
                  setShowTableChange(false);
                  return;
                }
                if (totalItems > 0) {
                  const ok = window.confirm(
                    `現在のカート (${totalItems}点) は破棄されます。よろしいですか？`
                  );
                  if (!ok) return;
                }
                clearCart();
                setTableNumber(num);
                setShowTableChange(false);
              }}
              className="space-y-4"
            >
              <input
                type="number"
                min="1"
                required
                autoFocus
                value={newTableInput}
                onChange={(e) => {
                  setNewTableInput(e.target.value);
                  setTableChangeError("");
                }}
                placeholder="新しいテーブル番号"
                className="w-full bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)] rounded-xl px-4 py-3 text-center text-2xl text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-soy)]"
              />
              {tableChangeError && (
                <p className="text-sm text-[color:var(--color-accent-warn)] text-center">
                  {tableChangeError}
                </p>
              )}
              {totalItems > 0 && (
                <p className="text-xs text-[color:var(--color-accent-warn)] text-center">
                  現在のカート ({totalItems}点) は破棄されます
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowTableChange(false)}
                  className="flex-1 py-3 rounded-xl border border-[color:var(--color-border)] text-[color:var(--color-text-primary)] font-medium hover:opacity-80 transition-opacity"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-[color:var(--color-accent-char)] text-white font-bold hover:opacity-90 transition-opacity"
                >
                  変更する
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
