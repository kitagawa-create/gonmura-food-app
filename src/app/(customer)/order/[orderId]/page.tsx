"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order } from "@/types";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import Link from "next/link";
import { useParams } from "next/navigation";

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "受付中", color: "bg-yellow-500/20 text-yellow-400" },
  preparing: { label: "調理中", color: "bg-blue-500/20 text-blue-400" },
  completed: { label: "完成", color: "bg-green-500/20 text-green-400" },
  cancelled: { label: "キャンセル", color: "bg-red-500/20 text-red-400" },
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
    return <FullScreenLoader />;
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 px-4">
        <p className="text-neutral-500 text-lg mb-4">注文が見つかりません</p>
        <Link href="/menu" className="text-orange-400 font-medium hover:underline">
          メニューに戻る
        </Link>
      </div>
    );
  }

  const status = statusLabels[order.status] ?? {
    label: order.status,
    color: "bg-neutral-800 text-neutral-400",
  };

  const totalAmount = order.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return (
    <div className="min-h-screen bg-neutral-950 pb-8">
      <header className="bg-neutral-900 border-b border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <h1 className="text-lg font-bold text-white text-center">注文状況</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-6 text-center">
          <p className="text-sm text-neutral-500 mb-3">テーブル {order.tableNumber}</p>
          <span className={`inline-block px-5 py-2.5 rounded-full text-lg font-bold ${status.color}`}>
            {status.label}
          </span>
          {order.status === "completed" && (
            <p className="mt-4 text-green-400 font-medium">お料理ができました！</p>
          )}
        </div>

        <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-4">
          <h2 className="font-bold text-white mb-3">注文内容</h2>
          {order.items.map((item, i) => (
            <div key={i} className="flex justify-between py-2 border-b border-neutral-800 last:border-0">
              <span className="text-neutral-300">{item.name} x {item.quantity}</span>
              <span className="text-neutral-300">{(item.price * item.quantity).toLocaleString()}円</span>
            </div>
          ))}
          <div className="flex justify-between pt-3 mt-2 border-t border-neutral-700">
            <span className="font-bold text-white">合計</span>
            <span className="font-bold text-orange-400">{totalAmount.toLocaleString()}円</span>
          </div>
        </div>

        {order.customerNote && (
          <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-4">
            <h2 className="font-bold text-white mb-2">備考</h2>
            <p className="text-neutral-400">{order.customerNote}</p>
          </div>
        )}

        <Link
          href="/menu"
          className="block w-full text-center py-3 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          メニューに戻る
        </Link>
      </main>
    </div>
  );
}
