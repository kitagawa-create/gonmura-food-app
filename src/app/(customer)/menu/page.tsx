"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, getDocs, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Menu, Category } from "@/types";
import { useCart } from "@/lib/cart-context";
import { FadeImage } from "@/components/ui/FadeImage";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import Link from "next/link";

export default function MenuPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [showTableChange, setShowTableChange] = useState(false);
  const [newTableInput, setNewTableInput] = useState("");
  const [tableChangeError, setTableChangeError] = useState("");
  const [hasUnpaidOrders, setHasUnpaidOrders] = useState(false);
  const { addItem, totalItems, totalAmount, tableNumber, setTableNumber, clearCart } = useCart();
  const router = useRouter();

  useEffect(() => {
    if (tableNumber === null) {
      const timer = setTimeout(() => {
        const saved = localStorage.getItem("gonmura-table");
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

  useEffect(() => {
    async function fetchData() {
      const [menusSnap, categoriesSnap] = await Promise.all([
        getDocs(query(collection(db, "menus"), where("isAvailable", "==", true))),
        getDocs(query(collection(db, "categories"), orderBy("sortOrder", "asc"))),
      ]);
      setMenus(menusSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Menu));
      const catsData = categoriesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Category);
      setCategories(catsData);
      if (catsData.length > 0) setActiveCategory(catsData[0].id);
      setLoading(false);
    }
    fetchData();
  }, []);

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

  if (loading || tableNumber === null) {
    return <FullScreenLoader />;
  }

  return (
    <div className="min-h-screen bg-neutral-950 pb-28">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white tracking-wide">Gonmura Food</h1>
            <div className="flex items-center gap-2">
              <p className="text-xs text-neutral-500">テーブル {tableNumber}</p>
              {!hasUnpaidOrders && (
                <button
                  type="button"
                  onClick={() => {
                    setNewTableInput("");
                    setTableChangeError("");
                    setShowTableChange(true);
                  }}
                  className="text-[10px] text-neutral-400 underline hover:text-white transition-colors"
                >
                  変更
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/order/history"
              className="text-xs text-neutral-400 hover:text-white transition-colors"
            >
              注文履歴
            </Link>
            <Link
              href="/bill"
              className="text-xs bg-neutral-800 text-neutral-300 px-3 py-1.5 rounded-full hover:bg-neutral-700 transition-colors"
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
                  ? "text-orange-400 border-b-2 border-orange-400"
                  : "text-neutral-500 border-b-2 border-transparent hover:text-neutral-300"
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      </header>

      {/* メニュー一覧 */}
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-6">
        {filteredMenus.length === 0 ? (
          <p className="text-neutral-500 text-center py-12">
            このカテゴリにはメニューがありません
          </p>
        ) : isRecommend ? (
          /* おすすめ: 大きいカード表示 (画面幅に応じて列数変化) */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-5">
            {filteredMenus.map((menu) => (
              <button
                key={menu.id}
                onClick={() => {
                  setSelectedMenu(menu);
                  setSelectedQuantity(1);
                }}
                className="w-full text-left rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 hover:border-neutral-600 transition-colors"
              >
                {menu.imageUrl && (
                  <FadeImage
                    src={menu.imageUrl}
                    alt={menu.name}
                    className="w-full h-40 sm:h-48 md:h-44 lg:h-48"
                  />
                )}
                <div className="p-4">
                  <h3 className="text-base lg:text-lg font-bold text-white">{menu.name}</h3>
                  <p className="text-sm text-neutral-400 mt-1 line-clamp-2">{menu.description}</p>
                  <p className="text-lg lg:text-xl font-bold text-orange-400 mt-2">
                    {menu.price.toLocaleString()}円
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          /* 通常: グリッド表示 (iPadで4-5列、スマホで2列) */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 lg:gap-4">
            {filteredMenus.map((menu) => (
              <button
                key={menu.id}
                onClick={() => {
                  setSelectedMenu(menu);
                  setSelectedQuantity(1);
                }}
                className="text-left rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 hover:border-neutral-600 transition-colors"
              >
                {menu.imageUrl && (
                  <FadeImage
                    src={menu.imageUrl}
                    alt={menu.name}
                    className="w-full h-28 sm:h-32 md:h-36 lg:h-40"
                  />
                )}
                <div className="p-3 lg:p-4">
                  <h3 className="text-sm lg:text-base font-semibold text-white leading-tight line-clamp-2">
                    {menu.name}
                  </h3>
                  <p className="text-sm lg:text-base font-bold text-orange-400 mt-1">
                    {menu.price.toLocaleString()}円
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* フローティングカートボタン */}
      <Link
        href="/order"
        className="fixed bottom-6 right-6 z-20 bg-orange-500 text-white rounded-full shadow-lg shadow-orange-500/30 px-5 py-3 flex items-center gap-2 hover:bg-orange-600 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
        </svg>
        <span className="font-bold">{totalItems}点</span>
        <span className="text-orange-200">¥{totalAmount.toLocaleString()}</span>
      </Link>

      {/* 商品詳細モーダル */}
      {selectedMenu && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 p-0 md:p-6"
          onClick={() => setSelectedMenu(null)}
        >
          <div
            className="w-full max-w-lg md:max-w-xl lg:max-w-2xl bg-neutral-900 rounded-t-2xl md:rounded-2xl overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedMenu.imageUrl && (
              <FadeImage
                src={selectedMenu.imageUrl}
                alt={selectedMenu.name}
                className="w-full h-56 md:h-64 lg:h-72"
              />
            )}
            <div className="p-5">
              <h2 className="text-xl font-bold text-white">{selectedMenu.name}</h2>
              <p className="text-sm text-neutral-400 mt-2">{selectedMenu.description}</p>
              <p className="text-2xl font-bold text-orange-400 mt-3">
                {selectedMenu.price.toLocaleString()}円
              </p>

              {/* 数量ステッパー */}
              <div className="mt-5 flex items-center justify-between rounded-xl bg-neutral-800 p-3">
                <span className="text-sm text-neutral-300">数量</span>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setSelectedQuantity((q) => Math.max(1, q - 1))}
                    disabled={selectedQuantity <= 1}
                    aria-label="数量を減らす"
                    className="w-10 h-10 rounded-full bg-neutral-700 text-white text-xl font-bold hover:bg-neutral-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-xl font-bold text-white tabular-nums">
                    {selectedQuantity}
                  </span>
                  <button
                    onClick={() => setSelectedQuantity((q) => Math.min(99, q + 1))}
                    disabled={selectedQuantity >= 99}
                    aria-label="数量を増やす"
                    className="w-10 h-10 rounded-full bg-orange-500 text-white text-xl font-bold hover:bg-orange-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setSelectedMenu(null)}
                  className="flex-1 py-3 rounded-xl border border-neutral-700 text-neutral-300 font-medium hover:bg-neutral-800 transition-colors"
                >
                  閉じる
                </button>
                <button
                  onClick={() => {
                    addItem(
                      {
                        menuId: selectedMenu.id,
                        name: selectedMenu.name,
                        price: selectedMenu.price,
                      },
                      selectedQuantity
                    );
                    setSelectedMenu(null);
                  }}
                  className="flex-1 py-3 rounded-xl bg-orange-500 text-white font-bold hover:bg-orange-600 transition-colors"
                >
                  カートに追加 ¥{(selectedMenu.price * selectedQuantity).toLocaleString()}
                </button>
              </div>
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
            className="w-full max-w-sm bg-neutral-900 rounded-2xl border border-neutral-800 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white mb-4">テーブル番号を変更</h2>
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
                className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-center text-2xl text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              {tableChangeError && (
                <p className="text-sm text-red-400 text-center">{tableChangeError}</p>
              )}
              {totalItems > 0 && (
                <p className="text-xs text-yellow-400 text-center">
                  現在のカート ({totalItems}点) は破棄されます
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowTableChange(false)}
                  className="flex-1 py-3 rounded-xl border border-neutral-700 text-neutral-300 font-medium hover:bg-neutral-800 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-orange-500 text-white font-bold hover:bg-orange-600 transition-colors"
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
