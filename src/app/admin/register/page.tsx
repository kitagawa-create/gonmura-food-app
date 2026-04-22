"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Timestamp,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StickyFilterBar } from "@/components/admin/StickyFilterBar";
import { OrderHistoryFilterBar } from "@/components/admin/OrderHistoryFilterBar";
import { PageLoader } from "@/components/ui/PageLoader";
import type { OrderWithItems } from "@/types";
import { comboLineTotal, flattenForReceipt, normalizeOrder, normalizeOrderItem, taxIncluded } from "@/lib/order-utils";

type CustomerInfo = { tableId: string; guestCount: number };

async function fetchCustomerInfo(customerIds: string[]): Promise<Map<string, CustomerInfo>> {
  if (customerIds.length === 0) return new Map();
  const snaps = await Promise.all(customerIds.map((id) => getDoc(doc(db, "customers", id))));
  const result = new Map<string, CustomerInfo>();
  for (const snap of snaps) {
    if (!snap.exists()) continue;
    const d = snap.data();
    result.set(snap.id, {
      tableId: typeof d.tableId === "string" ? d.tableId : "",
      guestCount: typeof d.guestCount === "number" ? Math.trunc(d.guestCount) : 1,
    });
  }
  return result;
}

type TableBill = {
  customerId: string;
  tableNumber: string;
  guestCount: number;
  orders: OrderWithItems[];
  totalAmount: number;
  firstOrderAt: Date | null;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function groupByCustomer(
  orders: OrderWithItems[],
  customerInfoMap: Map<string, CustomerInfo>,
  tableNumberMap: Map<string, string>
): TableBill[] {
  const map = new Map<string, OrderWithItems[]>();
  for (const o of orders) {
    map.set(o.customerId, [...(map.get(o.customerId) ?? []), o]);
  }
  return Array.from(map.entries())
    .map(([customerId, tableOrders]) => {
      const info = customerInfoMap.get(customerId);
      const tableNumber = tableNumberMap.get(info?.tableId ?? "") ?? "";
      return {
        customerId,
        tableNumber,
        guestCount: info?.guestCount ?? 1,
        orders: tableOrders,
        totalAmount: tableOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + comboLineTotal(i), 0), 0),
        firstOrderAt: tableOrders.reduce<Date | null>((earliest, o) => {
          const d = o.createdAt?.toDate?.();
          if (!d) return earliest;
          return !earliest || d < earliest ? d : earliest;
        }, null),
      };
    })
    .sort((a, b) => (b.firstOrderAt?.getTime() ?? 0) - (a.firstOrderAt?.getTime() ?? 0));
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

