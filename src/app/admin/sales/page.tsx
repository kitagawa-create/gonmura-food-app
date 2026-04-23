"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/PageLoader";
import {
  Timestamp,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { OrderWithItems } from "@/types";
import { normalizeOrder, normalizeOrderItem, comboLineTotal, taxIncluded } from "@/lib/order-utils";
import { useAdminRole } from "@/components/admin/AdminContext";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

const CHART_COLOR = "#3b82f6";

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function orderTotal(o: OrderWithItems): number {
  return o.items.reduce((s, i) => s + comboLineTotal(i), 0);
}

type DayBucket = { day: number; key: string; revenue: number; count: number };

function generateMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    options.push({ value, label });
  }
  return options;
}

// ===== Bar Chart =====
function BarChart({
  buckets,
  height = 220,
}: {
  buckets: DayBucket[];
  height?: number;
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(800);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0) setW(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const padL = 70, padR = 12, padT = 24, padB = 32;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const n = buckets.length;

  if (n === 0) return null;

  const maxVal = Math.max(...buckets.map((b) => b.revenue), 1);
  const barSlot = innerW / n;
  const barW = Math.max(2, barSlot * 0.65);

  const bx = (i: number) => padL + i * barSlot + (barSlot - barW) / 2;
  const bh = (v: number) => (v / maxVal) * innerH;
  const by = (v: number) => padT + innerH - bh(v);

  const gridRatios = [0, 0.25, 0.5, 0.75, 1];
  const xTickEvery = Math.max(1, Math.ceil(n / 10));

  const focusBucket = hoverKey ? buckets.find((b) => b.key === hoverKey) ?? null : null;

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        {/* Y軸タイトル（回転） */}
        <text
          x={10}
          y={padT + innerH / 2}
          textAnchor="middle"
          fontSize={9}
          fill="#94a3b8"
          transform={`rotate(-90, 10, ${padT + innerH / 2})`}
        >
          売上（円）
        </text>

        {/* Y軸グリッド + ラベル */}
        {gridRatios.map((p) => {
          const y = padT + innerH * (1 - p);
          const v = maxVal * p;
          return (
            <g key={p}>
              <line
                x1={padL} x2={W - padR} y1={y} y2={y}
                stroke={p === 0 ? "#cbd5e1" : "#e2e8f0"}
                strokeWidth={1}
                strokeDasharray={p === 0 ? "" : "3 3"}
              />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={9} fill="#94a3b8">
                {v === 0 ? "¥0" : `¥${taxIncluded(Math.round(v)).toLocaleString()}`}
              </text>
            </g>
          );
        })}

        {/* バー */}
        {buckets.map((b, i) => {
          const isHover = hoverKey === b.key;
          const barHeight = bh(b.revenue);
          if (barHeight < 1) {
            return (
              <rect
                key={b.key}
                x={bx(i)} y={padT + innerH - 2}
                width={barW} height={2}
                fill="#e2e8f0"
                rx={1}
                onMouseEnter={() => setHoverKey(b.key)}
                onMouseLeave={() => setHoverKey(null)}
              />
            );
          }
          return (
            <rect
              key={b.key}
              x={bx(i)} y={by(b.revenue)}
              width={barW} height={barHeight}
              fill={isHover ? "#2563eb" : CHART_COLOR}
              rx={3}
              onMouseEnter={() => setHoverKey(b.key)}
              onMouseLeave={() => setHoverKey(null)}
            />
          );
        })}

        {/* X軸ラベル（日） */}
        {buckets.map((b, i) =>
          i % xTickEvery === 0 || i === n - 1 ? (
            <text
              key={b.key}
              x={bx(i) + barW / 2}
              y={height - 16}
              textAnchor="middle"
              fontSize={9}
              fill="#94a3b8"
            >
              {b.day}
            </text>
          ) : null
        )}

        {/* X軸タイトル */}
        <text x={W - padR} y={height - 4} textAnchor="end" fontSize={9} fill="#94a3b8">
          （日）
        </text>
      </svg>

      {/* ツールチップ */}
      {focusBucket && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]/95 px-5 py-2.5 shadow-xl backdrop-blur-sm text-center whitespace-nowrap">
          <p className="text-xs text-[color:var(--color-text-muted)] mb-0.5">{focusBucket.day}日</p>
          <p className="text-lg font-bold text-[color:var(--color-text-primary)] tabular-nums">
            ¥{taxIncluded(focusBucket.revenue).toLocaleString()}
          </p>
          <p className="text-xs text-[color:var(--color-text-muted)]">{focusBucket.count}件</p>
        </div>
      )}
    </div>
  );
}

// ===== KPI Card =====
function KpiCard({ label, value, sub, sub2 }: { label: string; value: string; sub?: string; sub2?: string }) {
  return (
    <div className="rounded-xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-4 shadow-sm">
      <p className="text-xs text-[color:var(--color-text-muted)] mb-1">{label}</p>
      <p className="text-xl font-bold text-[color:var(--color-text-primary)] tabular-nums leading-tight">
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-[color:var(--color-text-muted)] mt-1">{sub}</p>
      )}
      {sub2 && (
        <p className="text-[11px] text-[color:var(--color-text-muted)] mt-0.5">{sub2}</p>
      )}
    </div>
  );
}

