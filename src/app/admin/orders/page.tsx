"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageLoader } from "@/components/ui/PageLoader";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order } from "@/types";

// ---------- helpers ----------

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateLabel(ts: Timestamp | undefined): string {
  if (!ts) return "不明";
  const d = ts.toDate();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diff < 1) return "たった今";
  if (diff < 60) return `${diff}分前`;
  return `${Math.floor(diff / 60)}時間${diff % 60}分前`;
}

function timeStr(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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
  } catch {
    /* Audio not supported */
  }
}

// ---------- page ----------

export default function AdminOrdersPage() {
  const [view, setView] = useState<"orders" | "history">("orders");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col">
      {/* タブ切替 */}
      <div className="mb-4 flex items-center gap-4">
        <h1 className="text-2xl font-bold text-[color:var(--color-text-primary)]">注文管理</h1>
        <div className="flex rounded-lg border border-[color:var(--color-border)] overflow-hidden">
          <button
            type="button"
            onClick={() => setView("orders")}
            className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
              view === "orders"
                ? "bg-[color:var(--color-accent-char)] text-white"
                : "bg-[color:var(--color-bg-card)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
            }`}
          >
            新規注文
          </button>
          <button
            type="button"
            onClick={() => setView("history")}
            className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
              view === "history"
                ? "bg-[color:var(--color-accent-char)] text-white"
                : "bg-[color:var(--color-bg-card)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
            }`}
          >
            履歴
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 text-sm text-[color:var(--color-accent-warn)]">
          {error}
        </p>
      )}

      {view === "orders" ? (
        <NewOrdersView onError={setError} />
      ) : (
        <HistoryView onError={setError} />
      )}
    </div>
  );
}

// ========== 新規注文ビュー ==========

