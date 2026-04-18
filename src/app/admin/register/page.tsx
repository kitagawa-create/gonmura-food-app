"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { PageLoader } from "@/components/ui/PageLoader";
import { useToast } from "@/components/ui/Snackbar";
import type { Customer, Order, OrderItem } from "@/types";
import { comboLineTotal, flattenForReceipt } from "@/lib/order-utils";

type OrderWithItems = Order & { items: OrderItem[] };

type Tab = "tables" | "paid";
type TableBill = {
  customerId: string;
  tableNumber: number;
  orders: OrderWithItems[];
  totalAmount: number;
  firstOrderAt: Date | null;
};

const DEFAULT_GOAL = 100_000;
const GOAL_KEY = "gonmura-sales-goal";
const TABLE_NAMES_KEY = "gonmura-table-names";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadTableNames(): Map<number, string> {
  try {
    const raw = localStorage.getItem(TABLE_NAMES_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj).map(([k, v]) => [parseInt(k, 10), v]));
  } catch { return new Map(); }
}

function persistTableName(num: number, name: string) {
  try {
    const raw = localStorage.getItem(TABLE_NAMES_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (name.trim()) obj[String(num)] = name.trim();
    else delete obj[String(num)];
    localStorage.setItem(TABLE_NAMES_KEY, JSON.stringify(obj));
  } catch {}
}

function groupByCustomer(orders: OrderWithItems[], customerMap: Map<string, Customer>): TableBill[] {
  const map = new Map<string, OrderWithItems[]>();
  for (const o of orders) {
    map.set(o.customerId, [...(map.get(o.customerId) ?? []), o]);
  }
  return Array.from(map.entries())
    .map(([customerId, tableOrders]) => ({
      customerId,
      tableNumber: customerMap.get(customerId)?.tableNumber ?? 0,
      orders: tableOrders,
      totalAmount: tableOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + comboLineTotal(i), 0), 0),
      firstOrderAt: tableOrders.reduce<Date | null>((earliest, o) => {
        const d = o.createdAt?.toDate?.();
        if (!d) return earliest;
        return !earliest || d < earliest ? d : earliest;
      }, null),
    }))
    .sort((a, b) => a.tableNumber - b.tableNumber);
}

function mergeItems(orders: OrderWithItems[]) {
  const result: { name: string; price: number; quantity: number }[] = [];
  for (const o of orders) {
    for (const flat of flattenForReceipt(o.items)) {
      const ex = result.find((r) => r.name === flat.name && r.price === flat.price);
      if (ex) ex.quantity += flat.quantity;
      else result.push({ ...flat });
    }
  }
  return result;
}

