"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageLoader } from "@/components/ui/PageLoader";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
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

type ColumnStatus = Exclude<OrderStatus, "cancelled" | "paid">;

const COLUMNS: { key: ColumnStatus; label: string; accent: string; badge: string }[] = [
  { key: "pending", label: "新規注文", accent: "border-t-orange-500", badge: "bg-orange-500" },
  { key: "preparing", label: "調理中", accent: "border-t-blue-500", badge: "bg-blue-500" },
  { key: "completed", label: "提供済み", accent: "border-t-green-500", badge: "bg-green-500" },
];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diff < 1) return "たった今";
  if (diff < 60) return `${diff}分前`;
  return `${Math.floor(diff / 60)}時間${diff % 60}分前`;
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
  } catch { /* Audio not supported */ }
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<string>(todayISO());
  const [autoFollowToday, setAutoFollowToday] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const prevOrderCountRef = useRef<number | null>(null);

  // 経過時刻更新 + 日付自動更新 (30秒おき)
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
      if (autoFollowToday) {
        const today = todayISO();
        setDateFilter((prev) => (prev !== today ? today : prev));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [autoFollowToday]);

  useEffect(() => {
    prevOrderCountRef.current = null;

    const start = new Date(`${dateFilter}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const q = query(
      collection(db, "orders"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<", Timestamp.fromDate(end)),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const newOrders = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Order, "id">),
        }));

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

  const grouped = useMemo(() => {
    const g: Record<ColumnStatus, Order[]> = { pending: [], preparing: [], completed: [] };
    for (const o of orders) {
      if (o.status in g) g[o.status as ColumnStatus].push(o);
    }
    return g;
  }, [orders]);

  const todayTotal = useMemo(() => {
    return orders
      .filter((o) => o.status !== "cancelled")
      .reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.price * i.quantity, 0), 0);
  }, [orders]);

  async function updateStatus(id: string, status: OrderStatus) {
    setError(null);
    try {
      await updateDoc(doc(db, "orders", id), { status, updatedAt: serverTimestamp() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました。");
    }
  }

  return (
    <div className="h-full">
      {/* ヘッダー */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">注文管理</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            本日の注文: {orders.length}件 / 売上: ¥{todayTotal.toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value);
              setAutoFollowToday(e.target.value === todayISO());
            }}
            className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {!autoFollowToday && (
            <button
              onClick={() => {
                setDateFilter(todayISO());
                setAutoFollowToday(true);
              }}
              className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs text-white font-bold hover:bg-orange-600 transition-colors"
            >
              今日に戻る
            </button>
          )}
          {autoFollowToday && (
            <span className="text-[10px] text-neutral-500" title="日付が変わると自動で今日に切り替わります">
              ● 自動更新中
            </span>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">{error}</p>
      )}

      {loading ? (
        <PageLoader />
      ) : (
        <div className="grid grid-cols-3 gap-4" style={{ height: "calc(100vh - 160px)" }}>
          {COLUMNS.map((col) => (
            <div key={col.key} className="flex flex-col min-h-0">
              {/* カラムヘッダー */}
              <div className={`rounded-t-xl bg-neutral-800 border-t-4 ${col.accent} px-4 py-3 flex items-center justify-between`}>
                <span className="text-sm font-bold text-white">{col.label}</span>
                <span className={`${col.badge} text-white text-xs font-bold px-2.5 py-1 rounded-full min-w-[28px] text-center`}>
                  {grouped[col.key].length}
                </span>
              </div>
              {/* カラムコンテンツ */}
              <div className="flex-1 bg-neutral-800/30 rounded-b-xl border border-neutral-800 border-t-0 p-2 space-y-2 overflow-y-auto">
                {grouped[col.key].length === 0 ? (
                  <p className="text-xs text-neutral-600 text-center py-12">注文なし</p>
                ) : (
                  grouped[col.key].map((order) => (
                    <OrderCard key={order.id} order={order} now={now} onUpdateStatus={updateStatus} />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  now,
  onUpdateStatus,
}: {
  order: Order;
  now: number;
  onUpdateStatus: (id: string, status: OrderStatus) => void;
}) {
  const [showCancel, setShowCancel] = useState(false);
  const total = order.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const created = order.createdAt?.toDate?.();
  const elapsed = created ? timeAgo(created) : "";

  // 5分以上未対応は赤くハイライト
  const isUrgent = order.status === "pending" && created && (now - created.getTime()) > 5 * 60 * 1000;

  return (
    <div className={`rounded-xl p-3 transition-colors ${
      isUrgent
        ? "bg-red-500/10 border border-red-500/30"
        : "bg-neutral-900 border border-neutral-800"
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-base font-bold text-white">T{order.tableNumber}</span>
          <p className={`text-[11px] mt-0.5 ${isUrgent ? "text-red-400 font-medium" : "text-neutral-500"}`}>
            {elapsed}
          </p>
        </div>
        <span className="text-sm font-bold text-white">¥{total.toLocaleString()}</span>
      </div>

      <ul className="text-xs space-y-0.5 mb-2">
        {order.items.map((item, idx) => (
          <li key={`${item.menuId}-${idx}`} className="flex justify-between text-neutral-400">
            <span>{item.name} x{item.quantity}</span>
          </li>
        ))}
      </ul>

      {order.customerNote && (
        <p className="mb-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-2 py-1.5 text-[11px] text-yellow-400">
          {order.customerNote}
        </p>
      )}

      <div className="flex gap-1.5">
        {order.status === "pending" && (
          <>
            <button
              onClick={() => onUpdateStatus(order.id, "preparing")}
              className="flex-1 rounded-lg bg-blue-600 px-2 py-2 text-xs text-white font-bold hover:bg-blue-700 transition-colors"
            >
              調理開始
            </button>
            <button
              onClick={() => setShowCancel(true)}
              className="rounded-lg border border-neutral-700 px-2 py-2 text-xs text-neutral-400 hover:bg-neutral-800 transition-colors"
            >
              取消
            </button>
          </>
        )}
        {order.status === "preparing" && (
          <>
            <button
              onClick={() => onUpdateStatus(order.id, "completed")}
              className="flex-1 rounded-lg bg-green-600 px-2 py-2 text-xs text-white font-bold hover:bg-green-700 transition-colors"
            >
              提供完了
            </button>
            <button
              onClick={() => onUpdateStatus(order.id, "pending")}
              className="rounded-lg border border-neutral-700 px-2 py-2 text-xs text-neutral-400 hover:bg-neutral-800 transition-colors"
              title="新規注文に戻す"
            >
              ← 戻す
            </button>
          </>
        )}
        {order.status === "completed" && (
          <button
            onClick={() => onUpdateStatus(order.id, "preparing")}
            className="flex-1 rounded-lg border border-neutral-700 px-2 py-2 text-xs text-neutral-300 hover:bg-neutral-800 transition-colors"
            title="調理中に戻す"
          >
            ← 調理中に戻す
          </button>
        )}
      </div>

      <ConfirmDialog
        open={showCancel}
        title={`テーブル ${order.tableNumber} の注文をキャンセル`}
        message={`${order.items.map((i) => i.name).join("、")}（¥${total.toLocaleString()}）をキャンセルしますか？`}
        confirmLabel="キャンセルする"
        confirmColor="red"
        onConfirm={() => {
          onUpdateStatus(order.id, "cancelled");
          setShowCancel(false);
        }}
        onCancel={() => setShowCancel(false)}
      />
    </div>
  );
}
