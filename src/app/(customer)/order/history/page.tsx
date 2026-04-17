"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import type { Order, OrderItem } from "@/types";

type OrderWithItems = Order & { items: OrderItem[] };
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import { BackButton } from "@/components/ui/BackButton";
import { comboLineTotal } from "@/lib/order-utils";
export default function OrderHistoryPage() {
  const { tableNumber } = useCart();
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(() => tableNumber !== null);

  useEffect(() => {
    if (!tableNumber) return;

    const q = query(
      collection(db, "orders"),
      where("tableNumber", "==", tableNumber),
      where("status", "in", ["pending", "completed"])
    );

    const unsub = onSnapshot(q, (snap) => {
      const orderDocs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Order)
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      Promise.all(
        orderDocs.map(async (order) => {
          const itemsSnap = await getDocs(collection(db, "orders", order.id, "items"));
          const items: OrderItem[] = itemsSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<OrderItem, "id">),
          }));
          return { ...order, items };
        })
      ).then((data) => {
        setOrders(data);
        setLoading(false);
      });
    });
    return () => unsub();
  }, [tableNumber]);

  if (!tableNumber) {
    return (
      <div className="min-h-screen bg-[color:var(--color-bg-base)] flex flex-col items-center justify-center px-4">
        <p className="text-[color:var(--color-text-muted)] text-lg mb-4">
          テーブル番号が設定されていません
        </p>
        <a
          href="/menu"
          className="text-[color:var(--color-accent-char)] font-medium hover:underline"
        >
          メニューに戻る
        </a>
      </div>
    );
  }

  if (loading) {
    return <FullScreenLoader />;
  }

  return (
    <div className="relative min-h-screen bg-[color:var(--color-bg-base)] pb-8">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <BackButton href="/menu" label="メニューに戻る" size="sm" />
        <h1 className="text-base font-bold text-[color:var(--color-text-primary)]">注文履歴</h1>
      </div>

      <main className="px-3 sm:px-4 pt-14 pb-4">
        {orders.length === 0 ? (
          <p className="text-[color:var(--color-text-muted)] text-center py-12">
            まだ注文がありません
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {orders.map((order) => {
              const total = order.items.reduce(
                (sum, item) => sum + comboLineTotal(item),
                0
              );
              const time = order.createdAt?.toDate?.();

              return (
                <div
                  key={order.id}
                  className="bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] p-4"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="text-xs text-[color:var(--color-text-muted)]">
                        {time
                          ? time.toLocaleTimeString("ja-JP", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </p>
                    </div>
                    <span className="font-bold text-[color:var(--color-accent-char)]">
                      {total.toLocaleString()}円
                    </span>
                  </div>
                  <ul className="text-sm text-[color:var(--color-text-muted)] space-y-0.5">
                    {order.items.map((item, i) => (
                      <li key={i}>
                        <div>
                          {item.name} x {item.quantity}
                        </div>
                        {item.toppings && item.toppings.length > 0 && (
                          <ul className="ml-4 text-xs">
                            {item.toppings.map((t) => (
                              <li key={t.menuId}>
                                ＋ {t.name} x {t.quantity * item.quantity}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
