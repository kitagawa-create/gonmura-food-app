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
  menuId: string;
  name: string;
  /** 注文時点のスナップショット。整数（円）。単品価格 (トッピング分は含まない) */
  price: number;
  /** 整数。コンボなら「杯数」 */
  quantity: number;
  /** ラーメンコンボのみ。このコンボに付くトッピング一覧 (quantity は1杯あたり) */
  toppings?: OrderItemTopping[];
};

export type OrderStatus = "pending" | "completed" | "paid";

export type AdminRole = "owner" | "staff";

export type Order = {
  id: string;
  items: OrderItem[];
  status: OrderStatus;
  /** 整数。1以上 */
  tableNumber: number;
  customerNote: string;
  /** チェック済み商品のインデックス (0-based)。全チェック後「提供完了」ボタンで completed に遷移 */
  checkedItems?: number[];
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
};
