import type { Menu, MenuStatus, Order, OrderItem } from "@/types";

type ItemLike = {
  price: number;
  quantity: number;
  sides?: { price: number; quantity: number }[];
};

/** 税抜価格から税込価格を計算（10%）。 */
export function taxIncluded(price: number): number {
  return Math.round(price * 1.1);
}

/** 1 アイテムあたり (単価 + 全サイド単価×個数) の合計。旧データ互換用。 */
export function comboUnitPrice(item: ItemLike): number {
  const extra = item.sides ?? [];
  return item.price + extra.reduce((s, x) => s + x.price * x.quantity, 0);
}

/** アイテム全体の小計 (数量 × 1個あたり単価)。旧データ互換用。 */
export function comboLineTotal(item: ItemLike): number {
  return comboUnitPrice(item) * item.quantity;
}

/** 注文全体の税込合計。 */
export function orderGrandTotal(items: ItemLike[]): number {
  return items.reduce((s, i) => s + comboLineTotal(i), 0);
}

/** レシート/売上集計用: アイテムを分解してフラットな {menuId,name,price,quantity} に展開。 */
export function flattenForReceipt(
  items: { menuId: string; name: string; price: number; quantity: number; setId?: string }[]
): { menuId: string; name: string; price: number; quantity: number }[] {
  const out: { menuId: string; name: string; price: number; quantity: number }[] = [];
  for (const it of items) {
    out.push({ menuId: it.menuId, name: it.name, price: it.price, quantity: it.quantity });
  }
  return out;
}

/** 注文ライン識別ハッシュ。単品カートの重複マージ判定に使う。 */
export function comboLineHash(
  menuId: string,
  sides: { menuId: string; quantity: number }[] = [],
  note: string = ""
): string {
  const t = sides
    .slice()
    .sort((a, b) => a.menuId.localeCompare(b.menuId))
    .map((x) => `${x.menuId}:${x.quantity}`)
    .join("|");
  return `${menuId}#${t}@${note}`;
}

/** Firestore から取得した生データを Menu 型に正規化。 */
export function normalizeMenu(id: string, data: Record<string, unknown>): Menu {
  const VALID_STATUSES: MenuStatus[] = ["active", "soldout", "hidden", "deleted"];
  const status: MenuStatus = (typeof data.status === "string" && (VALID_STATUSES as string[]).includes(data.status))
    ? data.status as MenuStatus
    : "active";
  return {
    menuId: id,
    name: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
    price: typeof data.price === "number" ? Math.trunc(data.price) : 0,
    categoryIds: Array.isArray(data.categoryIds) ? (data.categoryIds as string[]) : [],
    imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
    status,
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : Number.MAX_SAFE_INTEGER,
    sortOrderFeatured: typeof data.sortOrderFeatured === "number" ? data.sortOrderFeatured : Number.MAX_SAFE_INTEGER,
    sortOrderSide: typeof data.sortOrderSide === "number" ? data.sortOrderSide : Number.MAX_SAFE_INTEGER,
    createdAt: data.createdAt as Menu["createdAt"],
    updatedAt: data.updatedAt as Menu["updatedAt"],
  };
}

/** Firestore から取得した生データを OrderItem 型に正規化。旧フォーマットにも後方互換。 */
export function normalizeOrderItem(id: string, data: Record<string, unknown>): OrderItem {
  return {
    itemId: id,
    menuId: typeof data.menuId === "string" ? data.menuId : "",
    name: typeof data.name === "string" ? data.name : "",
    price: typeof data.price === "number" ? Math.trunc(data.price) : 0,
    quantity: typeof data.quantity === "number" ? Math.trunc(data.quantity) : 1,
    setId: typeof data.setId === "string" ? data.setId : "",
    note: typeof data.note === "string" ? data.note : "",
    checked: data.checked === true,
  };
}

/** Firestore から取得した生データを Order 型に正規化。 */
export function normalizeOrder(id: string, data: Record<string, unknown>, customerId: string): Order {
  return {
    orderId: id,
    status: (data.status as Order["status"]) === "completed" ? "completed" : "pending",
    customerId: typeof data.customerId === "string" && data.customerId ? data.customerId : customerId,
    createdAt: data.createdAt as Order["createdAt"],
    updatedAt: data.updatedAt as Order["updatedAt"],
  };
}

/** 新規 lineId を採番。 */
export function newLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