function NewOrdersView({ onError }: { onError: (msg: string | null) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<string>(todayISO());
  const [now, setNow] = useState(() => Date.now());
  const prevOrderCountRef = useRef<number | null>(null);

  // 経過時刻更新 + 日付自動ロールオーバー (30秒おき)
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
      const today = todayISO();
      setDateFilter((prev) => (prev !== today ? today : prev));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

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
        const all = snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Omit<Order, "id">) })
        );
        // 新規注文ビューには pending / preparing のみ表示
        const active = all.filter(
          (o) => o.status === "pending" || o.status === "preparing"
        );

        if (
          prevOrderCountRef.current !== null &&
          all.length > prevOrderCountRef.current
        ) {
          playNotificationSound();
        }
        prevOrderCountRef.current = all.length;
        setOrders(active);
        setLoading(false);
      },
      (e) => {
        onError(e.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [dateFilter, onError]);

  const toggleCheck = useCallback(
    async (order: Order, itemIdx: number) => {
      onError(null);
      const prev = order.checkedItems ?? [];
      const next = prev.includes(itemIdx)
        ? prev.filter((i) => i !== itemIdx)
        : [...prev, itemIdx];

      const allChecked = next.length >= order.items.length;

      // optimistic
      setOrders((os) =>
        allChecked
          ? os.filter((o) => o.id !== order.id)
          : os.map((o) =>
              o.id === order.id ? { ...o, checkedItems: next } : o
            )
      );

      try {
        if (allChecked) {
          await updateDoc(doc(db, "orders", order.id), {
            checkedItems: next,
            status: "completed",
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(doc(db, "orders", order.id), {
            checkedItems: next,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (e) {
        // rollback
        setOrders((os) =>
          os.find((o) => o.id === order.id)
            ? os.map((o) =>
                o.id === order.id
                  ? { ...o, checkedItems: prev, status: order.status }
                  : o
              )
            : [...os, { ...order, checkedItems: prev }]
        );
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  const deleteOrder = useCallback(
    async (id: string) => {
      onError(null);
      try {
        await deleteDoc(doc(db, "orders", id));
      } catch (e) {
        onError(e instanceof Error ? e.message : "削除に失敗しました。");
      }
    },
    [onError]
  );

  if (loading) return <PageLoader />;

  if (orders.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[color:var(--color-text-muted)]">新規注文はありません</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <p className="mb-3 text-xs text-[color:var(--color-text-muted)]">
        未完了: {orders.length}件
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {orders.map((order) => (
          <ActiveOrderCard
            key={order.id}
            order={order}
            now={now}
            onToggle={toggleCheck}
            onDelete={deleteOrder}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- 新規注文カード ----------

function ActiveOrderCard({
  order,
  now,
  onToggle,
  onDelete,
}: {
  order: Order;
  now: number;
  onToggle: (order: Order, idx: number) => void;
  onDelete: (id: string) => void;
}) {
  const [showCancel, setShowCancel] = useState(false);
  const total = order.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const created = order.createdAt?.toDate?.();
  const elapsed = created ? timeAgo(created) : "";
  const checked = new Set(order.checkedItems ?? []);
  const progress = `${checked.size}/${order.items.length}`;

  const isUrgent =
    order.status === "pending" &&
    created &&
    now - created.getTime() > 5 * 60 * 1000;

  return (
    <div
      className={`rounded-xl p-4 transition-colors ${
        isUrgent
          ? "bg-[color:var(--color-accent-warn)]/10 border-2 border-[color:var(--color-accent-warn)]"
          : "bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] shadow-sm"
      }`}
    >
      {/* テーブル番号 + 経過 + 進捗 */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="inline-flex items-center justify-center min-w-[56px] h-12 px-3 rounded-lg bg-[color:var(--color-accent-char)] text-white text-2xl font-black leading-none">
          T{order.tableNumber}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[color:var(--color-text-muted)]">{progress}</span>
          <span
            className={`inline-flex items-center rounded-lg text-lg font-bold leading-none ${
              isUrgent
                ? "px-3 py-2 bg-[color:var(--color-accent-warn)] text-white"
                : "px-2 py-1 text-[color:var(--color-text-primary)]"
            }`}
          >
            {elapsed}
          </span>
        </div>
      </div>

      {/* 備考 */}
      {order.customerNote && (
        <div className="mb-3 rounded-lg border-l-4 border-[color:var(--color-accent-warn)] bg-[color:var(--color-accent-warn)]/10 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--color-accent-warn)]">
            備考
          </p>
          <p className="text-base leading-snug text-[color:var(--color-text-primary)]">
            {order.customerNote}
          </p>
        </div>
      )}

      {/* 商品チェックリスト */}
      <ul className="mb-3 space-y-1">
        {order.items.map((item, idx) => {
          const done = checked.has(idx);
          return (
            <li key={`${item.menuId}-${idx}`}>
              <button
                type="button"
                onClick={() => onToggle(order, idx)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  done
                    ? "bg-[color:var(--color-accent-negi)]/10"
                    : "bg-[color:var(--color-bg-subtle)] hover:bg-[color:var(--color-bg-subtle)]/80"
                }`}
              >
                {/* チェックボックス */}
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                    done
                      ? "border-[color:var(--color-accent-negi)] bg-[color:var(--color-accent-negi)]"
                      : "border-[color:var(--color-border-strong)]"
                  }`}
                >
                  {done && (
                    <svg
                      className="h-4 w-4 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </span>
                <span
                  className={`flex-1 text-lg leading-tight ${
                    done
                      ? "line-through text-[color:var(--color-text-muted)]"
                      : "text-[color:var(--color-text-primary)]"
                  }`}
                >
                  {item.name}
                </span>
                <span
                  className={`whitespace-nowrap text-xl font-bold ${
                    done
                      ? "text-[color:var(--color-text-muted)]"
                      : "text-[color:var(--color-accent-char)]"
                  }`}
                >
                  ×{item.quantity}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* 取消 + 合計 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowCancel(true)}
          className="rounded-lg border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
        >
          取消
        </button>
        <p className="text-[11px] text-[color:var(--color-text-muted)]">
          ¥{total.toLocaleString()}
        </p>
      </div>

      <ConfirmDialog
        open={showCancel}
        title={`テーブル ${order.tableNumber} の注文を削除`}
        message={`${order.items.map((i) => i.name).join("、")}（¥${total.toLocaleString()}）を削除しますか？この操作は取り消せません。`}
        confirmLabel="削除する"
        confirmColor="red"
        onConfirm={() => {
          onDelete(order.id);
          setShowCancel(false);
        }}
        onCancel={() => setShowCancel(false)}
      />
    </div>
  );
}

// ========== 履歴ビュー ==========

function HistoryView({ onError }: { onError: (msg: string | null) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // completed + paid を新しい順に購読
    const q = query(
      collection(db, "orders"),
      where("status", "in", ["completed", "paid"]),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setOrders(
          snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as Omit<Order, "id">) })
          )
        );
        setLoading(false);
      },
      (e) => {
        onError(e.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [onError]);

  // 日付ごとにグループ化
  const grouped = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of orders) {
      const key = dateLabel(o.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(o);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [orders]);

  if (loading) return <PageLoader />;

  if (orders.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[color:var(--color-text-muted)]">履歴はまだありません</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-6">
      {grouped.map(([date, dayOrders]) => {
        const dayTotal = dayOrders.reduce(
          (sum, o) =>
            sum + o.items.reduce((s, i) => s + i.price * i.quantity, 0),
          0
        );
        return (
          <section key={date}>
            <div className="sticky top-0 z-10 flex items-baseline justify-between bg-[color:var(--color-bg-base)] pb-2 pt-1">
              <h2 className="text-base font-bold text-[color:var(--color-text-primary)]">
                {date}
              </h2>
              <span className="text-xs text-[color:var(--color-text-muted)]">
                {dayOrders.length}件 / ¥{dayTotal.toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {dayOrders.map((order) => (
                <HistoryOrderCard key={order.id} order={order} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------- 履歴カード ----------

function HistoryOrderCard({ order }: { order: Order }) {
  const total = order.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const created = order.createdAt?.toDate?.();

  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center min-w-[40px] h-8 px-2 rounded-md bg-[color:var(--color-accent-soy)] text-white text-sm font-bold leading-none">
            T{order.tableNumber}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              order.status === "paid"
                ? "bg-[color:var(--color-accent-negi)]/15 text-[color:var(--color-accent-negi)]"
                : "bg-[color:var(--color-bg-subtle)] text-[color:var(--color-text-muted)]"
            }`}
          >
            {order.status === "paid" ? "精算済" : "提供済"}
          </span>
        </div>
        <div className="text-right">
          <p className="text-xs text-[color:var(--color-text-muted)]">
            {created ? timeStr(created) : ""}
          </p>
          <p className="text-sm font-bold text-[color:var(--color-text-primary)] tabular-nums">
            ¥{total.toLocaleString()}
          </p>
        </div>
      </div>
      <ul className="text-sm text-[color:var(--color-text-primary)] space-y-0.5">
        {order.items.map((item, i) => (
          <li key={i} className="flex justify-between">
            <span>{item.name}</span>
            <span className="text-[color:var(--color-text-muted)]">×{item.quantity}</span>
          </li>
        ))}
      </ul>
      {order.customerNote && (
        <p className="mt-2 text-xs text-[color:var(--color-text-muted)] border-t border-[color:var(--color-border)] pt-2">
          備考: {order.customerNote}
        </p>
      )}
    </div>
  );
}
