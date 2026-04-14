"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order } from "@/types";
import Link from "next/link";
import { useParams } from "next/navigation";

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "受付中", color: "bg-yellow-100 text-yellow-800" },
  preparing: { label: "調理中", color: "bg-blue-100 text-blue-800" },
  completed: { label: "完成", color: "bg-green-100 text-green-800" },
  cancelled: { label: "キャンセル", color: "bg-red-100 text-red-800" },
};

export default function OrderStatusPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "orders", orderId), (snap) => {
      if (snap.exists()) {
        setOrder({ id: snap.id, ...snap.data() } as Order);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [orderId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4">
        <p className="text-gray-500 text-lg mb-4">注文が見つかりません</p>
        <Link
          href="/menu"
          className="text-orange-500 font-medium hover:underline"
        >
          メニューに戻る
        </Link>
      </div>
    );
  }

  const status = statusLabels[order.status] ?? {
    label: order.status,
    color: "bg-gray-100 text-gray-800",
  };

  const totalAmount = order.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <header className="bg-white shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-center">注文状況</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-lg shadow-sm p-6 text-center">
          <p className="text-sm text-gray-500 mb-2">テーブル {order.tableNumber}</p>
          <span
            className={`inline-block px-4 py-2 rounded-full text-lg font-bold ${status.color}`}
          >
            {status.label}
          </span>
          {order.status === "completed" && (
            <p className="mt-3 text-green-600 font-medium">
              お料理ができました！
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm p-4">
          <h2 className="font-bold text-gray-800 mb-3">注文内容</h2>
          {order.items.map((item, i) => (
            <div
              key={i}
              className="flex justify-between py-2 border-b border-gray-100 last:border-0"
            >
              <span className="text-gray-700">
                {item.name} x {item.quantity}
              </span>
              <span className="text-gray-700">
                {(item.price * item.quantity).toLocaleString()}円
              </span>
            </div>
          ))}
          <div className="flex justify-between pt-3 mt-2 border-t border-gray-200">
            <span className="font-bold">合計</span>
            <span className="font-bold text-orange-600">
              {totalAmount.toLocaleString()}円
            </span>
          </div>
        </div>

        {order.customerNote && (
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h2 className="font-bold text-gray-800 mb-2">備考</h2>
            <p className="text-gray-600">{order.customerNote}</p>
          </div>
        )}

        <Link
          href="/menu"
          className="block w-full text-center py-3 text-orange-500 font-medium hover:underline"
        >
          メニューに戻る
        </Link>
      </main>
    </div>
  );
}