function DonutChart({ percent }: { percent: number }) {
  const c = Math.min(Math.max(percent, 0), 100);
  const r = 54;
  const circ = 2 * Math.PI * r;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <g transform="rotate(-90 70 70)">
        <circle cx="70" cy="70" r={r} stroke="#e2e8f0" strokeWidth="14" fill="none" />
        <circle
          cx="70" cy="70" r={r}
          stroke={c >= 100 ? "#22c55e" : "#3b82f6"}
          strokeWidth="14" fill="none"
          strokeDasharray={`${(c / 100) * circ} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </g>
      <text x="70" y="70" textAnchor="middle" dominantBaseline="central" fill="#1a2332" fontSize="22" fontWeight="700">
        {Math.round(c)}%
      </text>
    </svg>
  );
}

export default function AdminRegisterPage() {
  const { show: toast } = useToast();

  const [tableNames, setTableNames] = useState<Map<number, string>>(new Map());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [unpaidOrders, setUnpaidOrders] = useState<OrderWithItems[]>([]);
  const [paidOrders, setPaidOrders] = useState<OrderWithItems[]>([]);
  const [todayPaidOrders, setTodayPaidOrders] = useState<OrderWithItems[]>([]);

  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [todayLoaded, setTodayLoaded] = useState(false);

  const [tab, setTab] = useState<Tab>("tables");
  const [dateFilter, setDateFilter] = useState(todayISO());

  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [goalInput, setGoalInput] = useState("");
  const [editingGoal, setEditingGoal] = useState(false);

  const [editingTable, setEditingTable] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const [payTarget, setPayTarget] = useState<TableBill | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    setTableNames(loadTableNames());
    const s = localStorage.getItem(GOAL_KEY);
    if (s) { const n = parseInt(s, 10); if (!isNaN(n) && n > 0) setGoal(n); }
  }, []);

  useEffect(() => {
    return onSnapshot(
      collection(db, "customers"),
      (snap) => setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Customer))
    );
  }, []);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "orders"), where("status", "in", ["pending", "completed"])),
      (snap) => {
        const orderDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order);
        Promise.all(
          orderDocs.map(async (order) => {
            const itemsSnap = await getDocs(collection(db, "orders", order.id, "items"));
            const items: OrderItem[] = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderItem, "id">) }));
            return { ...order, items };
          })
        ).then((data) => { setUnpaidOrders(data); setOrdersLoaded(true); })
         .catch(() => { setUnpaidOrders([]); setOrdersLoaded(true); });
      }
    );
  }, []);

  useEffect(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    return onSnapshot(
      query(collection(db, "orders"),
        where("status", "==", "paid"),
        where("createdAt", ">=", Timestamp.fromDate(start)),
        where("createdAt", "<", Timestamp.fromDate(end)),
        orderBy("createdAt", "desc")),
      (snap) => {
        const orderDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order);
        Promise.all(
          orderDocs.map(async (order) => {
            const itemsSnap = await getDocs(collection(db, "orders", order.id, "items"));
            const items: OrderItem[] = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderItem, "id">) }));
            return { ...order, items };
          })
        ).then((data) => { setTodayPaidOrders(data); setTodayLoaded(true); });
      },
      () => setTodayLoaded(true)
    );
  }, []);

  useEffect(() => {
    const start = new Date(`${dateFilter}T00:00:00`);
    const end = new Date(start.getTime() + 86_400_000);
    return onSnapshot(
      query(collection(db, "orders"),
        where("status", "==", "paid"),
        where("createdAt", ">=", Timestamp.fromDate(start)),
        where("createdAt", "<", Timestamp.fromDate(end)),
        orderBy("createdAt", "desc")),
      (snap) => {
        const orderDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order);
        Promise.all(
          orderDocs.map(async (order) => {
            const itemsSnap = await getDocs(collection(db, "orders", order.id, "items"));
            const items: OrderItem[] = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderItem, "id">) }));
            return { ...order, items };
          })
        ).then(setPaidOrders);
      }
    );
  }, [dateFilter]);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const unpaidBills = useMemo(() => groupByCustomer(unpaidOrders, customerById), [unpaidOrders, customerById]);
  const paidBills = useMemo(() => groupByCustomer(paidOrders, customerById), [paidOrders, customerById]);

  const todaySales = useMemo(
    () => todayPaidOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + comboLineTotal(i), 0), 0),
    [todayPaidOrders]
  );
  const achievePercent = goal > 0 ? (todaySales / goal) * 100 : 0;
  const remaining = Math.max(goal - todaySales, 0);

  function saveGoal() {
    const n = parseInt(goalInput, 10);
    if (!isNaN(n) && n > 0) { setGoal(n); localStorage.setItem(GOAL_KEY, String(n)); }
    setEditingGoal(false);
  }

  function saveName(num: number) {
    persistTableName(num, editingName);
    setTableNames(loadTableNames());
    setEditingTable(null);
    toast("保存しました");
  }

  const confirmPay = useCallback(async () => {
    if (!payTarget || processing !== null) return;
    setProcessing(payTarget.tableNumber);
    setPayError(null);
    try {
      const batch = writeBatch(db);
      for (const o of payTarget.orders) {
        batch.update(doc(db, "orders", o.id), { status: "paid", updatedAt: serverTimestamp() });
      }
      await batch.commit();
      setPayTarget(null);
    } catch (e) { setPayError(e instanceof Error ? e.message : "精算に失敗しました"); }
    finally { setProcessing(null); }
  }, [payTarget, processing]);

  if (!ordersLoaded || !todayLoaded) return <PageLoader />;

  return (
    <div className="w-full">
      <AdminPageHeader
        title="レジ"
        rightSlot={
          tab === "paid" ? (
            <input
              type="date" value={dateFilter}
              onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDateFilter(e.target.value); }}
              max={todayISO()}
              onKeyDown={(e) => e.preventDefault()}
              className="bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            />
          ) : undefined
        }
      />

      {/* 本日売上カード */}
      <div className="mb-5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">本日の売上</h2>
          <span className="text-xs text-[color:var(--color-text-muted)]">{todayPaidOrders.length}件 精算済み</span>
        </div>
        <div className="flex items-center gap-5">
          <DonutChart percent={achievePercent} />
          <div className="flex-1 space-y-2">
            <div>
              <p className="text-xs text-[color:var(--color-text-muted)]">売上</p>
              <p className="text-2xl font-bold text-[color:var(--color-accent-char)]">¥{todaySales.toLocaleString()}</p>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <p className="text-xs text-[color:var(--color-text-muted)]">目標</p>
                {!editingGoal && (
                  <button onClick={() => { setGoalInput(String(goal)); setEditingGoal(true); }}
                    className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-char)] underline">
                    変更
                  </button>
                )}
              </div>
              {editingGoal ? (
                <div className="flex items-center gap-2 mt-1">
                  <input type="number" value={goalInput} onChange={(e) => setGoalInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveGoal()}
                    className="w-28 bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded px-2 py-1 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
                    min={1} autoFocus />
                  <button onClick={saveGoal} className="text-xs bg-[color:var(--color-accent-char)] text-white px-2 py-1 rounded">保存</button>
                  <button onClick={() => setEditingGoal(false)} className="text-xs text-[color:var(--color-text-muted)]">キャンセル</button>
                </div>
              ) : (
                <p className="text-lg font-semibold text-[color:var(--color-text-primary)]">¥{goal.toLocaleString()}</p>
              )}
            </div>
            <p className="text-xs text-[color:var(--color-text-muted)]">
              {achievePercent >= 100 ? "🎉 目標達成！" : `あと ¥${remaining.toLocaleString()}`}
            </p>
          </div>
        </div>
      </div>

      {payError && (
        <p className="mb-4 rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 text-sm text-[color:var(--color-accent-warn)]">
          {payError}
        </p>
      )}

      {/* タブ */}
      <div className="mb-4 flex gap-1 border-b border-[color:var(--color-border)]">
        <button onClick={() => setTab("tables")}
          className={`border-b-2 px-4 py-2 text-sm ${tab === "tables" ? "border-[color:var(--color-accent-char)] font-semibold text-[color:var(--color-accent-char)]" : "border-transparent text-[color:var(--color-text-muted)]"}`}>
          テーブル
          <span className="ml-1.5 text-xs">({unpaidBills.length}使用中)</span>
        </button>
        <button onClick={() => setTab("paid")}
          className={`border-b-2 px-4 py-2 text-sm ${tab === "paid" ? "border-[color:var(--color-accent-char)] font-semibold text-[color:var(--color-accent-char)]" : "border-transparent text-[color:var(--color-text-muted)]"}`}>
          精算済み
          <span className="ml-1.5 text-xs">({paidBills.length})</span>
        </button>
      </div>

      {/* ── テーブルタブ ── */}
      {tab === "tables" && (
        <div>
          {unpaidBills.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[color:var(--color-border)] py-16 text-center">
              <p className="text-sm text-[color:var(--color-text-muted)]">使用中のテーブルはありません</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {unpaidBills.map((bill) => {
                const customer = customerById.get(bill.customerId);
                const allItems = mergeItems(bill.orders);
                const tax = Math.floor((bill.totalAmount * 10) / 110);
                const subtotal = bill.totalAmount - tax;
                const isEditing = editingTable === bill.tableNumber;
                const name = tableNames.get(bill.tableNumber);

                return (
                  <div key={bill.tableNumber} className="rounded-xl border border-[color:var(--color-accent-negi)]/40 bg-[color:var(--color-bg-card)] p-4 shadow-sm">
                    {/* ヘッダー */}
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveName(bill.tableNumber);
                              if (e.key === "Escape") setEditingTable(null);
                            }}
                            onBlur={() => saveName(bill.tableNumber)}
                            maxLength={10}
                            className="flex-1 min-w-0 rounded-lg border border-[color:var(--color-accent-char)] bg-[color:var(--color-bg-card)] px-2 py-0.5 text-base font-bold text-[color:var(--color-text-primary)] focus:outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => { setEditingTable(bill.tableNumber); setEditingName(name ?? ""); }}
                            title="クリックして名前を編集"
                            className="text-lg font-bold text-[color:var(--color-text-primary)] hover:text-[color:var(--color-accent-char)] transition-colors truncate"
                          >
                            {name ?? `テーブル ${bill.tableNumber}`}
                          </button>
                        )}
                        <span className="text-xs text-[color:var(--color-text-muted)] shrink-0">No.{bill.tableNumber}</span>
                      </div>
                      <span className="text-[11px] font-semibold text-[color:var(--color-accent-negi)] bg-[color:var(--color-accent-negi)]/15 rounded-full px-2 py-0.5 shrink-0">
                        使用中
                      </span>
                    </div>

                    {/* 在席情報 */}
                    {customer && (
                      <p className="text-xs text-[color:var(--color-text-muted)] mb-3">
                        {customer.guestCount}名
                        {bill.firstOrderAt && (
                          <> · 入店 <span className="font-medium">{new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(bill.firstOrderAt)}</span></>
                        )}
                        <span className="ml-2">({bill.orders.length}件)</span>
                      </p>
                    )}

                    {/* 注文一覧 */}
                    <ul className="mb-2 space-y-1 border-t border-[color:var(--color-border)] pt-2">
                      {allItems.map((item, i) => (
                        <li key={i} className="flex justify-between text-sm">
                          <span className="text-[color:var(--color-text-primary)]">{item.name} ×{item.quantity}</span>
                          <span className="text-[color:var(--color-text-muted)]">¥{(item.price * item.quantity).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>

                    {/* 合計 */}
                    <div className="border-t border-[color:var(--color-border)] pt-2 mb-3 space-y-0.5 text-xs text-[color:var(--color-text-muted)]">
                      <div className="flex justify-between"><span>小計</span><span>¥{subtotal.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>消費税(10%)</span><span>¥{tax.toLocaleString()}</span></div>
                      <div className="flex justify-between text-sm font-bold text-[color:var(--color-accent-char)] pt-1">
                        <span>合計</span><span>¥{bill.totalAmount.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setPayTarget(bill)}
                        disabled={processing !== null}
                        className="w-full rounded-xl bg-[color:var(--color-accent-negi)] py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        {processing === bill.tableNumber ? "処理中..." : "精算完了"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 精算済みタブ ── */}
      {tab === "paid" && (
        <div>
          {paidBills.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)] text-center py-12">精算済みの注文はありません。</p>
          ) : (
            <div className="space-y-4">
              {paidBills.map((table) => {
                const allItems = mergeItems(table.orders);
                const tax = Math.floor((table.totalAmount * 10) / 110);
                const subtotal = table.totalAmount - tax;
                const tableName = tableNames.get(table.tableNumber);
                const guestCount = customerById.get(table.customerId)?.guestCount ?? null;
                return (
                  <div key={table.tableNumber} className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">
                          {tableName ?? `テーブル ${table.tableNumber}`}
                          {tableName && <span className="ml-1.5 text-sm font-normal text-[color:var(--color-text-muted)]">No.{table.tableNumber}</span>}
                        </h2>
                        <p className="text-xs text-[color:var(--color-text-muted)]">
                          {table.orders.length}件の注文
                          {table.firstOrderAt && (
                            <> · 入店 <span className="font-medium">{new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(table.firstOrderAt)}</span></>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-[color:var(--color-accent-char)]">¥{table.totalAmount.toLocaleString()}</p>
                        {guestCount != null && guestCount > 0 && (
                          <p className="text-xs text-[color:var(--color-text-muted)]">
                            {guestCount}名 · 客単価 ¥{Math.floor(table.totalAmount / guestCount).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <ul className="mb-3 space-y-1 text-sm border-t border-[color:var(--color-border)] pt-3">
                      {allItems.map((item, i) => (
                        <li key={i} className="flex justify-between">
                          <span className="text-[color:var(--color-text-primary)]">{item.name} ×{item.quantity}</span>
                          <span className="text-[color:var(--color-text-muted)]">¥{(item.price * item.quantity).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="border-t border-[color:var(--color-border)] pt-2 space-y-1 text-xs text-[color:var(--color-text-muted)]">
                      <div className="flex justify-between"><span>小計</span><span>¥{subtotal.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>消費税(10%)</span><span>¥{tax.toLocaleString()}</span></div>
                    </div>
                    <p className="mt-2 text-center text-xs text-[color:var(--color-accent-negi)] font-medium">精算済み</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 精算確認 */}
      <ConfirmDialog
        open={payTarget !== null}
        title={payTarget
          ? `${tableNames.get(payTarget.tableNumber) ?? `テーブル ${payTarget.tableNumber}`}（No.${payTarget.tableNumber}）の精算`
          : ""}
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
