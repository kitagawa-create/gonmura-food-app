import { Timestamp } from "firebase/firestore";

/**
 * 数値フィールドはすべて整数（int）として扱う。
 * 小数は保存しない。書き込み前に Math.trunc / parseInt で正規化すること。
 */

export type Category = {
  categoryId: string;
  name: string;
  /** 整数 */
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/**
 * - active:   公開中・注文可
 * - soldout:  売り切れ表示（顧客側でオーバーレイ）・注文不可
 * - hidden:   非公開（顧客・管理両画面で非表示）
 * - deleted:  ソフトデリート済み（両画面で非表示、ドキュメント保持）
 */
export type MenuStatus = "active" | "soldout" | "hidden" | "deleted";

export type Menu = {
  menuId: string;
  name: string;
  description: string;
  /** 税込価格。整数（円） */
  price: number;
  categoryIds: string[];
  imageUrl: string;
  status: MenuStatus;
  /** 表示順（整数、小さいほど上）。Firestore に未設定のドキュメントは Number.MAX_SAFE_INTEGER に正規化 */
  sortOrder: number;
  /** おすすめカテゴリ内での表示順。sortOrder とは独立して管理 */
  sortOrderFeatured: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/** コンボ (ラーメン等) に付随するトッピング。price は注文時スナップショット。 */
export type OrderItemTopping = {
  menuId: string;
  name: string;
  price: number;
  /** 「1コンボあたり」の個数。コンボ数量 N 杯なら実数 = N * quantity */
  quantity: number;
};

export type OrderItem = {
  itemId: string;
  menuId: string;
  name: string;
  /** 注文時点のスナップショット。整数（円）。単品価格 (トッピング分は含まない) */
  price: number;
  /** 整数。コンボなら「杯数」 */
  quantity: number;
  /** ラーメンコンボのみ。このコンボに付くトッピング一覧 (quantity は1杯あたり)。ラーメン以外は空配列 */
  toppings: OrderItemTopping[];
  /** 注文時スナップショット。備考なしは空文字 */
  note: string;
  /** チェック状態 */
  checked: boolean;
};

export type OrderStatus = "pending" | "completed" | "paid";

export type AdminRole = "owner" | "staff";

export type Order = {
  orderId: string;
  status: OrderStatus;
  /** Firestoreに保存済み（`customers/{customerId}/orders/{orderId}` の customerId フィールド） */
  customerId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/** orders/{orderId}/items サブコレクションを結合したランタイム型 */
export type OrderWithItems = Order & { items: OrderItem[] };

export type CartItemTopping = {
  menuId: string;
  name: string;
  /** 整数（円） */
  price: number;
  /** 1コンボあたりの個数 */
  quantity: number;
};

export type Table = {
  tableId: string;
  tableNumber: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CartItem = {
  /** コンボ識別子 (同一 menuId でも異なる構成のコンボは別 lineId)  */
  lineId: string;
  menuId: string;
  /** 整数（円）。単品価格 (トッピング分は含まない) */
  price: number;
  /** 整数。コンボなら「杯数」 */
  quantity: number;
  name: string;
  /** ラーメンコンボのみ。ラーメン以外は空配列 */
  toppings: CartItemTopping[];
  /** 商品ごとの備考（アレルギー等）。備考なしは空文字 */
  note: string;
};
