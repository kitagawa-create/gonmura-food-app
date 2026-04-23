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
  /** おすすめカテゴリ内での表示順。未設定時は末尾扱い */
  sortOrderFeatured: number;
  /** サイドカテゴリ内での表示順。未設定時は末尾扱い */
  sortOrderSide: number;
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
  /** 税抜価格。整数（円） */
  price: number;
  categoryIds: string[];
  imageUrl: string;
  status: MenuStatus;
  /** 表示順（整数、小さいほど上）。Firestore に未設定のドキュメントは Number.MAX_SAFE_INTEGER に正規化 */
  sortOrder: number;
  /** おすすめカテゴリ内での表示順。sortOrder とは独立して管理 */
  sortOrderFeatured: number;
  /** サイドカテゴリ内での表示順。sortOrder とは独立して管理 */
  sortOrderSide: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type OrderItem = {
  itemId: string;
  orderId: string;
  customerId: string;
  menuId: string;
  name: string;
  /** 注文時点のスナップショット。整数（円）。単品価格 */
  price: number;
  /** 整数 */
  quantity: number;
  /**
   * セット識別子。メイン商品は自分の `itemId`、サイドは親メインの `itemId`。
   * 単品なら空文字。
   */
  setId: string;
  /** 注文時スナップショット。備考なしは空文字 */
  note: string;
  /** チェック状態 */
  checked: boolean;
};

export type OrderStatus = "pending" | "completed";

export type Customer = {
  customerId: string;
  tableId: string;
  guestCount: number;
  isPaid: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

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

export type Table = {
  tableId: string;
  tableNumber: string;
  deviceId: string;
  deleted: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CartItem = {
  /** ライン識別子 */
  lineId: string;
  /** セット識別子。メインは自分の lineId、サイドは親メインの lineId。 */
  setId: string;
  menuId: string;
  /** 整数（円）。単品価格 */
  price: number;
  /** 整数 */
  quantity: number;
  name: string;
  /** メイン・単品のみ使用。空文字は備考なし。 */
  note: string;
};
