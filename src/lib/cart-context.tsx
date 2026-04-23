"use client";

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { CartItem } from "@/types";
import { newLineId } from "@/lib/order-utils";

const TABLE_KEY = "gonmura-table";
const GUEST_COUNT_KEY = "gonmura-guest-count";
const CUSTOMER_ID_KEY = "gonmura-customer-id";

function cartKey(table: string | null): string {
  return table ? `gonmura-cart-${table}` : "gonmura-cart";
}

type CartItemInput = {
  menuId: string;
  name: string;
  price: number;
  note?: string;
};

export type SideInput = {
  menuId: string;
  name: string;
  price: number;
  quantity: number;
};

type CartContextType = {
  items: CartItem[];
  /** 単品追加（サイドなし）。同一 menuId+note なら数量マージ。 */
  addItem: (item: CartItemInput, quantity?: number) => void;
  /** メイン＋サイドをセットで追加。親子関係で紐づける。 */
  addSet: (main: CartItemInput, sides: SideInput[], note?: string) => void;
  /** lineId のアイテムを削除。メインの場合は同一親のサイドも一括削除。 */
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  updateItemNote: (lineId: string, note: string) => void;
  /** 単品の数量・備考を更新。 */
  updateItem: (lineId: string, updates: Partial<Pick<CartItem, "quantity" | "note">>) => void;
  /** セットのサイド構成・備考を更新。mainLineId はメインアイテムの lineId。 */
  updateSet: (mainLineId: string, updates: { sides?: SideInput[]; note?: string }) => void;
  clearCart: () => void;
  resetSession: () => void;
  totalAmount: number;
  totalItems: number;
  tableNumber: string | null;
  setTableNumber: (n: string | null) => void;
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

/** localStorage のカートを CartItem[] に復元。 */
function rehydrateItems(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];

  const result: CartItem[] = [];

  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const item = x as Record<string, unknown>;
    const menuId = String(item.menuId ?? "");
    if (!menuId) continue;
    const lineId = typeof item.lineId === "string" && item.lineId ? item.lineId : newLineId();
    const rawSetId = typeof item.setId === "string" ? item.setId : "";

    result.push({
      lineId,
      setId: rawSetId ? rawSetId : lineId,
      menuId,
      name: String(item.name ?? ""),
      price: Number(item.price ?? 0),
      quantity: Math.max(1, Math.trunc(Number(item.quantity ?? 1))),
      note: typeof item.note === "string" ? item.note : "",
    });
  }

  return result;
}

