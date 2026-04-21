"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/PageLoader";
import {
  Timestamp,
  collectionGroup,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { OrderWithItems } from "@/types";
import { normalizeOrder, normalizeOrderItem, comboLineTotal, flattenForReceipt } from "@/lib/order-utils";
import { useAdminRole } from "@/components/admin/AdminContext";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

const CHART_COLOR = "#3b82f6";

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtY(v: number): string {
  if (v >= 100000) return `¥${Math.round(v / 10000)}万`;
  if (v >= 10000) return `¥${(v / 10000).toFixed(1)}万`;
  if (v >= 1000) return `¥${Math.round(v / 1000)}千`;
  return `¥${Math.round(v)}`;
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
  activeKey,
  onBarClick,
  height = 220,
}: {
  buckets: DayBucket[];
  activeKey: string | null;
  onBarClick: (key: string) => void;
  height?: number;
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const padL = 58, padR = 12, padT = 20, padB = 28;
  const W = 800;
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

  const focusKey = hoverKey ?? activeKey;
  const focusBucket = focusKey ? buckets.find((b) => b.key === focusKey) ?? null : null;

  return (
    <div className="relative select-none">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
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
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">
                {fmtY(v)}
              </text>
            </g>
          );
        })}

        {/* バー */}
        {buckets.map((b, i) => {
          const isActive = activeKey === b.key;
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
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoverKey(b.key)}
                onMouseLeave={() => setHoverKey(null)}
                onClick={() => onBarClick(b.key)}
              />
            );
          }
          return (
            <rect
              key={b.key}
              x={bx(i)} y={by(b.revenue)}
              width={barW} height={barHeight}
              fill={isActive ? "#1d4ed8" : isHover ? "#2563eb" : CHART_COLOR}
              rx={3}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoverKey(b.key)}
              onMouseLeave={() => setHoverKey(null)}
              onClick={() => onBarClick(b.key)}
            />
          );
        })}

        {/* X軸ラベル */}
        {buckets.map((b, i) =>
          i % xTickEvery === 0 || i === n - 1 ? (
            <text
              key={b.key}
              x={bx(i) + barW / 2}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill="#94a3b8"
            >
              {b.day}
            </text>
          ) : null
        )}
      </svg>

      {/* ツールチップ */}
      {focusBucket && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]/95 px-5 py-2.5 shadow-xl backdrop-blur-sm text-center whitespace-nowrap">
          <p className="text-xs text-[color:var(--color-text-muted)] mb-0.5">
            {focusBucket.day}日
          </p>
          <p className="text-lg font-bold text-[color:var(--color-text-primary)] tabular-nums">
            ¥{focusBucket.revenue.toLocaleString()}
          </p>
          <p className="text-xs text-[color:var(--color-text-muted)]">{focusBucket.count}件</p>
        </div>
      )}
    </div>
  );
}

// ===== KPI Card =====
function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-4 shadow-sm">
      <p className="text-xs text-[color:var(--color-text-muted)] mb-1">{label}</p>
      <p className="text-xl font-bold text-[color:var(--color-text-primary)] tabular-nums leading-tight">
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-[color:var(--color-text-muted)] mt-1">{sub}</p>
      )}
    </div>
  );
}

