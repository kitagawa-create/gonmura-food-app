"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { PageLoader } from "@/components/ui/PageLoader";
import { useToast } from "@/components/ui/Snackbar";
import { useAdminRole } from "@/components/admin/AdminContext";
import type { Customer, Order, OrderItem, TableConfig } from "@/types";
import { comboLineTotal, flattenForReceipt } from "@/lib/order-utils";

type OrderWithItems = Order & { items: OrderItem[] };

type Tab = "tables" | "paid";
type TableBill = {
  tableNumber: number;
  orders: OrderWithItems[];
  totalAmount: number;
  firstOrderAt: Date | null;
};

const DEFAULT_GOAL = 100_000;
const GOAL_KEY = "gonmura-sales-goal";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function groupByTable(orders: OrderWithItems[]): TableBill[] {
  const map = new Map<number, OrderWithItems[]>();
  for (const o of orders) {
    map.set(o.tableNumber, [...(map.get(o.tableNumber) ?? []), o]);
  }
  return Array.from(map.entries())
    .map(([tableNumber, tableOrders]) => ({
      tableNumber,
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
  const role = useAdminRole();
  const isOwner = role === "owner";
  const { show: toast } = useToast();

  const [tableConfigs, setTableConfigs] = useState<TableConfig[]>([]);
  const [activeCustomers, setActiveCustomers] = useState<Customer[]>([]);
  const [unpaidOrders, setUnpaidOrders] = useState<OrderWithItems[]>([]);
  const [paidOrders, setPaidOrders] = useState<OrderWithItems[]>([]);
  const [todayPaidOrders, setTodayPaidOrders] = useState<OrderWithItems[]>([]);

  const [configsLoaded, setConfigsLoaded] = useState(false);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [todayLoaded, setTodayLoaded] = useState(false);

  const [tab, setTab] = useState<Tab>("tables");
  const [dateFilter, setDateFilter] = useState(todayISO());

  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [goalInput, setGoalInput] = useState("");
  const [editingGoal, setEditingGoal] = useState(false);

  // テーブル名インライン編集
  const [editingTable, setEditingTable] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);

  // テーブル追加
  const [showAddModal, setShowAddModal] = useState(false);
  const [addNumber, setAddNumber] = useState("");
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);

  // テーブル削除
  const [deleteTarget, setDeleteTarget] = useState<TableConfig | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 精算
  const [payTarget, setPayTarget] = useState<TableBill | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  // 席移動
  const [moveSource, setMoveSource] = useState<{ tableNumber: number; customerId: string } | null>(null);
  const [moveDest, setMoveDest] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const s = localStorage.getItem(GOAL_KEY);
    if (s) { const n = parseInt(s, 10); if (!isNaN(n) && n > 0) setGoal(n); }
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "tables"), (snap) => {
      setTableConfigs(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TableConfig)
          .sort((a, b) => a.number - b.number)
      );
      setConfigsLoaded(true);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "customers"), where("status", "==", "active")),
      (snap) => setActiveCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Customer))
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
        ).then((data) => {
          setUnpaidOrders(data);
          setOrdersLoaded(true);
        });
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
        ).then((data) => {
          setTodayPaidOrders(data);
          setTodayLoaded(true);
        });
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

  const activeMap = useMemo(() => new Map(activeCustomers.map((c) => [c.tableNumber, c])), [activeCustomers]);
  const unpaidBills = useMemo(() => groupByTable(unpaidOrders), [unpaidOrders]);
  const paidBills = useMemo(() => groupByTable(paidOrders), [paidOrders]);
  const billMap = useMemo(() => new Map(unpaidBills.map((b) => [b.tableNumber, b])), [unpaidBills]);

  const todaySales = useMemo(
    () => todayPaidOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + comboLineTotal(i), 0), 0),
    [todayPaidOrders]
  );
  const achievePercent = goal > 0 ? (todaySales / goal) * 100 : 0;
  const remaining = Math.max(goal - todaySales, 0);

  const configuredNums = useMemo(() => new Set(tableConfigs.map((t) => t.number)), [tableConfigs]);
  const availableNums = useMemo(
    () => Array.from({ length: 30 }, (_, i) => i + 1).filter((n) => !configuredNums.has(n)),
    [configuredNums]
  );
  const emptyConfigs = useMemo(
    () => tableConfigs.filter((t) => !activeMap.has(t.number)),
    [tableConfigs, activeMap]
  );
  const occupiedCount = useMemo(
    () => tableConfigs.filter((t) => activeMap.has(t.number)).length,
    [tableConfigs, activeMap]
  );

  function saveGoal() {
    const n = parseInt(goalInput, 10);
    if (!isNaN(n) && n > 0) { setGoal(n); localStorage.setItem(GOAL_KEY, String(n)); }
    setEditingGoal(false);
  }

  async function saveName(num: number) {
    const trimmed = editingName.trim();
    if (!trimmed) { setEditingTable(null); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, "tables", String(num)), { number: num, name: trimmed }, { merge: true });
      setEditingTable(null);
      toast("保存しました");
    } catch { toast("保存に失敗しました"); }
    finally { setSaving(false); }
  }

  async function addTable() {
    const num = parseInt(addNumber, 10);
    if (!num || num < 1 || num > 30 || configuredNums.has(num)) return;
    const trimmed = addName.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await setDoc(doc(db, "tables", String(num)), { number: num, name: trimmed });
      setShowAddModal(false);
      setAddNumber("");
      setAddName("");
      toast(`${trimmed}（No.${num}）を追加しました`);
    } catch { toast("追加に失敗しました"); }
    finally { setAdding(false); }
  }

  async function deleteTable() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "tables", deleteTarget.id));
      setDeleteTarget(null);
      toast("テーブルを削除しました");
    } catch { toast("削除に失敗しました"); }
    finally { setDeleting(false); }
  }

  const confirmPay = useCallback(async () => {
    if (!payTarget || processing !== null) return;
    setProcessing(payTarget.tableNumber);
    setPayError(null);
    try {
      const customerSnap = await getDocs(
        query(collection(db, "customers"),
          where("tableNumber", "==", payTarget.tableNumber),
          where("status", "==", "active"))
      );
      const batch = writeBatch(db);
      for (const o of payTarget.orders) {
        batch.update(doc(db, "orders", o.id), { status: "paid", updatedAt: serverTimestamp() });
      }
      customerSnap.docs.forEach((d) => batch.update(d.ref, { status: "paid", updatedAt: serverTimestamp() }));
      await batch.commit();
      setPayTarget(null);
    } catch (e) { setPayError(e instanceof Error ? e.message : "精算に失敗しました"); }
    finally { setProcessing(null); }
  }, [payTarget, processing]);

  const doMoveTable = useCallback(async () => {
    if (!moveSource || moveDest === null || moving) return;
    setMoving(true);
    try {
      const ordersSnap = await getDocs(
        query(collection(db, "orders"),
          where("customerId", "==", moveSource.customerId),
          where("status", "in", ["pending", "completed"]))
      );
      const batch = writeBatch(db);
      batch.update(doc(db, "customers", moveSource.customerId), { tableNumber: moveDest, updatedAt: serverTimestamp() });
      ordersSnap.docs.forEach((d) => batch.update(d.ref, { tableNumber: moveDest, updatedAt: serverTimestamp() }));
      await batch.commit();
      setMoveSource(null);
      setMoveDest(null);
      toast("席を移動しました");
    } catch { toast("移動に失敗しました"); }
    finally { setMoving(false); }
  }, [moveSource, moveDest, moving, toast]);

  if (!configsLoaded || !ordersLoaded || !todayLoaded) return <PageLoader />;

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
          <span className="ml-1.5 text-xs">({occupiedCount}使用中 / {tableConfigs.length}席)</span>
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
          {isOwner && (
            <div className="flex justify-end mb-4">
              <button
                onClick={() => { setShowAddModal(true); setAddNumber(""); setAddName(""); }}
                disabled={availableNums.length === 0}
                className="flex items-center gap-1.5 rounded-xl bg-[color:var(--color-accent-char)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                テーブル追加
              </button>
            </div>
          )}

          {tableConfigs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[color:var(--color-border)] py-16 text-center">
              <p className="text-sm text-[color:var(--color-text-muted)] mb-1">テーブルが登録されていません</p>
              {isOwner && <p className="text-xs text-[color:var(--color-text-muted)]">「テーブル追加」ボタンから追加してください</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {tableConfigs.map((config) => {
                const customer = activeMap.get(config.number);
                const bill = billMap.get(config.number);
                const occupied = !!customer;
                const allItems = bill ? mergeItems(bill.orders) : [];
                const tax = bill ? Math.floor((bill.totalAmount * 10) / 110) : 0;
                const subtotal = bill ? bill.totalAmount - tax : 0;
                const isEditing = editingTable === config.number;

                return (
                  <div
                    key={config.number}
                    className={`rounded-xl border p-4 ${
                      occupied
                        ? "border-[color:var(--color-accent-negi)]/40 bg-[color:var(--color-bg-card)] shadow-sm"
                        : "border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)]"
                    }`}
                  >
                    {/* ヘッダー */}
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveName(config.number);
                              if (e.key === "Escape") setEditingTable(null);
                            }}
                            onBlur={() => saveName(config.number)}
                            maxLength={10}
                            disabled={saving}
                            className="flex-1 min-w-0 rounded-lg border border-[color:var(--color-accent-char)] bg-[color:var(--color-bg-card)] px-2 py-0.5 text-base font-bold text-[color:var(--color-text-primary)] focus:outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => { setEditingTable(config.number); setEditingName(config.name); }}
                            title="クリックして名前を編集"
                            className="text-lg font-bold text-[color:var(--color-text-primary)] hover:text-[color:var(--color-accent-char)] transition-colors truncate"
                          >
                            {config.name}
                          </button>
                        )}
                        <span className="text-xs text-[color:var(--color-text-muted)] shrink-0">No.{config.number}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {occupied ? (
                          <span className="text-[11px] font-semibold text-[color:var(--color-accent-negi)] bg-[color:var(--color-accent-negi)]/15 rounded-full px-2 py-0.5">
                            使用中
                          </span>
                        ) : (
                          <>
                            <span className="text-[11px] text-[color:var(--color-text-muted)] bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-full px-2 py-0.5">
                              空席
                            </span>
                            {isOwner && (
                              <button
                                onClick={() => setDeleteTarget(config)}
                                title="テーブルを削除"
                                className="p-1 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-warn)] transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* 使用中の詳細 */}
                    {occupied && customer && bill && (
                      <>
                        <p className="text-xs text-[color:var(--color-text-muted)] mb-3">
                          {customer.guestCount}名
                          {bill.firstOrderAt && (
                            <> · 入店 <span className="font-medium">{new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(bill.firstOrderAt)}</span></>
                          )}
                          <span className="ml-2">({bill.orders.length}件)</span>
                        </p>

                        <ul className="mb-2 space-y-1 border-t border-[color:var(--color-border)] pt-2">
                          {allItems.map((item, i) => (
                            <li key={i} className="flex justify-between text-sm">
                              <span className="text-[color:var(--color-text-primary)]">{item.name} ×{item.quantity}</span>
                              <span className="text-[color:var(--color-text-muted)]">¥{(item.price * item.quantity).toLocaleString()}</span>
                            </li>
                          ))}
                        </ul>

                        <div className="border-t border-[color:var(--color-border)] pt-2 mb-3 space-y-0.5 text-xs text-[color:var(--color-text-muted)]">
                          <div className="flex justify-between"><span>小計</span><span>¥{subtotal.toLocaleString()}</span></div>
                          <div className="flex justify-between"><span>消費税(10%)</span><span>¥{tax.toLocaleString()}</span></div>
                          <div className="flex justify-between text-sm font-bold text-[color:var(--color-accent-char)] pt-1">
                            <span>合計</span><span>¥{bill.totalAmount.toLocaleString()}</span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => setMoveSource({ tableNumber: config.number, customerId: customer.id })}
                            className="flex-1 rounded-xl border border-[color:var(--color-accent-char)]/40 py-2 text-sm font-medium text-[color:var(--color-accent-char)] hover:bg-[color:var(--color-accent-char)]/5 transition-colors"
                          >
                            席移動
                          </button>
                          <button
                            onClick={() => setPayTarget(bill)}
                            disabled={processing !== null}
                            className="flex-[2] rounded-xl bg-[color:var(--color-accent-negi)] py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                          >
                            {processing === config.number ? "処理中..." : "精算完了"}
                          </button>
                        </div>
                      </>
                    )}
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
                const tableName = tableConfigs.find((t) => t.number === table.tableNumber)?.name;
                const guestCount = table.orders.find((o) => o.guestCount != null)?.guestCount ?? null;
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

      {/* ── テーブル追加モーダル ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-6">
            <h2 className="text-lg font-bold text-[color:var(--color-text-primary)] mb-4">テーブル追加</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[color:var(--color-text-muted)] mb-1">テーブル番号</label>
                <select
                  value={addNumber}
                  onChange={(e) => setAddNumber(e.target.value)}
                  className="w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-3 py-2.5 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
                >
                  <option value="">番号を選択（1〜30）</option>
                  {availableNums.map((n) => <option key={n} value={n}>No.{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[color:var(--color-text-muted)] mb-1">テーブル名</label>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTable()}
                  placeholder="例: 窓際A、カウンター1"
                  maxLength={10}
                  autoFocus
                  className="w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-3 py-2.5 text-sm text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowAddModal(false)}
                className="flex-1 rounded-xl border border-[color:var(--color-border)] py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity">
                キャンセル
              </button>
              <button
                onClick={addTable}
                disabled={!addNumber || !addName.trim() || adding}
                className="flex-1 rounded-xl bg-[color:var(--color-accent-char)] py-2.5 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {adding ? "追加中..." : "追加する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 席移動モーダル ── */}
      {moveSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-6">
            <h2 className="text-lg font-bold text-[color:var(--color-text-primary)] mb-1">席移動</h2>
            <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
              {tableConfigs.find((t) => t.number === moveSource.tableNumber)?.name ?? `テーブル${moveSource.tableNumber}`} の客を移動します
            </p>
            {emptyConfigs.length === 0 ? (
              <p className="py-6 text-center text-sm text-[color:var(--color-text-muted)]">移動可能な空席がありません</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 mb-5 max-h-52 overflow-y-auto">
                {emptyConfigs.map((t) => (
                  <button key={t.number} onClick={() => setMoveDest(t.number)}
                    className={`rounded-xl border py-3 px-1 text-sm font-medium transition-colors ${
                      moveDest === t.number
                        ? "border-[color:var(--color-accent-char)] bg-[color:var(--color-accent-char)] text-white"
                        : "border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] text-[color:var(--color-text-primary)] hover:border-[color:var(--color-accent-char)]"
                    }`}
                  >
                    <span className="block truncate">{t.name}</span>
                    <span className="block text-[10px] opacity-70">No.{t.number}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setMoveSource(null); setMoveDest(null); }}
                className="flex-1 rounded-xl border border-[color:var(--color-border)] py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity">
                キャンセル
              </button>
              <button onClick={doMoveTable} disabled={moveDest === null || moving}
                className="flex-1 rounded-xl bg-[color:var(--color-accent-char)] py-2.5 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity">
                {moving ? "移動中..." : "移動する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* テーブル削除確認 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`${deleteTarget?.name}（No.${deleteTarget?.number}）を削除`}
        message="このテーブルを削除しますか？注文データは残ります。"
        confirmLabel="削除する"
        confirmColor="red"
        onConfirm={deleteTable}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />

      {/* 精算確認 */}
      <ConfirmDialog
        open={payTarget !== null}
        title={payTarget
          ? `${tableConfigs.find((t) => t.number === payTarget.tableNumber)?.name ?? `テーブル ${payTarget.tableNumber}`}（No.${payTarget.tableNumber}）の精算`
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
