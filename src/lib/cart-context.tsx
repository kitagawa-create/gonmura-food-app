"use client";

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { CartItem, CartItemTopping } from "@/types";
import { comboLineHash, newLineId } from "@/lib/order-utils";

const TABLE_KEY = "gonmura-table";
const GUEST_COUNT_KEY = "gonmura-guest-count";
const CUSTOMER_ID_KEY = "gonmura-customer-id";

function cartKey(table: number | null): string {
  return table ? `gonmura-cart-${table}` : "gonmura-cart";
}

/** addItem に渡す入力。lineId / quantity はここで決定するため不要。 */
type CartItemInput = {
  menuId: string;
  name: string;
  price: number;
  toppings?: CartItemTopping[];
  note?: string;
};

type CartContextType = {
  items: CartItem[];
  addItem: (item: CartItemInput, quantity?: number) => void;
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  updateItemNote: (lineId: string, note: string) => void;
  clearCart: () => void;
  resetSession: () => void;
  totalAmount: number;
  totalItems: number;
  tableNumber: number | null;
  setTableNumber: (n: number | null) => void;
  guestCount: number | null;
  setGuestCount: (n: number) => void;
  customerId: string | null;
  setCustomerId: (id: string | null) => void;
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
      toppings: Array.isArray(x.toppings) ? x.toppings : [],
      note: typeof x.note === "string" ? x.note : "",
    }))
    .filter((x) => x.menuId);
}

// 旧バージョンが String(n) で保存するケースがあるため、JSON 失敗時は数値として再解釈
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
  const [guestCount, setGuestCountState] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(GUEST_COUNT_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [customerId, setCustomerIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(CUSTOMER_ID_KEY) ?? null;
  });
  const [items, setItems] = useState<CartItem[]>(() => {
    const t = loadTableNumber();
    return rehydrateItems(loadFromStorage<unknown>(cartKey(t), []));
  });
  const currentTableRef = useRef<number | null>(tableNumber);

  // テーブル番号を設定（カートも切り替え、客数・顧客IDもリセット）
  const setTableNumber = useCallback((n: number | null) => {
    setTableNumberState(n);
    setGuestCountState(null);
    setCustomerIdState(null);
    if (typeof window !== "undefined") {
      localStorage.setItem(TABLE_KEY, JSON.stringify(n));
      localStorage.removeItem(GUEST_COUNT_KEY);
      localStorage.removeItem(CUSTOMER_ID_KEY);
      const savedCart = rehydrateItems(loadFromStorage<unknown>(cartKey(n), []));
      setItems(savedCart);
      currentTableRef.current = n;
    }
  }, []);

  const setGuestCount = useCallback((n: number) => {
    const count = Math.max(1, Math.trunc(n));
    setGuestCountState(count);
    if (typeof window !== "undefined") {
      localStorage.setItem(GUEST_COUNT_KEY, String(count));
    }
  }, []);

  const setCustomerId = useCallback((id: string | null) => {
    setCustomerIdState(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem(CUSTOMER_ID_KEY, id);
      else localStorage.removeItem(CUSTOMER_ID_KEY);
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
          toppings: input.toppings ?? [],
          note: input.note ?? "",
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

  const updateItemNote = useCallback((lineId: string, note: string) => {
    setItems((prev) =>
      prev.map((i) => (i.lineId === lineId ? { ...i, note } : i))
    );
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  // 精算完了後の新セッション開始用: guestCount・customerId をリセットしてカートもクリア
  const resetSession = useCallback(() => {
    setGuestCountState(null);
    setCustomerIdState(null);
    setItems([]);
    if (typeof window !== "undefined") {
      localStorage.removeItem(GUEST_COUNT_KEY);
      localStorage.removeItem(CUSTOMER_ID_KEY);
    }
  }, []);

  // コンボ価格 = (ラーメン単価 + Σトッピング単価×個数) × 杯数
  const totalAmount = useMemo(() => items.reduce((sum, i) => {
    const topPerBowl = i.toppings.reduce((s, t) => s + t.price * t.quantity, 0);
    return sum + (i.price + topPerBowl) * i.quantity;
  }, 0), [items]);
  // 総点数 = 各コンボの (杯数 + Σトッピング個数×杯数)。トッピングも個数分カウント。
  const totalItems = useMemo(() => items.reduce((sum, i) => {
    const topPerBowl = i.toppings.reduce((a, t) => a + t.quantity, 0);
    return sum + i.quantity + topPerBowl * i.quantity;
  }, 0), [items]);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        updateItemNote,
        clearCart,
        resetSession,
        totalAmount,
        totalItems,
        tableNumber,
        setTableNumber,
        guestCount,
        setGuestCount,
        customerId,
        setCustomerId,
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
