"use client";

import { useEffect, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import type { Order } from "@/types";
import { FullScreenLoader } from "@/components/ui/FullScreenLoader";
import Link from "next/link";

export default function BillPage() {
  const { tableNumber } = useCart();
  const [orders, setOrders] = useState<Order[]>([]);
  // tableNumber が最初から無いなら fetch しないので loading=false で開始
  const [loading, setLoading] = useState(() => tableNumber !== null);

  useEffect(() => {
    if (!tableNumber) return;

    async function fetchOrders() {
      const q = query(
        collection(db, "orders"),
        where("tableNumber", "==", tableNumber),
        where("status", "in", ["pending", "preparing", "completed"])
      );
      const snap = await getDocs(q);
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Order)
        .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
      setOrders(data);
      setLoading(false);
    }
    fetchOrders();
  }, [tableNumber]);

  if (!tableNumber) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center px-4">
        <p className="text-neutral-500 text-lg mb-4">テーブル番号が設定されていません</p>
        <Link href="/menu" className="text-orange-400 font-medium hover:underline">メニューに戻る</Link>
      </div>
    );
  }

  if (loading) {
    return <FullScreenLoader />;
  }

  if (orders.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center px-4">
        <p className="text-neutral-500 text-lg mb-4">未精算の注文はありません</p>
        <Link href="/menu" className="text-orange-400 font-medium hover:underline">メニューに戻る</Link>
      </div>
    );
  }

  const allItems: { name: string; price: number; quantity: number }[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      const existing = allItems.find((a) => a.name === item.name && a.price === item.price);
      if (existing) existing.quantity += item.quantity;
      else allItems.push({ name: item.name, price: item.price, quantity: item.quantity });
    }
  }

  const totalAmount = allItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = Math.floor((totalAmount * 10) / 110);
  const subtotal = totalAmount - tax;

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm md:max-w-md lg:max-w-lg bg-neutral-900 rounded-2xl border border-neutral-800">
        <div className="p-6 space-y-4">
          <div className="text-center border-b border-dashed border-neutral-700 pb-4">
            <h1 className="text-2xl font-bold text-white">Gonmura Food</h1>
            <p className="text-sm text-neutral-500 mt-1">お会計</p>
          </div>

          <div className="text-sm text-neutral-400 border-b border-dashed border-neutral-700 pb-3">
            <div className="flex justify-between">
              <span>テーブル</span>
              <span className="text-white">{tableNumber}番</span>
            </div>
            <div className="flex justify-between mt-1">
              <span>注文数</span>
              <span className="text-white">{orders.length}件</span>
            </div>
          </div>

          <div className="border-b border-dashed border-neutral-700 pb-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-neutral-500">
                  <th className="text-left font-normal pb-2">品名</th>
                  <th className="text-center font-normal pb-2 w-10">数</th>
                  <th className="text-right font-normal pb-2 w-20">金額</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((item, i) => (
                  <tr key={i}>
                    <td className="py-1 text-neutral-200">{item.name}</td>
                    <td className="py-1 text-center text-neutral-400">{item.quantity}</td>
                    <td className="py-1 text-right text-neutral-200">
                      ¥{(item.price * item.quantity).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-neutral-400">
              <span>小計</span>
              <span>¥{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-neutral-400">
              <span>消費税(10%)</span>
              <span>¥{tax.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xl font-bold pt-3 border-t border-neutral-700">
              <span className="text-white">合計</span>
              <span className="text-orange-400">¥{totalAmount.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-dashed border-neutral-700 text-center">
          <p className="text-sm font-medium text-neutral-400">
            この画面をレジにてご提示ください
          </p>
        </div>

        <div className="p-4">
          <Link
            href="/menu"
            className="block w-full text-center py-3 text-neutral-500 text-sm hover:text-neutral-300 transition-colors"
          >
            メニューに戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
