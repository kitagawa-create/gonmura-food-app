"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { CartItem } from "@/types";

const TABLE_KEY = "gonmura-table";

function cartKey(table: number | null): string {
  return table ? `gonmura-cart-${table}` : "gonmura-cart";
}

type CartContextType = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeItem: (menuId: string) => void;
  updateQuantity: (menuId: string, quantity: number) => void;
  clearCart: () => void;
  totalAmount: number;
  totalItems: number;
  tableNumber: number | null;
  setTableNumber: (n: number | null) => void;
};

const CartContext = createContext<CartContextType | null>(null);

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  // 初回レンダリング時に localStorage から同期的に復元 (SSRでは fallback を返す)
  const [tableNumber, setTableNumberState] = useState<number | null>(() =>
    loadFromStorage<number | null>(TABLE_KEY, null)
  );
  const [items, setItems] = useState<CartItem[]>(() => {
    const t = loadFromStorage<number | null>(TABLE_KEY, null);
    return loadFromStorage<CartItem[]>(cartKey(t), []);
  });
  const currentTableRef = useRef<number | null>(tableNumber);

  // テーブル番号を設定（カートも切り替え）
  const setTableNumber = useCallback((n: number | null) => {
    setTableNumberState(n);
    if (typeof window !== "undefined") {
      localStorage.setItem(TABLE_KEY, JSON.stringify(n));
      // 新しいテーブルのカートを読み込む
      const savedCart = loadFromStorage<CartItem[]>(cartKey(n), []);
      setItems(savedCart);
      currentTableRef.current = n;
    }
  }, []);

  // items が変わるたびに現在のテーブルのカートとして保存 (外部システム同期なので useEffect でOK)
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(cartKey(currentTableRef.current), JSON.stringify(items));
  }, [items]);

  const addItem = useCallback((item: Omit<CartItem, "quantity">, quantity: number = 1) => {
    const qty = Math.max(1, Math.trunc(quantity));
    setItems((prev) => {
      const existing = prev.find((i) => i.menuId === item.menuId);
      if (existing) {
        return prev.map((i) =>
          i.menuId === item.menuId ? { ...i, quantity: i.quantity + qty } : i
        );
      }
      return [...prev, { ...item, quantity: qty }];
    });
  }, []);

  const removeItem = useCallback((menuId: string) => {
    setItems((prev) => prev.filter((i) => i.menuId !== menuId));
  }, []);

  const updateQuantity = useCallback((menuId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => i.menuId !== menuId));
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.menuId === menuId ? { ...i, quantity } : i))
    );
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const totalAmount = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalAmount,
        totalItems,
        tableNumber,
        setTableNumber,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
