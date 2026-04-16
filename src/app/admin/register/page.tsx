"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { PageLoader } from "@/components/ui/PageLoader";
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

const GOAL_STORAGE_KEY = "gonmura-sales-goal";
const DEFAULT_GOAL = 100000;

function DonutChart({ percent }: { percent: number }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;
  const achieved = percent >= 100;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <g transform="rotate(-90 70 70)">
        <circle cx="70" cy="70" r={radius} stroke="#e2e8f0" strokeWidth="14" fill="none" />
        <circle
          cx="70"
          cy="70"
          r={radius}
          stroke={achieved ? "#22c55e" : "#3b82f6"}
          strokeWidth="14"
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </g>
      <text
        x="70"
        y="70"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#1a2332"
        fontSize="22"
        fontWeight="700"
      >
        {Math.round(percent)}%
      </text>
    </svg>
  );
}

export default function AdminRegisterPage() {
  const [unpaidOrders, setUnpaidOrders] = useState<Order[]>([]);
  const [paidOrders, setPaidOrders] = useState<Order[]>([]);
  const [todayPaidOrders, setTodayPaidOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [todayPaidLoaded, setTodayPaidLoaded] = useState(false);
  const [processing, setProcessing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("unpaid");
  const [dateFilter, setDateFilter] = useState<string>(todayISO());
  const [payTarget, setPayTarget] = useState<TableBill | null>(null);
  const [goal, setGoal] = useState<number>(DEFAULT_GOAL);
  const [goalInput, setGoalInput] = useState<string>("");
  const [editingGoal, setEditingGoal] = useState<boolean>(false);

  // 目標金額の読み込み
  useEffect(() => {
    const stored = localStorage.getItem(GOAL_STORAGE_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (!isNaN(n) && n > 0) setGoal(n);
    }
  }, []);

  // 本日の精算済み（リアルタイム・常時監視）
  useEffect(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const q = query(
      collection(db, "orders"),
      where("status", "==", "paid"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<", Timestamp.fromDate(end)),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setTodayPaidOrders(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order)
        );
        setTodayPaidLoaded(true);
      },
      (err) => {
        console.error("本日の売上取得エラー:", err);
        setTodayPaidLoaded(true); // エラー時もローダーは解除
      }
    );

    return unsub;
  }, []);

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

  const todaySales = useMemo(
    () =>
      todayPaidOrders.reduce(
        (sum, o) => sum + o.items.reduce((s, i) => s + i.price * i.quantity, 0),
        0
      ),
    [todayPaidOrders]
  );
  const achievementPercent = goal > 0 ? (todaySales / goal) * 100 : 0;
  const remaining = Math.max(goal - todaySales, 0);

  const saveGoal = useCallback(() => {
    const n = parseInt(goalInput, 10);
    if (isNaN(n) || n <= 0) {
      setEditingGoal(false);
      return;
    }
    setGoal(n);
    localStorage.setItem(GOAL_STORAGE_KEY, String(n));
    setEditingGoal(false);
  }, [goalInput]);

  const confirmPay = useCallback(async () => {
    if (!payTarget || processing !== null) return;
    setProcessing(payTarget.tableNumber);
    setError(null);

    try {
      for (const order of payTarget.orders) {
        await updateDoc(doc(db, "orders", order.id), {
          status: "paid",
          updatedAt: serverTimestamp(),
        });
      }
      setPayTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "精算に失敗しました。");
    } finally {
      setProcessing(null);
    }
  }, [payTarget, processing]);

  const currentTables = tab === "unpaid" ? unpaidTables : paidTables;

  // 本日売上カード・未精算ともに初回データ未着ならページ全体をローダーに（チラつき防止）
  if (loading || !todayPaidLoaded) {
    return <PageLoader />;
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-[color:var(--color-text-primary)]">レジ</h1>
        {tab === "paid" && (
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
          />
        )}
      </div>

      {/* 本日の売上カード */}
      <div className="mb-5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">本日の売上</h2>
          <span className="text-xs text-[color:var(--color-text-muted)]">
            {todayPaidOrders.length}件 精算済み
          </span>
        </div>
        <div className="flex items-center gap-5">
          <DonutChart percent={achievementPercent} />
          <div className="flex-1 space-y-2">
            <div>
              <p className="text-xs text-[color:var(--color-text-muted)]">売上</p>
              <p className="text-2xl font-bold text-[color:var(--color-accent-char)]">
                ¥{todaySales.toLocaleString()}
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <p className="text-xs text-[color:var(--color-text-muted)]">目標</p>
                {!editingGoal && (
                  <button
                    onClick={() => {
                      setGoalInput(String(goal));
                      setEditingGoal(true);
                    }}
                    className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-char)] underline"
                  >
                    変更
                  </button>
                )}
              </div>
              {editingGoal ? (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                    className="w-28 bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded px-2 py-1 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
                    min={1}
                    autoFocus
                  />
                  <button
                    onClick={saveGoal}
                    className="text-xs bg-[color:var(--color-accent-char)] hover:bg-[color:var(--color-accent-char-hover)] text-white px-2 py-1 rounded"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditingGoal(false)}
                    className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <p className="text-lg font-semibold text-[color:var(--color-text-primary)]">
                  ¥{goal.toLocaleString()}
                </p>
              )}
            </div>
            <p className="text-xs text-[color:var(--color-text-muted)]">
              {achievementPercent >= 100
                ? "🎉 目標達成！"
                : `あと ¥${remaining.toLocaleString()}`}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 text-sm text-[color:var(--color-accent-warn)]">{error}</p>
      )}

      <div className="mb-4 flex gap-1 border-b border-[color:var(--color-border)]">
        <button
          onClick={() => setTab("unpaid")}
          className={`border-b-2 px-4 py-2 text-sm ${
            tab === "unpaid"
              ? "border-[color:var(--color-accent-char)] font-semibold text-[color:var(--color-accent-char)]"
              : "border-transparent text-[color:var(--color-text-muted)]"
          }`}
        >
          未精算
          <span className="ml-2 text-xs">({unpaidTables.length})</span>
        </button>
        <button
          onClick={() => setTab("paid")}
          className={`border-b-2 px-4 py-2 text-sm ${
            tab === "paid"
              ? "border-[color:var(--color-accent-char)] font-semibold text-[color:var(--color-accent-char)]"
              : "border-transparent text-[color:var(--color-text-muted)]"
          }`}
        >
          精算済み
          <span className="ml-2 text-xs">({paidTables.length})</span>
        </button>
      </div>

      {currentTables.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)] text-center py-12">
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
                className={`rounded-xl border p-4 ${
                  tab === "paid"
                    ? "border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)]"
                    : "border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] shadow-sm"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">テーブル {table.tableNumber}</h2>
                    <p className="text-xs text-[color:var(--color-text-muted)]">{table.orders.length}件の注文</p>
                  </div>
                  <p className="text-xl font-bold text-[color:var(--color-accent-char)]">¥{table.totalAmount.toLocaleString()}</p>
                </div>

                <ul className="mb-3 space-y-1 text-sm border-t border-[color:var(--color-border)] pt-3">
                  {allItems.map((item, i) => (
                    <li key={i} className="flex justify-between">
                      <span className="text-[color:var(--color-text-primary)]">{item.name} x {item.quantity}</span>
                      <span className="text-[color:var(--color-text-muted)]">
                        ¥{(item.price * item.quantity).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="text-xs text-[color:var(--color-text-muted)] mb-3 border-t border-[color:var(--color-border)] pt-2 space-y-1">
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
                    onClick={() => setPayTarget(table)}
                    disabled={processing !== null}
                    className="w-full rounded-xl bg-[color:var(--color-accent-negi)] px-4 py-2.5 text-sm text-white font-bold hover:opacity-90 disabled:opacity-50 transition-colors"
                  >
                    {processing === table.tableNumber ? "処理中..." : "精算完了"}
                  </button>
                )}

                {tab === "paid" && (
                  <p className="text-center text-xs text-[color:var(--color-accent-negi)] font-medium">精算済み</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={payTarget !== null}
        title={`テーブル ${payTarget?.tableNumber} の精算`}
        message={`合計 ¥${payTarget?.totalAmount.toLocaleString()} の精算を完了しますか？`}
        confirmLabel="精算完了"
        confirmColor="green"
        onConfirm={confirmPay}
        onCancel={() => setPayTarget(null)}
        loading={processing !== null}
      />
    </div>
  );
}
