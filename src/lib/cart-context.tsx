"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { CartItem, CartItemTopping } from "@/types";
import { comboLineHash, newLineId } from "@/lib/order-utils";

// 注意: Window C の /admin/tables、CLAUDE.md 既存規約と揃えて "gonmura-table" を共有。
// 共通仕様で "gonmura-table-number" と書かれていたが、実態の既存キーに合わせる。
const TABLE_KEY = "gonmura-table";

function cartKey(table: number | null): string {
  return table ? `gonmura-cart-${table}` : "gonmura-cart";
}

/** addItem に渡す入力。lineId / quantity はここで決定するため不要。 */
type CartItemInput = {
  menuId: string;
  name: string;
  price: number;
  toppings?: CartItemTopping[];
};

type CartContextType = {
  items: CartItem[];
  addItem: (item: CartItemInput, quantity?: number) => void;
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
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

// 旧バージョン (lineId なし) のカートを復元する際に lineId を採番して移行する。
function rehydrateItems(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Partial<CartItem> => !!x && typeof x === "object")
    .map((x) => ({
      lineId: typeof x.lineId === "string" && x.lineId ? x.lineId : newLineId(),
      menuId: String(x.menuId ?? ""),
      name: String(x.name ?? ""),
      price: Number(x.price ?? 0),
      quantity: Math.max(1, Math.trunc(Number(x.quantity ?? 1))),
      toppings: Array.isArray(x.toppings) ? x.toppings : undefined,
    }))
    .filter((x) => x.menuId);
}

// admin/tables 側が String(n) で保存するケースもあるため、JSON 失敗時は数値として再解釈
function loadTableNumber(): number | null {
  if (typeof window === "undefined") return null;
  const raw = (() => {
    try {
      return localStorage.getItem(TABLE_KEY);
    } catch {
      return null;
    }
  })();
  if (raw === null || raw === "" || raw === "null") return null;
  // JSON 経由 (cart-context 旧書き込み)
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "number" && Number.isFinite(parsed)) return parsed;
    if (parsed === null) return null;
  } catch {
    // JSON でない: admin/tables の生 String(n) 書き込み形式
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  // 初回レンダリング時に localStorage から同期的に復元 (SSRでは fallback を返す)
  const [tableNumber, setTableNumberState] = useState<number | null>(() => loadTableNumber());
  const [items, setItems] = useState<CartItem[]>(() => {
    const t = loadTableNumber();
    return rehydrateItems(loadFromStorage<unknown>(cartKey(t), []));
  });
  const currentTableRef = useRef<number | null>(tableNumber);

  // テーブル番号を設定（カートも切り替え）
  const setTableNumber = useCallback((n: number | null) => {
    setTableNumberState(n);
    if (typeof window !== "undefined") {
      localStorage.setItem(TABLE_KEY, JSON.stringify(n));
      // 新しいテーブルのカートを読み込む
      const savedCart = rehydrateItems(loadFromStorage<unknown>(cartKey(n), []));
      setItems(savedCart);
      currentTableRef.current = n;
    }
  }, []);

  // items が変わるたびに現在のテーブルのカートとして保存 (外部システム同期なので useEffect でOK)
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(cartKey(currentTableRef.current), JSON.stringify(items));
  }, [items]);

  const addItem = useCallback((input: CartItemInput, quantity: number = 1) => {
    const qty = Math.max(1, Math.trunc(quantity));
    const hash = comboLineHash(input.menuId, input.toppings);
    setItems((prev) => {
      const existing = prev.find(
        (i) => comboLineHash(i.menuId, i.toppings) === hash
      );
      if (existing) {
        return prev.map((i) =>
          i.lineId === existing.lineId ? { ...i, quantity: i.quantity + qty } : i
        );
      }
      return [
        ...prev,
        {
          lineId: newLineId(),
          menuId: input.menuId,
          name: input.name,
          price: input.price,
          quantity: qty,
          toppings: input.toppings && input.toppings.length > 0 ? input.toppings : undefined,
        },
      ];
    });
  }, []);

  const removeItem = useCallback((lineId: string) => {
    setItems((prev) => prev.filter((i) => i.lineId !== lineId));
  }, []);

  const updateQuantity = useCallback((lineId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => i.lineId !== lineId));
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.lineId === lineId ? { ...i, quantity } : i))
    );
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  // コンボ価格 = (ラーメン単価 + Σトッピング単価×個数) × 杯数
  const totalAmount = items.reduce((sum, i) => {
    const topPerBowl = (i.toppings ?? []).reduce((s, t) => s + t.price * t.quantity, 0);
    return sum + (i.price + topPerBowl) * i.quantity;
  }, 0);
  // 総点数 = 各コンボの (杯数 + Σトッピング個数×杯数)。トッピングも個数分カウント。
  const totalItems = items.reduce((sum, i) => {
    const topPerBowl = (i.toppings ?? []).reduce((a, t) => a + t.quantity, 0);
    return sum + i.quantity + topPerBowl * i.quantity;
  }, 0);

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
