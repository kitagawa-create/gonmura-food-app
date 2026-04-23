"use client";

import { useEffect, useMemo, useState } from "react";
import { collectionGroup, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import type { OrderWithItems } from "@/types";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import { CustomerPageHeader } from "@/components/customer/CustomerPageHeader";
import { comboLineTotal, groupOrderItemsForDisplay, normalizeOrder, normalizeOrderItem, taxIncluded } from "@/lib/order-utils";

function timeStr(d: Date) {
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending: {
    label: "調理中",
    className: "bg-[color:var(--color-accent-warn)]/10 text-[color:var(--color-accent-warn)]",
  },
  completed: {
    label: "提供済",
    className: "bg-[color:var(--color-bg-subtle)] text-[color:var(--color-text-muted)]",
  },
};

const PREVIEW = 2;

function OrderCard({ order }: { order: OrderWithItems }) {
  const [expanded, setExpanded] = useState(false);
  const total = order.items.reduce((s, i) => s + comboLineTotal(i), 0);
  const created = order.createdAt?.toDate?.();
  const updated = order.updatedAt?.toDate?.();
  // メインを先頭にしてサイドをその直後に配置（新旧両フォーマット対応）
  const orderedDisplayItems = groupOrderItemsForDisplay(order.items);
  const visibleDisplay = expanded ? orderedDisplayItems : orderedDisplayItems.slice(0, PREVIEW);
  const hiddenCount = orderedDisplayItems.length - PREVIEW;
  const statusInfo = STATUS_LABEL[order.status] ?? STATUS_LABEL.pending;

  return (
    <div className="flex items-start gap-8 sm:gap-10 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-4 shadow-sm">
      {/* ステータス */}
      <div className="shrink-0 w-14 pt-0.5">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${statusInfo.className}`}>
          {statusInfo.label}
        </span>
      </div>

      <div className="shrink-0 text-xs w-16">
        <p className="font-medium text-[color:var(--color-text-primary)] tabular-nums">
          {created ? timeStr(created) : "−"}
        </p>
      </div>
      <div className="shrink-0 text-xs w-16">
        <p className="font-medium text-[color:var(--color-text-primary)] tabular-nums">
          {order.status === "completed" && updated ? timeStr(updated) : "−"}
        </p>
      </div>

      {/* 注文メニュー */}
      <div className="flex-1 min-w-0">
        <ul className="text-sm space-y-2">
          {visibleDisplay.map(({ item, isSide }) => (
            <li key={item.itemId} className={isSide ? "ml-3" : ""}>
              <div className="flex items-baseline gap-2">
                <span className={`flex-1 truncate ${isSide ? "text-[color:var(--color-text-muted)]" : "text-[color:var(--color-text-primary)]"}`}>
                  {isSide && "＋"}{item.name}
                </span>
                <span className="w-8 shrink-0 text-right text-[color:var(--color-text-muted)] tabular-nums">×{item.quantity}</span>
              </div>
              {expanded && item.note && (
                <p className="ml-3 mt-0.5 text-xs text-[color:var(--color-accent-warn)]">※ {item.note}</p>
              )}
            </li>
          ))}
        </ul>
        {orderedDisplayItems.length > PREVIEW && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="mt-1 text-xs text-[color:var(--color-accent-char)] hover:underline"
          >
            {expanded ? "▲ 閉じる" : `▼ 他${hiddenCount}品を見る`}
          </button>
        )}
      </div>

      {/* 金額 */}
      <div className="shrink-0 pl-1">
        <p className="text-sm font-bold text-[color:var(--color-text-primary)] tabular-nums whitespace-nowrap">
          ¥{taxIncluded(total).toLocaleString()}<span className="ml-1 text-xs font-normal text-[color:var(--color-text-muted)]">（税抜¥{total.toLocaleString()}）</span>
        </p>
      </div>
    </div>
  );
}

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
      const orderDocs = snap.docs.map((d) =>
        normalizeOrder(d.id, d.data() as Record<string, unknown>, customerId!)
      );
      const withItems: OrderWithItems[] = await Promise.all(
        orderDocs.map(async (order) => {
          const itemsSnap = await getDocs(
            query(collectionGroup(db, "items"), where("orderId", "==", order.orderId))
          );
          return {
            ...order,
            items: itemsSnap.docs.map((d) =>
              normalizeOrderItem(d.id, d.data() as Record<string, unknown>)
            ),
          };
        })
      );
      if (cancelled || current !== gen) return;
      setOrders(withItems.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)));
      setLoading(false);
    }, () => { if (!cancelled) { setOrders([]); setLoading(false); } });
    return () => { cancelled = true; unsub(); };
  }, [customerId]);

  const grandTotal = useMemo(
    () => orders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + comboLineTotal(i), 0), 0),
    [orders]
  );

  if (loading) return <FullScreenLoader />;

  return (
    <div className="h-[100dvh] flex flex-col bg-[color:var(--color-bg-base)]">
      <CustomerPageHeader title="注文履歴" />

      {customerId && orders.length > 0 && (
        <div className="shrink-0 flex items-center gap-8 sm:gap-10 px-8 sm:px-10 py-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-bg-base)] text-xs font-semibold text-[color:var(--color-text-muted)]">
          <div className="w-14 shrink-0" />
          <div className="w-16 shrink-0">注文</div>
          <div className="w-16 shrink-0">提供</div>
          <div className="flex-1 min-w-0">商品名</div>
          <div className="shrink-0 pl-1">合計</div>
        </div>
      )}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 pb-24">
        {!customerId || orders.length === 0 ? (
          <p className="text-[color:var(--color-text-muted)] text-center py-12">
            まだ注文がありません
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {orders.map((order) => (
              <OrderCard key={order.orderId} order={order} />
            ))}
          </div>
        )}
      </main>

      {orders.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-[color:var(--color-bg-card)] border-t border-[color:var(--color-border)] px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-[color:var(--color-text-muted)]">{orders.length}件の注文</p>
          <p className="text-lg font-bold text-[color:var(--color-accent-char)] tabular-nums">
            合計 ¥{taxIncluded(grandTotal).toLocaleString()}<span className="ml-1 text-xs font-normal text-[color:var(--color-text-muted)]">（税抜¥{grandTotal.toLocaleString()}）</span>
          </p>
        </div>
      )}
    </div>
  );
}
