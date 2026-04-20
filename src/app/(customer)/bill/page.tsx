"use client";

import { useEffect, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import type { OrderWithItems } from "@/types";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import { BackButton } from "@/components/ui/BackButton";
import { flattenForReceipt, normalizeOrder, normalizeOrderItem } from "@/lib/order-utils";
import Link from "next/link";

export default function BillPage() {
  const { tableNumber, customerId } = useCart();
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  // customerId が無いなら fetch しないので loading=false で開始
  const [loading, setLoading] = useState(() => customerId !== null);

  useEffect(() => {
    if (!customerId) return;

    async function fetchOrders() {
      const q = query(
        collection(db, "customers", customerId!, "orders"),
        where("status", "in", ["pending", "completed"])
      );
      const snap = await getDocs(q);
      const orderDocs = snap.docs.map((d) => normalizeOrder(d.id, d.data() as Record<string, unknown>, customerId!));
      const withItems: OrderWithItems[] = await Promise.all(
        orderDocs.map(async (order) => {
          const itemsSnap = await getDocs(collection(db, "customers", customerId!, "orders", order.id, "items"));
          return {
            ...order,
            items: itemsSnap.docs.map((d) => normalizeOrderItem(d.id, d.data() as Record<string, unknown>)),
          };
        })
      );
      setOrders(withItems.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)));
      setLoading(false);
    }
    fetchOrders();
  }, [customerId]);

  if (!customerId) {
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

  if (orders.length === 0) {
    return (
      <div className="relative min-h-screen bg-[color:var(--color-bg-base)] flex flex-col items-center justify-center px-4">
        <BackButton href="/menu" label="メニューに戻る" size="sm" className="absolute top-3 left-3" />
        <p className="text-[color:var(--color-text-muted)] text-lg">
          未精算の注文はありません
        </p>
      </div>
    );
  }

  // コンボ内トッピングも独立行に展開して name+price でマージ
  const allItems: { name: string; price: number; quantity: number }[] = [];
  for (const order of orders) {
    for (const flat of flattenForReceipt(order.items)) {
      const existing = allItems.find(
        (a) => a.name === flat.name && a.price === flat.price
      );
      if (existing) existing.quantity += flat.quantity;
      else allItems.push({ name: flat.name, price: flat.price, quantity: flat.quantity });
    }
  }

  const totalAmount = allItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = Math.floor((totalAmount * 10) / 110);
  const subtotal = totalAmount - tax;

  return (
    <div className="relative min-h-screen bg-[color:var(--color-bg-base)] p-4 flex flex-col">
      <BackButton href="/menu" label="メニューに戻る" size="sm" className="absolute top-3 left-3 z-10" />
      <div className="flex-1 flex items-center justify-center">
        {/* レシート: 外側 padding 撤去、各セクションが px-6 + 全幅 dashed divider */}
        <div className="w-full max-w-sm md:max-w-md lg:max-w-lg bg-[color:var(--color-bg-card)] rounded-2xl border border-[color:var(--color-border)] overflow-hidden">
          <div className="text-center px-6 pt-6 pb-4">
            <h1 className="text-3xl font-bold text-[color:var(--color-text-primary)]">
              お会計
            </h1>
            <p className="text-xs text-[color:var(--color-text-muted)] mt-1">Gonmura Food</p>
          </div>

          <div className="text-sm text-[color:var(--color-text-muted)] px-6 py-3 border-t border-dashed border-[color:var(--color-border)]">
            <div className="flex justify-between">
              <span>テーブル</span>
              <span className="text-[color:var(--color-text-primary)]">{tableNumber}番</span>
            </div>
          </div>

          <div className="px-6 py-3 border-t border-dashed border-[color:var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[color:var(--color-text-muted)]">
                  <th className="text-left font-normal pb-2">品名</th>
                  <th className="text-center font-normal pb-2 w-10">数</th>
                  <th className="text-right font-normal pb-2 w-20">金額</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((item, i) => (
                  <tr key={i}>
                    <td className="py-1 text-[color:var(--color-text-primary)]">{item.name}</td>
                    <td className="py-1 text-center text-[color:var(--color-text-muted)]">
                      {item.quantity}
                    </td>
                    <td className="py-1 text-right text-[color:var(--color-text-primary)] tabular-nums">
                      ¥{(item.price * item.quantity).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-3 border-t border-dashed border-[color:var(--color-border)] space-y-1 text-sm">
            <div className="flex justify-between text-[color:var(--color-text-muted)]">
              <span>小計</span>
              <span className="tabular-nums">¥{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-[color:var(--color-text-muted)]">
              <span>消費税(10%)</span>
              <span className="tabular-nums">¥{tax.toLocaleString()}</span>
            </div>
          </div>

          <div className="flex justify-between px-6 py-3 text-xl font-bold border-t border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-subtle)]">
            <span className="text-[color:var(--color-text-primary)]">合計</span>
            <span className="text-[color:var(--color-accent-char)] tabular-nums">
              ¥{totalAmount.toLocaleString()}
            </span>
          </div>

          <div className="px-6 py-5 border-t border-dashed border-[color:var(--color-border)] text-center space-y-1">
            <p className="text-sm font-bold text-[color:var(--color-text-primary)]">
              番号札をお持ちの上、レジまでお越しください
            </p>
            <p className="text-xs text-[color:var(--color-text-muted)]">
              ご利用ありがとうございました
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
