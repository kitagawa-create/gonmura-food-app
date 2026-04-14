"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order, OrderStatus } from "@/types";

type TabStatus = Exclude<OrderStatus, "cancelled" | "paid">;

const TABS: { key: TabStatus; label: string }[] = [
  { key: "pending", label: "未対応" },
  { key: "preparing", label: "調理中" },
  { key: "completed", label: "完了" },
];

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);
    // 2回目の音（ピンポン）
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1100;
      osc2.type = "sine";
      gain2.gain.value = 0.3;
      osc2.start();
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc2.stop(ctx.currentTime + 0.5);
    }, 200);
  } catch {
    // Audio not supported
  }
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabStatus>("pending");
  const [dateFilter, setDateFilter] = useState<string>(todayISO());
  const [error, setError] = useState<string | null>(null);
  const prevOrderCountRef = useRef<number | null>(null);

  useEffect(() => {
    setLoading(true);
    prevOrderCountRef.current = null;

    const start = new Date(`${dateFilter}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const q = query(
      collection(db, "orders"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<", Timestamp.fromDate(end)),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const newOrders = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Order, "id">),
        }));

        // 新規注文を検知して音を鳴らす
        if (prevOrderCountRef.current !== null && newOrders.length > prevOrderCountRef.current) {
          playNotificationSound();
        }
        prevOrderCountRef.current = newOrders.length;

        setOrders(newOrders);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [dateFilter]);

  const filtered = useMemo(
    () => orders.filter((o) => o.status === tab),
    [orders, tab]
  );

  const counts = useMemo(() => {
    const c: Record<TabStatus, number> = {
      pending: 0,
      preparing: 0,
      completed: 0,
    };
    for (const o of orders) {
      if (o.status === "pending") c.pending++;
      else if (o.status === "preparing") c.preparing++;
      else if (o.status === "completed") c.completed++;
    }
    return c;
  }, [orders]);

  async function updateStatus(id: string, status: OrderStatus) {
    setError(null);
    try {
      await updateDoc(doc(db, "orders", id), {
        status,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました。");
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">注文管理</h1>
        <label className="text-sm">
          日付：
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="ml-2 rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
      </div>

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-4 py-2 text-sm ${
              tab === t.key
                ? "border-gray-800 font-semibold text-gray-900"
                : "border-transparent text-gray-500"
            }`}
          >
            {t.label}
            <span className="ml-2 text-xs text-gray-500">({counts[t.key]})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">読み込み中...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">該当する注文はありません。</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((o) => (
            <OrderCard key={o.id} order={o} onUpdateStatus={updateStatus} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderCard({
  order,
  onUpdateStatus,
}: {
  order: Order;
  onUpdateStatus: (id: string, status: OrderStatus) => void;
}) {
  const total = order.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const created = order.createdAt?.toDate?.();

  return (
    <li className="rounded border border-gray-200 p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">テーブル {order.tableNumber}</p>
          <p className="text-xs text-gray-500">
            {created ? created.toLocaleString("ja-JP") : ""}
          </p>
        </div>
        <p className="text-lg font-bold">¥{total.toLocaleString()}</p>
      </div>

      <ul className="mb-3 space-y-1 text-sm">
        {order.items.map((item, idx) => (
          <li key={`${item.menuId}-${idx}`} className="flex justify-between">
            <span>
              {item.name} × {item.quantity}
            </span>
            <span className="text-gray-600">
              ¥{(item.price * item.quantity).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>

      {order.customerNote && (
        <p className="mb-3 rounded bg-yellow-50 p-2 text-xs text-yellow-900">
          備考：{order.customerNote}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {order.status === "pending" && (
          <>
            <button
              onClick={() => onUpdateStatus(order.id, "preparing")}
              className="rounded bg-blue-600 px-3 py-1 text-xs text-white"
            >
              調理開始
            </button>
            <button
              onClick={() => {
                if (confirm("この注文をキャンセルしますか？")) {
                  onUpdateStatus(order.id, "cancelled");
                }
              }}
              className="rounded border border-red-600 px-3 py-1 text-xs text-red-600"
            >
              キャンセル
            </button>
          </>
        )}
        {order.status === "preparing" && (
          <button
            onClick={() => onUpdateStatus(order.id, "completed")}
            className="rounded bg-green-600 px-3 py-1 text-xs text-white"
          >
            提供完了
          </button>
        )}
        {order.status === "completed" && (
          <span className="text-xs text-gray-500">完了済み</span>
        )}
      </div>
    </li>
  );
}
