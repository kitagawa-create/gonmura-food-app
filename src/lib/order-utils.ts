import type { CartItem, Menu, Order, OrderItem, OrderItemTopping } from "@/types";

// 以下 OrderItem / CartItem 双方で使える汎用ヘルパー。
// - price フィールドは単品価格 (トッピング除く) として扱う。
// - toppings.quantity は 1 コンボあたり。実消費 = コンボ quantity × topping.quantity。

type ItemLike = {
  price: number;
  quantity: number;
  toppings: { price: number; quantity: number }[];
};

/** コンボ 1 杯あたり (ラーメン単価 + 全トッピング単価×個数) の合計。 */
export function comboUnitPrice(item: ItemLike): number {
  return item.price + item.toppings.reduce((s, x) => s + x.price * x.quantity, 0);
}

/** コンボ全体の小計 (杯数 × 1杯あたり単価)。 */
export function comboLineTotal(item: ItemLike): number {
  return comboUnitPrice(item) * item.quantity;
}

/** 注文全体の税込合計。 */
export function orderGrandTotal(items: ItemLike[]): number {
  return items.reduce((s, i) => s + comboLineTotal(i), 0);
}

/** 注文全体の品数 (コンボは杯数。トッピングも個数分カウント)。 */
export function orderTotalQuantity(items: ItemLike[]): number {
  return items.reduce((s, i) => {
    const topQty = i.toppings.reduce((a, t) => a + t.quantity * i.quantity, 0);
    return s + i.quantity + topQty;
  }, 0);
}

/** レシート/売上集計用: コンボを分解してフラットな {menuId,name,price,quantity} に展開。 */
export function flattenForReceipt(
  items: (CartItem | OrderItem)[]
): { menuId: string; name: string; price: number; quantity: number }[] {
  const out: { menuId: string; name: string; price: number; quantity: number }[] = [];
  for (const it of items) {
    out.push({ menuId: it.menuId, name: it.name, price: it.price, quantity: it.quantity });
    for (const t of it.toppings) {
      out.push({
        menuId: t.menuId,
        name: t.name,
        price: t.price,
        quantity: t.quantity * it.quantity,
      });
    }
  }
  return out;
}

/** コンボ識別ハッシュ: menuId + ソート済 toppings で決定論的に。merge 判定に使う。 */
export function comboLineHash(
  menuId: string,
  toppings: { menuId: string; quantity: number }[] = []
): string {
  const t = toppings
    .slice()
    .sort((a, b) => a.menuId.localeCompare(b.menuId))
    .map((x) => `${x.menuId}:${x.quantity}`)
    .join("|");
  return `${menuId}#${t}`;
}

/** Firestore から取得した生データを Menu 型に正規化。フィールド欠損のある既存ドキュメントを安全に扱う。 */
export function normalizeMenu(id: string, data: Record<string, unknown>): Menu {
  return {
    ...(data as Omit<Menu, "id" | "isSoldOut" | "sortOrder">),
    id,
    isSoldOut: data.isSoldOut === true,
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : Number.MAX_SAFE_INTEGER,
  };
}

/** Firestore から取得した生データを OrderItem 型に正規化。フィールド欠損のある既存ドキュメントを安全に扱う。 */
export function normalizeOrderItem(id: string, data: Record<string, unknown>): OrderItem {
  return {
    ...(data as Omit<OrderItem, "id" | "toppings" | "note" | "checked">),
    id,
    toppings: Array.isArray(data.toppings) ? (data.toppings as OrderItemTopping[]) : [],
    note: typeof data.note === "string" ? data.note : "",
    checked: data.checked === true,
  };
}

/** Firestore から取得した生データを Order 型に正規化。items はサブコレクションから別途フェッチして付与する。 */
export function normalizeOrder(id: string, data: Record<string, unknown>): Order {
  return {
    ...(data as Omit<Order, "id" | "items">),
    id,
    items: [],
  };
}

/** 新規 lineId を採番。crypto.randomUUID が使える環境なら優先、fallback は時間+乱数。 */
export function newLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