function loadTableString(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TABLE_KEY);
    if (!raw || raw === "null") return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [tableNumber, setTableNumberState] = useState<string | null>(() => loadTableString());
  const [guestCount, setGuestCountState] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = sessionStorage.getItem(GUEST_COUNT_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [customerId, setCustomerIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(CUSTOMER_ID_KEY) ?? null;
  });
  const [items, setItems] = useState<CartItem[]>(() => {
    const t = loadTableString();
    return rehydrateItems(loadFromStorage<unknown>(cartKey(t), []));
  });
  const currentTableRef = useRef<string | null>(tableNumber);

  const setTableNumber = useCallback((n: string | null) => {
    setTableNumberState(n);
    setGuestCountState(null);
    setCustomerIdState(null);
    if (typeof window !== "undefined") {
      localStorage.setItem(TABLE_KEY, JSON.stringify(n));
      sessionStorage.removeItem(GUEST_COUNT_KEY);
      localStorage.removeItem(CUSTOMER_ID_KEY);
      const savedCart = rehydrateItems(loadFromStorage<unknown>(cartKey(n), []));
      setItems(savedCart);
      currentTableRef.current = n;
    }
  }, []);

  const setGuestCount = useCallback((n: number) => {
    const count = Math.max(1, Math.trunc(n));
    setGuestCountState(count);
    if (typeof window !== "undefined") sessionStorage.setItem(GUEST_COUNT_KEY, String(count));
  }, []);

  const setCustomerId = useCallback((id: string | null) => {
    setCustomerIdState(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem(CUSTOMER_ID_KEY, id);
      else localStorage.removeItem(CUSTOMER_ID_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(cartKey(currentTableRef.current), JSON.stringify(items));
  }, [items]);

  /** 単品追加。同一 menuId+note の単品があれば数量マージ。 */
  const addItem = useCallback((input: CartItemInput, quantity: number = 1) => {
    const qty = Math.max(1, Math.trunc(quantity));
    const note = input.note ?? "";
    setItems((prev) => {
      const existing = prev.find((i) => i.setId === i.lineId && i.menuId === input.menuId && i.note === note);
      if (existing) {
        return prev.map((i) =>
          i.lineId === existing.lineId ? { ...i, quantity: i.quantity + qty } : i
        );
      }
      const lineId = newLineId();
      return [
        ...prev,
        { lineId, setId: lineId, menuId: input.menuId, name: input.name, price: input.price, quantity: qty, note },
      ];
    });
  }, []);

  /** メイン＋サイドをセット追加。setId で紐づける。 */
  const addSet = useCallback((main: CartItemInput, sides: SideInput[], note: string = "") => {
    setItems((prev) => {
      const mainLineId = newLineId();
      const mainItem: CartItem = {
        lineId: mainLineId,
        setId: mainLineId,
        menuId: main.menuId,
        name: main.name,
        price: main.price,
        quantity: 1,
        note,
      };
      const sideItems: CartItem[] = sides
        .filter((s) => s.quantity > 0)
        .map((s) => ({
          lineId: newLineId(),
          setId: mainLineId,
          menuId: s.menuId,
          name: s.name,
          price: s.price,
          quantity: s.quantity,
          note: "",
        }));
      return [...prev, mainItem, ...sideItems];
    });
  }, []);

  /** lineId のアイテムを削除。メインなら同一 setId のサイドも一括削除。 */
  const removeItem = useCallback((lineId: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.lineId === lineId);
      if (!item) return prev.filter((i) => i.lineId !== lineId);
      if (item.setId === item.lineId) return prev.filter((i) => i.setId !== item.lineId);
      return prev.filter((i) => i.lineId !== lineId);
    });
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

  /** 単品の更新。 */
  const updateItem = useCallback(
    (lineId: string, updates: Partial<Pick<CartItem, "quantity" | "note">>) => {
      setItems((prev) =>
        prev.map((i) => {
          if (i.lineId !== lineId) return i;
          return {
            ...i,
            ...(updates.quantity !== undefined
              ? { quantity: Math.max(1, Math.trunc(updates.quantity)) }
              : {}),
            ...(updates.note !== undefined ? { note: updates.note } : {}),
          };
        })
      );
    },
    []
  );

  /** セットのサイド構成・備考を更新。既存サイドを入れ替え。 */
  const updateSet = useCallback(
    (mainLineId: string, updates: { sides?: SideInput[]; note?: string }) => {
      setItems((prev) => {
        const main = prev.find((i) => i.lineId === mainLineId);
        if (!main || main.setId !== main.lineId) return prev;
        // メイン以外の同一親を除去
        let next = prev.filter((i) => i.lineId === mainLineId || i.setId !== mainLineId);

        // 備考更新
        if (updates.note !== undefined) {
          next = next.map((i) => (i.lineId === mainLineId ? { ...i, note: updates.note! } : i));
        }

        // サイド再構成
        if (updates.sides !== undefined) {
          const newSides: CartItem[] = updates.sides
            .filter((s) => s.quantity > 0)
            .map((s) => ({
              lineId: newLineId(),
              setId: mainLineId,
              menuId: s.menuId,
              name: s.name,
              price: s.price,
              quantity: s.quantity,
              note: "",
            }));
          const mainIdx = next.findIndex((i) => i.lineId === mainLineId);
          next = [...next.slice(0, mainIdx + 1), ...newSides, ...next.slice(mainIdx + 1)];
        }

        return next;
      });
    },
    []
  );

  const clearCart = useCallback(() => setItems([]), []);

  const resetSession = useCallback(() => {
    setGuestCountState(null);
    setCustomerIdState(null);
    setItems([]);
    if (typeof window !== "undefined") {
      localStorage.removeItem(CUSTOMER_ID_KEY);
      sessionStorage.removeItem(GUEST_COUNT_KEY);
    }
  }, []);

  // 合計金額 = 全アイテムの price × quantity の総和
  const totalAmount = useMemo(
    () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [items]
  );

  // 総点数 = 全アイテムの quantity 総和（メイン・サイド問わず）
  const totalItems = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items]
  );

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        addSet,
        removeItem,
        updateQuantity,
        updateItemNote,
        updateItem,
        updateSet,
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
