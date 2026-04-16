"use client";

import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import type { Order } from "@/types";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import { BackButton } from "@/components/ui/BackButton";
import Link from "next/link";

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "受付中", color: "var(--color-accent-warn)" },
  preparing: { label: "調理中", color: "var(--color-accent-soy)" },
  completed: { label: "完成", color: "var(--color-accent-negi)" },
};

export default function OrderHistoryPage() {
  const { tableNumber } = useCart();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(() => tableNumber !== null);

  useEffect(() => {
    if (!tableNumber) return;

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
      <div className="min-h-screen bg-[color:var(--color-bg-base)] flex flex-col items-center justify-center px-4">
        <p className="text-[color:var(--color-text-muted)] text-lg mb-4">
          テーブル番号が設定されていません
        </p>
        <Link
          href="/menu"
          className="text-[color:var(--color-accent-char)] font-medium hover:underline"
        >
          メニューに戻る
        </Link>
      </div>
    );
  }

  if (loading) {
    return <FullScreenLoader />;
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-bg-base)] pb-8">
      <header className="sticky top-0 z-10 bg-[color:var(--color-bg-card)] border-b border-[color:var(--color-border)]">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-2 flex items-center gap-2">
          <BackButton href="/menu" label="メニューに戻る" size="sm" />
          <h1 className="text-lg font-bold text-[color:var(--color-text-primary)]">注文履歴</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {orders.length === 0 ? (
          <p className="text-[color:var(--color-text-muted)] text-center py-12">
            まだ注文がありません
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {orders.map((order) => {
              const status = statusLabels[order.status] ?? {
                label: order.status,
                color: "var(--color-text-primary)",
              };
              const total = order.items.reduce(
                (sum, item) => sum + item.price * item.quantity,
                0
              );
              const time = order.createdAt?.toDate?.();

              return (
                <Link
                  key={order.id}
                  href={`/order/${order.id}?from=history`}
                  className="block bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] p-4 hover:border-[color:var(--color-accent-soy)] transition-colors"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span
                        className="inline-block px-3 py-1 rounded-full text-xs font-bold border"
                        style={{ borderColor: status.color, color: status.color }}
                      >
                        {status.label}
                      </span>
                      <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
                        {time ? time.toLocaleString("ja-JP") : ""}
                      </p>
                    </div>
                    <span className="font-bold text-[color:var(--color-accent-char)]">
                      {total.toLocaleString()}円
                    </span>
                  </div>
                  <ul className="text-sm text-[color:var(--color-text-muted)] space-y-0.5">
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
