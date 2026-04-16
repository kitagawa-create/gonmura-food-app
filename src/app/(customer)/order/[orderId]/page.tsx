"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order } from "@/types";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import { BackButton } from "@/components/ui/BackButton";
import Link from "next/link";
import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "受付中", color: "var(--color-accent-warn)" },
  preparing: { label: "調理中", color: "var(--color-accent-soy)" },
  completed: { label: "完成", color: "var(--color-accent-negi)" },
};

export default function OrderStatusPage() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <OrderStatusContent />
    </Suspense>
  );
}

function OrderStatusContent() {
  const params = useParams();
  const search = useSearchParams();
  const from = search?.get("from");
  const backHref = from === "history" ? "/order/history" : "/menu";
  const backLabel = from === "history" ? "注文履歴に戻る" : "メニューに戻る";
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
      <div className="flex flex-col items-center justify-center min-h-screen bg-[color:var(--color-bg-base)] px-4">
        <p className="text-[color:var(--color-text-muted)] text-lg mb-4">
          注文が見つかりません
        </p>
        <Link
          href={backHref}
          className="text-[color:var(--color-accent-char)] font-medium hover:underline"
        >
          {backLabel}
        </Link>
      </div>
    );
  }

  const status = statusLabels[order.status] ?? {
    label: order.status,
    color: "var(--color-text-primary)",
  };

  const totalAmount = order.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return (
    <div className="min-h-screen bg-[color:var(--color-bg-base)] pb-8">
      <header className="bg-[color:var(--color-bg-card)] border-b border-[color:var(--color-border)]">
        <div className="px-3 sm:px-4 py-2 flex items-center gap-2">
          <BackButton href={backHref} label={backLabel} size="sm" />
          <h1 className="text-lg font-bold text-[color:var(--color-text-primary)]">注文状況</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] p-6 text-center">
          <p className="text-sm text-[color:var(--color-text-muted)] mb-3">
            テーブル {order.tableNumber}
          </p>
          <span
            className="inline-block px-5 py-2.5 rounded-full text-lg font-bold border-2"
            style={{ borderColor: status.color, color: status.color }}
          >
            {status.label}
          </span>
          {order.status === "completed" && (
            <p className="mt-4 text-[color:var(--color-accent-negi)] font-medium">
              お料理ができました！
            </p>
          )}
        </div>

        {/* 注文内容 (外側 padding 撤去、各行 px-4 で divider 全幅) */}
        <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] overflow-hidden">
          <h2 className="font-bold text-[color:var(--color-text-primary)] px-4 py-3">注文内容</h2>
          <ul className="divide-y divide-[color:var(--color-border)] border-t border-[color:var(--color-border)]">
            {order.items.map((item, i) => (
              <li key={i} className="flex justify-between px-4 py-2.5">
                <span className="text-[color:var(--color-text-primary)]">
                  {item.name} x {item.quantity}
                </span>
                <span className="text-[color:var(--color-text-primary)] tabular-nums">
                  {(item.price * item.quantity).toLocaleString()}円
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between px-4 py-3 border-t border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-subtle)]">
            <span className="font-bold text-[color:var(--color-text-primary)]">合計</span>
            <span className="font-bold text-[color:var(--color-accent-char)] tabular-nums">
              {totalAmount.toLocaleString()}円
            </span>
          </div>
        </div>

        {order.customerNote && (
          <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] p-4">
            <h2 className="font-bold text-[color:var(--color-text-primary)] mb-2">備考</h2>
            <p className="text-[color:var(--color-text-muted)]">{order.customerNote}</p>
          </div>
        )}

      </main>
    </div>
  );
}