export default function AdminRegisterPage() {
  const [paidOrders, setPaidOrders] = useState<OrderWithItems[]>([]);
  const [customerInfoMap, setCustomerInfoMap] = useState<Map<string, CustomerInfo>>(new Map());
  const customerInfoMapRef = useRef<Map<string, CustomerInfo>>(new Map());
  const [tableNumberMap, setTableNumberMap] = useState<Map<string, string>>(new Map());

  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [dateFilter, setDateFilter] = useState(todayISO());
  const [tableFilter, setTableFilter] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(collection(db, "tables"), (snap) => {
      const map = new Map<string, string>();
      for (const d of snap.docs) map.set(d.id, d.data().tableNumber as string);
      setTableNumberMap(map);
    });
  }, []);

  useEffect(() => {
    const start = new Date(`${dateFilter}T00:00:00`);
    const end = new Date(start.getTime() + 86_400_000);
    let cancelled = false;
    let gen = 0;
    const unsub = onSnapshot(
      query(
        collectionGroup(db, "orders"),
        where("status", "==", "paid"),
        where("createdAt", ">=", Timestamp.fromDate(start)),
        where("createdAt", "<", Timestamp.fromDate(end)),
        orderBy("createdAt", "desc")
      ),
      async (snap) => {
        const current = ++gen;
        const orderDocs = snap.docs
          .filter((d) => d.ref.parent.parent !== null)
          .map((d) => normalizeOrder(d.id, d.data() as Record<string, unknown>, d.ref.parent.parent!.id));
        const withItems = await Promise.all(
          orderDocs.map(async (order) => {
            const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.orderId)));
            return { ...order, items: itemsSnap.docs.map((d) => normalizeOrderItem(d.id, d.data() as Record<string, unknown>)) };
          })
        );
        if (cancelled || current !== gen) return;
        const missingIds = [...new Set(withItems.map((o) => o.customerId))].filter(
          (id) => !customerInfoMapRef.current.has(id)
        );
        if (missingIds.length > 0) {
          const newData = await fetchCustomerInfo(missingIds);
          if (cancelled || current !== gen) return;
          customerInfoMapRef.current = new Map([...customerInfoMapRef.current, ...newData]);
        }
        setPaidOrders(withItems);
        setCustomerInfoMap(new Map(customerInfoMapRef.current));
        setOrdersLoaded(true);
      },
      () => { if (!cancelled) { setPaidOrders([]); setOrdersLoaded(true); } }
    );
    return () => { cancelled = true; unsub(); };
  }, [dateFilter]);

  const paidBills = useMemo(
    () => groupByCustomer(paidOrders, customerInfoMap, tableNumberMap),
    [paidOrders, customerInfoMap, tableNumberMap]
  );

  const availableTables = useMemo(
    () =>
      [...new Set(paidBills.map((b) => b.tableNumber).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "ja")
      ),
    [paidBills]
  );

  const filteredBills = useMemo(
    () => (tableFilter !== null ? paidBills.filter((b) => b.tableNumber === tableFilter) : paidBills),
    [paidBills, tableFilter]
  );

  if (!ordersLoaded) return <PageLoader />;

  return (
    <div className="h-full flex flex-col">
      <AdminPageHeader title="支払い履歴" />
      <StickyFilterBar>
        <OrderHistoryFilterBar
          dateValue={dateFilter}
          onDateChange={(v) => { setDateFilter(v); setTableFilter(null); }}
          maxDate={todayISO()}
          tableFilter={tableFilter}
          onTableFilterChange={setTableFilter}
          availableTables={availableTables}
          filteredCount={filteredBills.length}
          totalCount={paidBills.length}
          totalAmount={filteredBills.reduce((s, b) => s + taxIncluded(b.totalAmount), 0)}
        />
      </StickyFilterBar>
      <div className="flex-1 overflow-y-auto pt-4">
      <div>
        {filteredBills.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[color:var(--color-border)] py-12 text-center">
            <p className="text-sm text-[color:var(--color-text-muted)]">精算済みの注文はありません</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredBills.map((table) => {
              const allItems = mergeItems(table.orders);
              const subtotal = table.totalAmount;
              const tax = Math.round(subtotal * 0.1);
              const totalIncluded = subtotal + tax;
              return (
                <div key={table.customerId} className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">
                        テーブル {table.tableNumber}
                      </h2>
                      <p className="text-xs text-[color:var(--color-text-muted)]">
                        {table.orders.length}件の注文
                        {table.firstOrderAt && (
                          <> · 入店{" "}
                            <span className="font-medium">
                              {new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(table.firstOrderAt)}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-[color:var(--color-accent-char)]">¥{totalIncluded.toLocaleString()}</p>
                      {table.guestCount > 0 && (
                        <p className="text-xs text-[color:var(--color-text-muted)]">
                          {table.guestCount}名 · 客単価 ¥{Math.floor(totalIncluded / table.guestCount).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <ul className="mb-3 space-y-1 text-sm border-t border-[color:var(--color-border)] pt-3">
                    {allItems.map((item, i) => (
                      <li key={i} className="flex justify-between">
                        <span className="text-[color:var(--color-text-primary)]">{item.name} ×{item.quantity}</span>
                        <span className="text-[color:var(--color-text-muted)]">¥{taxIncluded(item.price * item.quantity).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-[color:var(--color-border)] pt-2 space-y-1 text-xs text-[color:var(--color-text-muted)]">
                    <div className="flex justify-between"><span>小計</span><span>¥{subtotal.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>消費税(10%)</span><span>¥{tax.toLocaleString()}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
