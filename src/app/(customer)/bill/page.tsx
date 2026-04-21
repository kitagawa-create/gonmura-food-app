"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collectionGroup, doc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import type { OrderWithItems } from "@/types";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import { CustomerPageHeader } from "@/components/customer/CustomerPageHeader";
import { normalizeOrder, normalizeOrderItem, comboLineHash, comboLineTotal } from "@/lib/order-utils";
import Link from "next/link";

const TABLE_ID_KEY = "gonmura-table-id";
const TABLE_KEY = "gonmura-table";

export default function BillPage() {
  const { tableNumber, customerId, resetSession } = useCart();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(() => customerId !== null);
  const [paying, setPaying] = useState(false);
  const [payDone, setPayDone] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!customerId) return;

    async function fetchOrders() {
      const q = query(
        collectionGroup(db, "orders"),
        where("customerId", "==", customerId),
        where("status", "in", ["pending", "completed"])
      );
      const snap = await getDocs(q);
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
      setOrders(withItems.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)));
      setLoading(false);
    }
    fetchOrders();
  }, [customerId]);

  useEffect(() => {
    if (!payDone) return;
    const timer = setTimeout(() => router.replace("/setup"), 5000);
    return () => clearTimeout(timer);
  }, [payDone, router]);

  async function handlePay() {
    if (!customerId || paying || orders.length === 0) return;
    setPaying(true);
    try {
      const batch = writeBatch(db);
      for (const order of orders) {
        batch.update(doc(db, "customers", customerId, "orders", order.id), {
          status: "paid",
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      resetSession();
      localStorage.removeItem(TABLE_ID_KEY);
      localStorage.removeItem(TABLE_KEY);
      setPayDone(true);
    } finally {
      setPaying(false);
    }
  }

  if (payDone) {
    return (
      <div className="min-h-screen bg-[color:var(--color-bg-base)] flex flex-col items-center justify-center px-4 gap-3">
        <p className="text-lg font-bold text-[color:var(--color-accent-negi)]">お支払いが完了しました</p>
        <p className="text-sm text-[color:var(--color-text-muted)]">ご利用ありがとうございました</p>
      </div>
    );
  }

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
      <div className="h-[100dvh] flex flex-col bg-[color:var(--color-bg-base)]">
        <CustomerPageHeader title="お会計" />
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-[color:var(--color-text-muted)] text-lg">
            未精算の注文はありません
          </p>
        </div>
      </div>
    );
  }

  type ComboLine = { menuId: string; name: string; price: number; quantity: number; toppings: { menuId: string; name: string; price: number; quantity: number }[] };
  const allCombos: ComboLine[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      const hash = comboLineHash(item.menuId, item.toppings, "");
      const existing = allCombos.find((c) => comboLineHash(c.menuId, c.toppings, "") === hash);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        allCombos.push({ menuId: item.menuId, name: item.name, price: item.price, quantity: item.quantity, toppings: item.toppings.map((t) => ({ ...t })) });
      }
    }
  }

  const totalAmount = allCombos.reduce((sum, item) => sum + comboLineTotal(item), 0);
  const tax = Math.floor((totalAmount * 10) / 110);
  const subtotal = totalAmount - tax;

  return (
    <div className="h-[100dvh] flex flex-col bg-[color:var(--color-bg-base)]">
      <CustomerPageHeader title="お会計" />
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center p-4">
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
                {allCombos.map((item, i) => (
                  <Fragment key={i}>
                    <tr>
                      <td className="py-1 text-[color:var(--color-text-primary)]">{item.name}</td>
                      <td className="py-1 text-center text-[color:var(--color-text-muted)]">{item.quantity}</td>
                      <td className="py-1 text-right text-[color:var(--color-text-primary)] tabular-nums">
                        ¥{comboLineTotal(item).toLocaleString()}
                      </td>
                    </tr>
                    {item.toppings.map((t) => (
                      <tr key={t.menuId}>
                        <td className="pb-0.5 pl-3 text-xs text-[color:var(--color-text-muted)]">
                          ＋ {t.name} ×{t.quantity * item.quantity}
                        </td>
                        <td /><td />
                      </tr>
                    ))}
                  </Fragment>
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

          <div className="px-6 py-5 border-t border-dashed border-[color:var(--color-border)] text-center space-y-3">
              <button
                onClick={() => setShowConfirm(true)}
                disabled={paying}
                className="w-full rounded-xl bg-[color:var(--color-accent-char)] py-3 text-base font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                支払い完了
              </button>
          </div>

        </div>
        </div>
      </div>
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] shadow-xl p-6 space-y-4">
            <div className="text-center">
              <p className="text-base font-bold text-[color:var(--color-text-primary)]">お支払いを確定しますか？</p>
              <p className="mt-1 text-2xl font-black text-[color:var(--color-accent-char)] tabular-nums">
                ¥{totalAmount.toLocaleString()}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 rounded-xl border border-[color:var(--color-border)] py-3 text-sm font-bold text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={() => { setShowConfirm(false); handlePay(); }}
                disabled={paying}
                className="flex-[2] rounded-xl bg-[color:var(--color-accent-char)] py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {paying ? "処理中..." : "支払う"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
