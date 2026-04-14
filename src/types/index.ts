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
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type OrderItem = {
  menuId: string;
  name: string;
  /** 注文時点のスナップショット。整数（円） */
  price: number;
  /** 整数 */
  quantity: number;
};

export type OrderStatus = "pending" | "preparing" | "completed" | "cancelled" | "paid";

export type Order = {
  id: string;
  items: OrderItem[];
  status: OrderStatus;
  /** 整数。1以上 */
  tableNumber: number;
  customerNote: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Admin = {
  uid: string;
  email: string;
  role: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CartItem = {
  menuId: string;
  /** 整数（円） */
  price: number;
  /** 整数 */
  quantity: number;
  name: string;
};
