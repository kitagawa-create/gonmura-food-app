"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import { trackEvent } from "@/lib/analytics";
import Link from "next/link";

export default function OrderPage() {
  const { items, updateQuantity, removeItem, totalAmount, totalItems, clearCart, tableNumber } =
    useCart();
  const [customerNote, setCustomerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center px-4">
        <p className="text-neutral-500 text-lg mb-4">カートが空です</p>
        <Link href="/menu" className="text-orange-400 font-medium hover:underline">
          メニューに戻る
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !tableNumber) return;
    setSubmitting(true);

    try {
      const orderRef = doc(collection(db, "orders"));
      await setDoc(orderRef, {
        items: items.map((item) => ({
          menuId: item.menuId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        })),
        status: "pending",
        tableNumber,
        customerNote,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      trackEvent("purchase", {
        table_number: tableNumber,
        items_count: items.length,
        total_amount: totalAmount,
      });

      clearCart();
      router.push(`/order/${orderRef.id}`);
    } catch {
      alert("注文の送信に失敗しました。もう一度お試しください。");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 pb-36">
      <header className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center">
          <Link href="/menu" className="text-neutral-400 mr-4">&larr;</Link>
          <h1 className="text-lg font-bold text-white">注文確認</h1>
          <span className="ml-auto text-xs text-neutral-500">
            テーブル {tableNumber} / {totalItems}点
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
        {/* 数量調節可能な明細 */}
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.menuId}
              className="bg-neutral-900 rounded-xl border border-neutral-800 p-4"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-white">{item.name}</h3>
                  <p className="text-orange-400 font-bold mt-1">
                    {item.price.toLocaleString()}円
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.menuId)}
                  className="text-neutral-600 hover:text-red-400 text-sm transition-colors"
                >
                  削除
                </button>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => updateQuantity(item.menuId, item.quantity - 1)}
                  className="w-9 h-9 rounded-full border border-neutral-700 flex items-center justify-center text-neutral-400 hover:bg-neutral-800 transition-colors"
                  aria-label="数量を減らす"
                >
                  -
                </button>
                <span className="font-bold text-white w-8 text-center tabular-nums">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => updateQuantity(item.menuId, item.quantity + 1)}
                  className="w-9 h-9 rounded-full border border-neutral-700 flex items-center justify-center text-neutral-400 hover:bg-neutral-800 transition-colors"
                  aria-label="数量を増やす"
                >
                  +
                </button>
                <span className="ml-auto text-neutral-300 font-medium">
                  {(item.price * item.quantity).toLocaleString()}円
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 合計 */}
        <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-4 flex justify-between items-center">
          <span className="font-bold text-white">合計 ({totalItems}点)</span>
          <span className="font-bold text-orange-400 text-xl">
            {totalAmount.toLocaleString()}円
          </span>
        </div>

        {/* 備考 + 確定ボタン */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-4">
            <label className="block font-medium text-neutral-300 mb-2 text-sm">
              備考（任意）
            </label>
            <textarea
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              placeholder="アレルギーや要望があればご記入ください"
              rows={3}
              maxLength={500}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
            />
          </div>
        </form>
      </main>

      {/* 固定フッター: 確定ボタン */}
      <div className="fixed bottom-0 left-0 right-0 bg-neutral-900 border-t border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-orange-500 text-white py-3.5 rounded-xl font-bold hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {submitting ? "送信中..." : `注文を確定する (${totalAmount.toLocaleString()}円)`}
          </button>
          <Link
            href="/menu"
            className="block w-full text-center py-2 text-neutral-500 text-sm mt-2 hover:text-neutral-300 transition-colors"
          >
            メニューに戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
