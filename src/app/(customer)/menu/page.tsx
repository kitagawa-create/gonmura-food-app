"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Menu, Category } from "@/types";
import { useCart } from "@/lib/cart-context";
import Link from "next/link";

export default function MenuPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { addItem, totalItems, tableNumber } = useCart();
  const router = useRouter();

  // テーブル未設定なら設定画面へ
  useEffect(() => {
    if (tableNumber === null) {
      // localStorageの復元を待つため少し遅延
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
    async function fetchData() {
      const [menusSnap, categoriesSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "menus"),
            where("isAvailable", "==", true)
          )
        ),
        getDocs(
          query(collection(db, "categories"), orderBy("sortOrder", "asc"))
        ),
      ]);

      const menusData = menusSnap.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as Menu
      );
      const categoriesData = categoriesSnap.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as Category
      );

      setMenus(menusData);
      setCategories(categoriesData);
      if (categoriesData.length > 0) {
        setActiveCategory(categoriesData[0].id);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  const filteredMenus = activeCategory
    ? menus.filter((menu) => menu.categoryIds.includes(activeCategory))
    : [];

  if (loading || tableNumber === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="sticky top-0 z-10 bg-white shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Gonmura Food</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">テーブル {tableNumber}</span>
            <Link
              href="/order/history"
              className="text-sm text-orange-500 font-medium hover:underline"
            >
              注文履歴
            </Link>
          </div>
        </div>
        <div className="border-t border-gray-100">
          <div className="max-w-lg mx-auto px-2 flex overflow-x-auto no-scrollbar">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeCategory === category.id
                    ? "border-orange-500 text-orange-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        {filteredMenus.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            このカテゴリにはメニューがありません
          </p>
        ) : (
          <div className="space-y-3">
            {filteredMenus.map((menu) => (
              <div
                key={menu.id}
                className="bg-white rounded-lg shadow-sm p-4 flex gap-4"
              >
                {menu.imageUrl && (
                  <img
                    src={menu.imageUrl}
                    alt={menu.name}
                    className="w-20 h-20 object-cover rounded-lg"
                  />
                )}
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{menu.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {menu.description}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-bold text-orange-600">
                      {menu.price.toLocaleString()}円
                    </span>
                    <button
                      onClick={() =>
                        addItem({
                          menuId: menu.id,
                          name: menu.name,
                          price: menu.price,
                        })
                      }
                      className="bg-orange-500 text-white px-4 py-1.5 rounded-full text-sm font-medium hover:bg-orange-600 transition-colors"
                    >
                      追加
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg">
        <div className="max-w-lg mx-auto px-4 py-3 flex gap-2">
          <Link
            href="/bill"
            className="flex-1 bg-gray-800 text-white text-center py-3 rounded-lg font-medium hover:bg-gray-900 transition-colors"
          >
            お会計
          </Link>
          {totalItems > 0 && (
            <Link
              href="/cart"
              className="flex-1 bg-orange-500 text-white text-center py-3 rounded-lg font-medium hover:bg-orange-600 transition-colors"
            >
              カートを見る ({totalItems}点)
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