// ===== Main Page =====
export default function AdminSalesPage() {
  const role = useAdminRole();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const monthOptions = useMemo(() => generateMonthOptions(), []);
  const [selectedYearMonth, setSelectedYearMonth] = useState<string>(() => monthOptions[0].value);

  useEffect(() => { setDetailKey(null); }, [selectedYearMonth]);

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
        const ordersSnap = await getDocs(query(
          collectionGroup(db, "orders"),
          where("status", "==", "paid"),
          where("createdAt", ">=", start),
          where("createdAt", "<=", end),
          orderBy("createdAt"),
        ));
        const orderDocs = ordersSnap.docs
          .filter((d) => d.ref.parent.parent !== null)
          .map((d) => normalizeOrder(d.id, d.data() as Record<string, unknown>, d.ref.parent.parent!.id));
        const withItems = await Promise.all(
          orderDocs.map(async (order) => {
            const itemsSnap = await getDocs(
              query(collectionGroup(db, "items"), where("orderId", "==", order.id))
            );
            return {
              ...order,
              items: itemsSnap.docs.map((d) =>
                normalizeOrderItem(d.id, d.data() as Record<string, unknown>)
              ),
            };
          })
        );
        if (cancelled) return;
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
    const count = orders.length;
    const [year, month] = selectedYearMonth.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyAvgRevenue = daysInMonth > 0 ? Math.round(revenue / daysInMonth) : 0;
    const atv = count > 0 ? Math.round(revenue / count) : null;
    return { revenue, count, dailyAvgRevenue, atv };
  }, [orders, selectedYearMonth]);

  const detail = useMemo(() => {
    if (!detailKey) return null;
    const filtered = orders.filter((o) => {
      const d = o.createdAt?.toDate?.();
      return !!d && formatDate(d) === detailKey;
    });
    if (filtered.length === 0) return null;
    const count = filtered.length;
    const revenue = filtered.reduce((s, o) => s + orderTotal(o), 0);
    const atv = count === 0 ? 0 : Math.round(revenue / count);
    const menuMap = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const o of filtered) {
      for (const it of flattenForReceipt(o.items)) {
        const e = menuMap.get(it.menuId) ?? { name: it.name, qty: 0, revenue: 0 };
        e.qty += it.quantity;
        e.revenue += it.price * it.quantity;
        menuMap.set(it.menuId, e);
      }
    }
    const breakdown = Array.from(menuMap.values()).sort((a, b) => b.revenue - a.revenue);
    const day = parseInt(detailKey.split("-")[2]);
    return { label: `${day}日`, count, revenue, atv, breakdown };
  }, [detailKey, orders]);

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
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label="月間売上"
          value={yen(kpi.revenue)}
          sub={`1日平均 ${yen(kpi.dailyAvgRevenue)}`}
        />
        <KpiCard
          label="注文数"
          value={`${kpi.count.toLocaleString()}件`}
        />
        <KpiCard
          label="1注文あたり"
          value={kpi.atv !== null ? yen(kpi.atv) : "−"}
        />
      </div>

      {/* 日別売上棒グラフ */}
      <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] px-4 pt-4 pb-2 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-[color:var(--color-text-primary)]">日別売上</h2>
          {detailKey && (
            <button
              onClick={() => setDetailKey(null)}
              className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] transition-colors px-2 py-1 rounded hover:bg-[color:var(--color-bg-subtle)]"
            >
              選択解除
            </button>
          )}
        </div>

        {orders.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)] py-12 text-center">
            この月のデータがありません
          </p>
        ) : (
          <BarChart
            buckets={buckets}
            activeKey={detailKey}
            onBarClick={(key) => setDetailKey((cur) => cur === key ? null : key)}
            height={220}
          />
        )}
      </div>

      {/* 日別詳細パネル */}
      {detail && (
        <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[color:var(--color-text-primary)]">
              {detail.label} の詳細
            </h3>
            <button
              onClick={() => setDetailKey(null)}
              className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] transition-colors px-2 py-1 rounded hover:bg-[color:var(--color-bg-subtle)]"
            >
              ✕ 閉じる
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="rounded-xl bg-[color:var(--color-bg-subtle)] p-3">
              <p className="text-xs text-[color:var(--color-text-muted)] mb-1">売上</p>
              <p className="text-xl font-bold text-[color:var(--color-text-primary)] tabular-nums">{yen(detail.revenue)}</p>
            </div>
            <div className="rounded-xl bg-[color:var(--color-bg-subtle)] p-3">
              <p className="text-xs text-[color:var(--color-text-muted)] mb-1">注文数</p>
              <p className="text-xl font-bold text-[color:var(--color-text-primary)] tabular-nums">{detail.count}件</p>
            </div>
            <div className="rounded-xl bg-[color:var(--color-bg-subtle)] p-3">
              <p className="text-xs text-[color:var(--color-text-muted)] mb-1">1注文あたり</p>
              <p className="text-xl font-bold text-[color:var(--color-accent-char)] tabular-nums">{yen(detail.atv)}</p>
            </div>
          </div>

          <table className="w-full text-xs tabular-nums">
            <thead className="text-[color:var(--color-text-muted)] border-b border-[color:var(--color-border)]">
              <tr>
                <th className="text-left font-normal py-1.5">メニュー</th>
                <th className="text-right font-normal py-1.5 w-16">数量</th>
                <th className="text-right font-normal py-1.5 w-24">売上</th>
              </tr>
            </thead>
            <tbody>
              {detail.breakdown.map((m) => (
                <tr key={m.name} className="border-t border-[color:var(--color-border)]">
                  <td className="py-1.5 text-[color:var(--color-text-primary)] truncate pr-2">{m.name}</td>
                  <td className="py-1.5 text-right text-[color:var(--color-text-primary)]">{m.qty}個</td>
                  <td className="py-1.5 text-right text-[color:var(--color-text-primary)]">{yen(m.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
