"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import { trackEvent } from "@/lib/analytics";
import Link from "next/link";

export default function OrderPage() {
  const { items, totalAmount, clearCart, tableNumber } = useCart();
  const [customerNote, setCustomerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <p className="text-gray-500 text-lg mb-4">カートが空です</p>
        <Link
          href="/menu"
          className="text-orange-500 font-medium hover:underline"
        >
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
    <div className="min-h-screen bg-gray-50 pb-8">
      <header className="sticky top-0 z-10 bg-white shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center">
          <Link href="/cart" className="text-gray-600 mr-4">
            &larr;
          </Link>
          <h1 className="text-xl font-bold">注文確認</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-bold text-gray-800">注文内容</h2>
            <span className="text-sm text-gray-400">テーブル {tableNumber}</span>
          </div>
          {items.map((item) => (
            <div
              key={item.menuId}
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <label className="block font-medium text-gray-700 mb-2">
              備考（任意）
            </label>
            <textarea
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              placeholder="アレルギーや要望があればご記入ください"
              rows={3}
              maxLength={500}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-orange-500 text-white py-3 rounded-lg font-medium hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "送信中..." : "注文を確定する"}
          </button>
        </form>
      </main>
    </div>
  );
}
