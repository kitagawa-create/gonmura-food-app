import { Timestamp } from "firebase/firestore";

/**
 * 数値フィールドはすべて整数（int）として扱う。
 * 小数は保存しない。書き込み前に Math.trunc / parseInt で正規化すること。
 */

export type Category = {
  id: string;
  name: string;
  /** 整数 */
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Menu = {
  id: string;
  name: string;
  description: string;
  /** 税込価格。整数（円） */
  price: number;
  categoryIds: string[];
  imageUrl: string;
  isAvailable: boolean;
  /**
   * 在庫売り切れ。isAvailable とは独立に管理。
   * - isAvailable=false: 非公開（顧客側で一切表示しない）
   * - isSoldOut=true:    売り切れ（顧客側で薄表示+「売り切れ」オーバーレイ、注文不可）
   * undefined は false として扱う。
   */
  isSoldOut?: boolean;
  /** 表示順（整数、小さいほど上）。未設定のメニューは最後尾に配置 */
  sortOrder?: number;
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
  id: string;
  menuId: string;
  name: string;
  /** 注文時点のスナップショット。整数（円）。単品価格 (トッピング分は含まない) */
  price: number;
  /** 整数。コンボなら「杯数」 */
  quantity: number;
  /** ラーメンコンボのみ。このコンボに付くトッピング一覧 (quantity は1杯あたり) */
  toppings?: OrderItemTopping[];
  /** 注文時スナップショット */
  note?: string;
  /** チェック状態（旧 checkedItems 配列を置き換え） */
  checked?: boolean;
};

export type Customer = {
  id: string;
  tableNumber: number;
  guestCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type OrderStatus = "pending" | "completed" | "paid";

export type AdminRole = "owner" | "staff";

export type Order = {
  id: string;
  status: OrderStatus;
  /** customers コレクションへの参照（必須）。tableNumber・guestCount はここから取得 */
  customerId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};


export type Admin = {
  uid: string;
  email: string;
  role: AdminRole;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CartItemTopping = {
  menuId: string;
  name: string;
  /** 整数（円） */
  price: number;
  /** 1コンボあたりの個数 */
  quantity: number;
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
  /** ラーメンコンボのみ */
  toppings?: CartItemTopping[];
  /** 商品ごとの備考（アレルギー等） */
  note?: string;
};

