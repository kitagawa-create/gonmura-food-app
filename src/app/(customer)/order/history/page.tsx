"use client";

import { useEffect, useState } from "react";
import { collectionGroup, getDocs, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import type { OrderWithItems } from "@/types";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import { CustomerPageHeader } from "@/components/customer/CustomerPageHeader";
import { comboLineTotal, normalizeOrder, normalizeOrderItem } from "@/lib/order-utils";

export default function OrderHistoryPage() {
  const { customerId } = useCart();
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(() => customerId !== null);

  useEffect(() => {
    if (!customerId) return;

    const q = query(
      collectionGroup(db, "orders"),
      where("customerId", "==", customerId),
      where("status", "in", ["pending", "completed"])
    );

    let cancelled = false;
    let gen = 0;
    const unsub = onSnapshot(q, async (snap) => {
      const current = ++gen;
      const orderDocs = snap.docs.map((d) => normalizeOrder(d.id, d.data() as Record<string, unknown>, customerId!));
      const withItems: OrderWithItems[] = await Promise.all(
        orderDocs.map(async (order) => {
          const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.id)));
          return {
            ...order,
            items: itemsSnap.docs.map((d) => normalizeOrderItem(d.id, d.data() as Record<string, unknown>)),
          };
        })
      );
      if (cancelled || current !== gen) return;
      setOrders(withItems.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)));
      setLoading(false);
    }, () => { if (!cancelled) { setOrders([]); setLoading(false); } });
    return () => { cancelled = true; unsub(); };
  }, [customerId]);

  if (loading) {
    return <FullScreenLoader />;
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-[color:var(--color-bg-base)]">
      <CustomerPageHeader title="注文履歴" />

      <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 pb-8">
        {!customerId || orders.length === 0 ? (
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
                        {item.toppings.length > 0 && (
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
