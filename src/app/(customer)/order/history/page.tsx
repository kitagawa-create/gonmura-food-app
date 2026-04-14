"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import type { Order } from "@/types";
import Link from "next/link";

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "受付中", color: "bg-yellow-100 text-yellow-800" },
  preparing: { label: "調理中", color: "bg-blue-100 text-blue-800" },
  completed: { label: "完成", color: "bg-green-100 text-green-800" },
  cancelled: { label: "キャンセル", color: "bg-red-100 text-red-800" },
};

export default function OrderHistoryPage() {
  const { tableNumber } = useCart();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tableNumber) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "orders"),
      where("tableNumber", "==", tableNumber),
      where("status", "in", ["pending", "preparing", "completed"])
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Order)
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setOrders(data);
      setLoading(false);
    });
    return () => unsub();
  }, [tableNumber]);

  if (!tableNumber) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <p className="text-gray-500 text-lg mb-4">
          テーブル番号が設定されていません
        </p>
        <p className="text-gray-400 text-sm mb-4">
          QRコードからアクセスしてください
        </p>
        <Link
          href="/menu"
          className="text-orange-500 font-medium hover:underline"
        >
          メニューに戻る
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="sticky top-0 z-10 bg-white shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center">
          <Link href="/menu" className="text-gray-600 mr-4">
            &larr;
          </Link>
          <h1 className="text-xl font-bold">
            テーブル {tableNumber} の注文履歴
          </h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        {orders.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            まだ注文がありません
          </p>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const status = statusLabels[order.status] ?? {
                label: order.status,
                color: "bg-gray-100 text-gray-800",
              };
              const total = order.items.reduce(
                (sum, item) => sum + item.price * item.quantity,
                0
              );
              const time = order.createdAt?.toDate?.();

              return (
                <Link
                  key={order.id}
                  href={`/order/${order.id}`}
                  className="block bg-white rounded-lg shadow-sm p-4"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${status.color}`}
                      >
                        {status.label}
                      </span>
                      <p className="text-xs text-gray-400 mt-1">
                        {time ? time.toLocaleString("ja-JP") : ""}
                      </p>
                    </div>
                    <span className="font-bold text-orange-600">
                      {total.toLocaleString()}円
                    </span>
                  </div>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {order.items.map((item, i) => (
                      <li key={i}>
                        {item.name} x {item.quantity}
                      </li>
                    ))}
                  </ul>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
