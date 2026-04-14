"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order } from "@/types";

type TableBill = {
  tableNumber: number;
  orders: Order[];
  totalAmount: number;
};

type Tab = "unpaid" | "paid";

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupByTable(orders: Order[]): TableBill[] {
  const tableMap = new Map<number, Order[]>();
  for (const order of orders) {
    const existing = tableMap.get(order.tableNumber) || [];
    existing.push(order);
    tableMap.set(order.tableNumber, existing);
  }

  const tableBills: TableBill[] = [];
  for (const [tableNumber, tableOrders] of tableMap) {
    const totalAmount = tableOrders.reduce(
      (sum, o) =>
        sum + o.items.reduce((s, i) => s + i.price * i.quantity, 0),
      0
    );
    tableBills.push({ tableNumber, orders: tableOrders, totalAmount });
  }

  tableBills.sort((a, b) => a.tableNumber - b.tableNumber);
  return tableBills;
}

function mergeItems(orders: Order[]): { name: string; price: number; quantity: number }[] {
  const allItems: { name: string; price: number; quantity: number }[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      const existing = allItems.find(
        (a) => a.name === item.name && a.price === item.price
      );
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        allItems.push({ name: item.name, price: item.price, quantity: item.quantity });
      }
    }
  }
  return allItems;
}

export default function AdminRegisterPage() {
  const [unpaidOrders, setUnpaidOrders] = useState<Order[]>([]);
  const [paidOrders, setPaidOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("unpaid");
  const [dateFilter, setDateFilter] = useState<string>(todayISO());

  // 未精算（リアルタイム）
  useEffect(() => {
    const q = query(
      collection(db, "orders"),
      where("status", "in", ["pending", "preparing", "completed"])
    );

    const unsub = onSnapshot(q, (snap) => {
      setUnpaidOrders(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order)
      );
      setLoading(false);
    });

    return unsub;
  }, []);

  // 精算済み（日付フィルタ・リアルタイム）
  useEffect(() => {
    const start = new Date(`${dateFilter}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const q = query(
      collection(db, "orders"),
      where("status", "==", "paid"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<", Timestamp.fromDate(end)),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      setPaidOrders(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order)
      );
    });

    return unsub;
  }, [dateFilter]);

  const unpaidTables = useMemo(() => groupByTable(unpaidOrders), [unpaidOrders]);
  const paidTables = useMemo(() => groupByTable(paidOrders), [paidOrders]);

  async function handlePay(table: TableBill) {
    if (processing !== null) return;
    if (!confirm(`テーブル ${table.tableNumber} の精算（¥${table.totalAmount.toLocaleString()}）を完了しますか？`)) return;

    setProcessing(table.tableNumber);
    setError(null);

    try {
      for (const order of table.orders) {
        await updateDoc(doc(db, "orders", order.id), {
          status: "paid",
          updatedAt: serverTimestamp(),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "精算に失敗しました。");
    } finally {
      setProcessing(null);
    }
  }

  const currentTables = tab === "unpaid" ? unpaidTables : paidTables;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">レジ</h1>
        {tab === "paid" && (
          <label className="text-sm">
            日付：
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="ml-2 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {/* タブ */}
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab("unpaid")}
          className={`border-b-2 px-4 py-2 text-sm ${
            tab === "unpaid"
              ? "border-gray-800 font-semibold text-gray-900"
              : "border-transparent text-gray-500"
          }`}
        >
          未精算
          <span className="ml-2 text-xs text-gray-500">({unpaidTables.length})</span>
        </button>
        <button
          onClick={() => setTab("paid")}
          className={`border-b-2 px-4 py-2 text-sm ${
            tab === "paid"
              ? "border-gray-800 font-semibold text-gray-900"
              : "border-transparent text-gray-500"
          }`}
        >
          精算済み
          <span className="ml-2 text-xs text-gray-500">({paidTables.length})</span>
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">読み込み中...</p>
      ) : currentTables.length === 0 ? (
        <p className="text-sm text-gray-500">
          {tab === "unpaid" ? "未精算のテーブルはありません。" : "精算済みの注文はありません。"}
        </p>
      ) : (
        <div className="space-y-4">
          {currentTables.map((table) => {
            const allItems = mergeItems(table.orders);
            const tax = Math.floor((table.totalAmount * 10) / 110);
            const subtotal = table.totalAmount - tax;

            return (
              <div
                key={table.tableNumber}
                className={`rounded border p-4 ${
                  tab === "paid" ? "border-gray-200 bg-gray-50" : "border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-bold">テーブル {table.tableNumber}</h2>
                    <p className="text-xs text-gray-500">{table.orders.length}件の注文</p>
                  </div>
                  <p className="text-xl font-bold">¥{table.totalAmount.toLocaleString()}</p>
                </div>

                <ul className="mb-3 space-y-1 text-sm border-t border-gray-100 pt-3">
                  {allItems.map((item, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{item.name} x {item.quantity}</span>
                      <span className="text-gray-600">
                        ¥{(item.price * item.quantity).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="text-xs text-gray-500 mb-3 border-t border-gray-100 pt-2 space-y-1">
                  <div className="flex justify-between">
                    <span>小計</span>
                    <span>¥{subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>消費税(10%)</span>
                    <span>¥{tax.toLocaleString()}</span>
                  </div>
                </div>

                {tab === "unpaid" && (
                  <button
                    onClick={() => handlePay(table)}
                    disabled={processing !== null}
                    className="w-full rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {processing === table.tableNumber ? "処理中..." : "精算完了"}
                  </button>
                )}

                {tab === "paid" && (
                  <p className="text-center text-xs text-green-600 font-medium">精算済み</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