// ===== Main Page =====
export default function AdminSalesPage() {
  const role = useAdminRole();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [customerGuestMap, setCustomerGuestMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const monthOptions = useMemo(() => generateMonthOptions(), []);
  const [selectedYearMonth, setSelectedYearMonth] = useState<string>(() => monthOptions[0].value);

  useEffect(() => {
    if (role !== "owner") router.replace("/admin/orders");
  }, [role, router]);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    async function fetchData() {
      try {
        const [year, month] = selectedYearMonth.split("-").map(Number);
        const start = Timestamp.fromDate(new Date(year, month - 1, 1, 0, 0, 0));
        const end = Timestamp.fromDate(new Date(year, month, 0, 23, 59, 59, 999));
        const ordersSnap = await getDocs(
          query(
            collectionGroup(db, "orders"),
            where("createdAt", ">=", start),
            where("createdAt", "<=", end),
            orderBy("createdAt")
          )
        );
        const orderDocs = ordersSnap.docs
          .filter((d) => d.ref.parent.parent !== null)
          .map((d) => normalizeOrder(d.id, d.data() as Record<string, unknown>, d.ref.parent.parent!.id));
        const customerIds = [...new Set(orderDocs.map((order) => order.customerId))];
        const customerSnaps = await Promise.all(customerIds.map((id) => getDoc(doc(db, "customers", id))));
        const customerMap = new Map(customerSnaps.filter((snap) => snap.exists()).map((snap) => [snap.id, snap.data() as Record<string, unknown>]));
        const paidCustomerIds = new Set(
          customerMap.entries()
            .filter(([, data]) => data.isPaid === true)
            .map(([id]) => id)
        );
        const guestMap = new Map<string, number>();
        for (const [customerId, data] of customerMap.entries()) {
          const gc = data.guestCount;
          guestMap.set(customerId, typeof gc === "number" && gc > 0 ? Math.trunc(gc) : 1);
        }
        if (cancelled) return;
        const withItems = await Promise.all(orderDocs
          .filter((order) => paidCustomerIds.has(order.customerId))
          .map(async (order) => {
          const itemsSnap = await getDocs(
            query(collectionGroup(db, "items"), where("orderId", "==", order.orderId))
          );
          return {
            ...order,
            items: itemsSnap.docs.map((d) =>
              normalizeOrderItem(d.id, d.data() as Record<string, unknown>)
            ),
          };
        }));
        if (cancelled) return;
        setCustomerGuestMap(guestMap);
        setOrders(withItems);
      } catch (e) {
        if (!cancelled) console.error("[sales] fetchData failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [selectedYearMonth]);

  const buckets = useMemo<DayBucket[]>(() => {
    const [year, month] = selectedYearMonth.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const map = new Map<string, { revenue: number; count: number }>();
    for (const o of orders) {
      const date = o.createdAt?.toDate?.();
      if (!date) continue;
      const key = formatDate(date);
      const b = map.get(key) ?? { revenue: 0, count: 0 };
      b.revenue += orderTotal(o);
      b.count += 1;
      map.set(key, b);
    }
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const key = `${selectedYearMonth}-${String(day).padStart(2, "0")}`;
      const b = map.get(key) ?? { revenue: 0, count: 0 };
      return { day, key, ...b };
    });
  }, [orders, selectedYearMonth]);

  const kpi = useMemo(() => {
    const revenue = orders.reduce((s, o) => s + orderTotal(o), 0);
    const [year, month] = selectedYearMonth.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyAvgRevenue = daysInMonth > 0 ? Math.round(revenue / daysInMonth) : 0;
    const uniqueCustomers = [...new Set(orders.map((o) => o.customerId))];
    const totalGuests = uniqueCustomers.reduce((s, id) => s + (customerGuestMap.get(id) ?? 1), 0);
    const guestUnitPrice = totalGuests > 0 ? Math.round(revenue / totalGuests) : null;
    return { revenue, dailyAvgRevenue, guestUnitPrice, totalGuests };
  }, [orders, selectedYearMonth, customerGuestMap]);

  if (role !== "owner") return null;
  if (loading) return <PageLoader />;

  const yen = (v: number) => `¥${v.toLocaleString()}`;

  return (
    <div className="w-full flex flex-col gap-4 pb-6">
      <AdminPageHeader title="売上分析" />

      {/* 月選択 */}
      <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] px-4 py-3 shadow-sm flex items-center gap-3">
        <label className="text-sm text-[color:var(--color-text-muted)] shrink-0">表示月</label>
        <select
          value={selectedYearMonth}
          onChange={(e) => setSelectedYearMonth(e.target.value)}
          className="bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
        >
          {monthOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard
          label="月間売上"
          value={yen(taxIncluded(kpi.revenue))}
          sub={`税抜 ${yen(kpi.revenue)}`}
          sub2={`1日平均 ${yen(taxIncluded(kpi.dailyAvgRevenue))}`}
        />
        <KpiCard
          label="客単価"
          value={kpi.guestUnitPrice !== null ? yen(taxIncluded(kpi.guestUnitPrice)) : "−"}
          sub={kpi.guestUnitPrice !== null ? `税抜 ${yen(kpi.guestUnitPrice)}` : undefined}
          sub2={kpi.totalGuests > 0 ? `来客数 ${kpi.totalGuests}名` : undefined}
        />
      </div>

      {/* 日別売上棒グラフ */}
      <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] px-4 pt-4 pb-2 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-bold text-[color:var(--color-text-primary)]">日別売上</h2>
          <span className="text-xs text-[color:var(--color-text-muted)] border border-[color:var(--color-border)] rounded px-1.5 py-0.5">税込</span>
        </div>

        {orders.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)] py-12 text-center">
            この月のデータがありません
          </p>
        ) : (
          <BarChart buckets={buckets} height={220} />
        )}
      </div>

    </div>
  );
}
