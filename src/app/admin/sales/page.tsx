"use client";

import { useEffect, useMemo, useState } from "react";
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
import { normalizeOrder, normalizeOrderItem } from "@/lib/order-utils";
import { useAdminRole } from "@/components/admin/AdminContext";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { comboLineTotal, flattenForReceipt } from "@/lib/order-utils";
import { DatePicker } from "@/components/admin/DatePicker";

// ============================================================
// コメントアウト: メニュー別売数・曜日時間帯 の実装
// (BarChart, AnalysisSelector, CategoryFilter, HeatMap)
// ============================================================

type CustomerTableInfo = { tableNumber: string; guestCount: number };

async function fetchCustomerTableInfo(customerIds: string[]): Promise<Map<string, CustomerTableInfo>> {
  if (customerIds.length === 0) return new Map();
  const customerSnaps = await Promise.all(customerIds.map((id) => getDoc(doc(db, "customers", id))));
  const customerData = new Map<string, { tableId: string; guestCount: number }>();
  for (const snap of customerSnaps) {
    if (!snap.exists()) continue;
    const d = snap.data();
    customerData.set(snap.id, {
      tableId: typeof d.tableId === "string" ? d.tableId : "",
      guestCount: typeof d.guestCount === "number" ? Math.trunc(d.guestCount) : 1,
    });
  }
  const uniqueTableIds = [...new Set([...customerData.values()].map((c) => c.tableId).filter(Boolean))];
  const tableNumberMap = new Map<string, string>();
  if (uniqueTableIds.length > 0) {
    const tableSnaps = await Promise.all(uniqueTableIds.map((id) => getDoc(doc(db, "tables", id))));
    for (const snap of tableSnaps) {
      if (!snap.exists()) continue;
      const d = snap.data();
      tableNumberMap.set(snap.id, typeof d.tableNumber === "string" ? d.tableNumber : "");
    }
  }
  const result = new Map<string, CustomerTableInfo>();
  for (const [customerId, info] of customerData) {
    result.set(customerId, {
      tableNumber: tableNumberMap.get(info.tableId) ?? "",
      guestCount: info.guestCount,
    });
  }
  return result;
}

type Period = "daily" | "weekly" | "monthly";
type Bucket = { key: string; label: string; rangeLabel: string; revenue: number; count: number };

const CHART_COLOR = "#3b82f6";

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const m = new Date(d);
  m.setDate(diff);
  m.setHours(0, 0, 0, 0);
  return m;
}
function bucketKey(d: Date, period: Period): string {
  if (period === "daily") return formatDate(d);
  if (period === "weekly") return formatDate(getWeekStart(d));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shortLabel(key: string, period: Period): string {
  if (period === "monthly") return key.slice(2);
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)}`;
}
function rangeLabel(key: string, period: Period): string {
  if (period === "daily") return shortLabel(key, period);
  if (period === "weekly") {
    const start = new Date(key + "T00:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.getMonth() + 1}/${start.getDate()}〜${end.getMonth() + 1}/${end.getDate()}`;
  }
  const [y, m] = key.split("-");
  const lastDay = new Date(Number(y), Number(m), 0).getDate();
  return `${Number(m)}/1〜${Number(m)}/${lastDay}`;
}
function orderTotal(o: OrderWithItems): number {
  return o.items.reduce((s, i) => s + comboLineTotal(i), 0);
}
function fmtY(v: number): string {
  if (v >= 100000) return `¥${Math.round(v / 10000)}万`;
  if (v >= 10000) return `¥${(v / 10000).toFixed(1)}万`;
  if (v >= 1000) return `¥${Math.round(v / 1000)}千`;
  return `¥${Math.round(v)}`;
}

// ===== Area Chart =====
function AreaChart({
  labels,
  tooltipLabels,
  values,
  height = 220,
  activeIdx = null,
  onPointClick,
}: {
  labels: string[];
  tooltipLabels?: string[];
  values: number[];
  height?: number;
  activeIdx?: number | null;
  onPointClick?: (i: number) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const padL = 58, padR = 16, padT = 20, padB = 32;
  const W = 800;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const n = labels.length;
  if (n === 0) return null;

  const maxVal = Math.max(...values, 1);
  const xs = (i: number) => n === 1 ? padL + innerW / 2 : padL + (i * innerW) / (n - 1);
  const ys = (v: number) => padT + innerH - (v / maxVal) * innerH;

  const linePath = values.map((v, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${xs(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${xs(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const gridRatios = [0, 0.25, 0.5, 0.75, 1];
  const xTickEvery = Math.max(1, Math.ceil(n / 10));
  const focusIdx = hoverIdx ?? activeIdx;

  return (
    <div className="relative select-none">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="salesAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLOR} stopOpacity="0.22" />
            <stop offset="85%" stopColor={CHART_COLOR} stopOpacity="0.03" />
          </linearGradient>
        </defs>

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

        {/* エリア塗り */}
        <path d={areaPath} fill="url(#salesAreaGrad)" />

        {/* ライン */}
        <path
          d={linePath}
          fill="none"
          stroke={CHART_COLOR}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* クロスヘア */}
        {focusIdx !== null && (
          <line
            x1={xs(focusIdx)} x2={xs(focusIdx)}
            y1={padT} y2={padT + innerH}
            stroke={CHART_COLOR} strokeWidth={1} strokeDasharray="4 3" opacity={0.45}
          />
        )}

        {/* ポイント */}
        {values.map((v, i) => {
          const isActive = activeIdx === i;
          const isHover = hoverIdx === i;
          if (!isActive && !isHover && n > 25) return null;
          return (
            <circle
              key={i}
              cx={xs(i)} cy={ys(v)}
              r={isActive ? 6 : isHover ? 5 : 3}
              fill={isActive ? "#1d4ed8" : CHART_COLOR}
              stroke="white"
              strokeWidth={2}
            />
          );
        })}

        {/* X軸ラベル */}
        {labels.map((l, i) =>
          i % xTickEvery === 0 || i === n - 1 ? (
            <text key={i} x={xs(i)} y={height - 8} textAnchor="middle" fontSize={10} fill="#94a3b8">
              {l}
            </text>
          ) : null
        )}

        {/* インタラクション領域 */}
        {labels.map((_, i) => {
          const left = i === 0 ? padL : (xs(i) + xs(i - 1)) / 2;
          const right = i === n - 1 ? W - padR : (xs(i) + xs(i + 1)) / 2;
          return (
            <rect
              key={i}
              x={left} y={padT}
              width={right - left} height={innerH}
              fill="transparent"
              style={{ cursor: onPointClick ? "pointer" : "default" }}
              onMouseEnter={() => setHoverIdx(i)}
              onClick={() => onPointClick?.(i)}
            />
          );
        })}
      </svg>

      {/* ツールチップ */}
      {focusIdx !== null && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]/95 px-5 py-2.5 shadow-xl backdrop-blur-sm text-center whitespace-nowrap">
          <p className="text-xs text-[color:var(--color-text-muted)] mb-0.5">
            {(tooltipLabels ?? labels)[focusIdx]}
          </p>
          <p className="text-lg font-bold text-[color:var(--color-text-primary)] tabular-nums">
            ¥{values[focusIdx].toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

// ===== KPI Card =====
function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-[color:var(--color-bg-card)] border border-black p-4 shadow-sm">
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
  const [customerInfoMap, setCustomerInfoMap] = useState<Map<string, CustomerTableInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const [startDate, setStartDate] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [endDate, setEndDate] = useState<string>(() => formatDate(new Date()));

  const period = useMemo<Period>(() => {
    const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
    if (days <= 14) return "daily";
    if (days <= 90) return "weekly";
    return "monthly";
  }, [startDate, endDate]);

  useEffect(() => { setDetailKey(null); }, [startDate, endDate]);

  useEffect(() => {
    if (role !== "owner") router.replace("/admin/orders");
  }, [role, router]);

  useEffect(() => {
    if (startDate > endDate) return;
    setLoading(true);
    let cancelled = false;
    async function fetchData() {
      try {
        const start = Timestamp.fromDate(new Date(startDate + "T00:00:00"));
        const end = Timestamp.fromDate(new Date(endDate + "T23:59:59.999"));
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
            const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.id)));
            return {
              ...order,
              items: itemsSnap.docs.map((d) => normalizeOrderItem(d.id, d.data() as Record<string, unknown>)),
            };
          })
        );
        if (cancelled) return;
        setOrders(withItems);
        const ids = [...new Set(orderDocs.map((o) => o.customerId))];
        const ctMap = await fetchCustomerTableInfo(ids);
        if (cancelled) return;
        setCustomerInfoMap(ctMap);
      } catch (e) {
        if (!cancelled) console.error("[sales] fetchData failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  const isDateRangeValid = useMemo(() => startDate <= endDate, [startDate, endDate]);

  const filteredOrders = useMemo(() => {
    if (!isDateRangeValid) return [];
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T23:59:59.999");
    return orders.filter((o) => {
      const d = o.createdAt?.toDate?.();
      return !!d && d >= start && d <= end;
    });
  }, [orders, isDateRangeValid, startDate, endDate]);

  const buckets: Bucket[] = useMemo(() => {
    const map = new Map<string, Bucket>();
    for (const o of filteredOrders) {
      const date = o.createdAt?.toDate?.();
      if (!date) continue;
      const key = bucketKey(date, period);
      const b = map.get(key) ?? { key, label: shortLabel(key, period), rangeLabel: rangeLabel(key, period), revenue: 0, count: 0 };
      b.revenue += orderTotal(o);
      b.count += 1;
      map.set(key, b);
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [filteredOrders, period]);

  const kpi = useMemo(() => {
    const revenue = filteredOrders.reduce((s, o) => s + orderTotal(o), 0);
    const count = filteredOrders.length;
    const days = isDateRangeValid
      ? Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1
      : 1;
    const dailyAvgRevenue = days > 0 ? Math.round(revenue / days) : 0;
    const dailyAvgCount = days > 0 ? Math.round((count / days) * 10) / 10 : 0;
    const sessionMap = new Map<string, { revenue: number; guestCount: number }>();
    for (const o of filteredOrders) {
      if (!o.customerId) continue;
      const s = sessionMap.get(o.customerId) ?? { revenue: 0, guestCount: customerInfoMap.get(o.customerId)?.guestCount ?? 0 };
      s.revenue += orderTotal(o);
      sessionMap.set(o.customerId, s);
    }
    const sessions = Array.from(sessionMap.values());
    const totalGuests = sessions.reduce((s, sess) => s + sess.guestCount, 0);
    const totalGuestRevenue = sessions.reduce((s, sess) => s + sess.revenue, 0);
    const guestAtv = totalGuests === 0 ? null : Math.round(totalGuestRevenue / totalGuests);
    return { revenue, count, dailyAvgRevenue, dailyAvgCount, guestAtv };
  }, [filteredOrders, isDateRangeValid, startDate, endDate, customerInfoMap]);

  const tableBreakdown = useMemo(() => {
    const map = new Map<string, { table: string; count: number; revenue: number }>();
    for (const o of filteredOrders) {
      const t = customerInfoMap.get(o.customerId)?.tableNumber ?? "";
      const e = map.get(t) ?? { table: t, count: 0, revenue: 0 };
      e.count++;
      e.revenue += orderTotal(o);
      map.set(t, e);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredOrders, customerInfoMap]);

  const detail = useMemo(() => {
    if (!detailKey) return null;
    const filtered = filteredOrders.filter((o) => {
      const d = o.createdAt?.toDate?.();
      return !!d && bucketKey(d, period) === detailKey;
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
    const rl = buckets.find((b) => b.key === detailKey)?.rangeLabel ?? detailKey;
    return { label: rl, count, revenue, atv, breakdown };
  }, [detailKey, filteredOrders, period, buckets]);

  if (role !== "owner") return null;
  if (loading) return <PageLoader />;

  const yen = (v: number) => `¥${v.toLocaleString()}`;
  const todayISO = formatDate(new Date());
  const maxTableRevenue = tableBreakdown.reduce((m, t) => Math.max(m, t.revenue), 1);

  function applyPreset(preset: "today" | "week" | "month" | "lastMonth") {
    const now = new Date();
    if (preset === "today") {
      setStartDate(formatDate(now)); setEndDate(formatDate(now));
    } else if (preset === "week") {
      setStartDate(formatDate(getWeekStart(now))); setEndDate(formatDate(now));
    } else if (preset === "month") {
      setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
      setEndDate(formatDate(now));
    } else {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(formatDate(s)); setEndDate(formatDate(e));
    }
  }

  function isPresetActive(preset: "today" | "week" | "month" | "lastMonth"): boolean {
    const now = new Date();
    if (preset === "today") return startDate === formatDate(now) && endDate === formatDate(now);
    if (preset === "week") return startDate === formatDate(getWeekStart(now)) && endDate === todayISO;
    if (preset === "month") {
      const s = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      return startDate === s && endDate === todayISO;
    }
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const e = new Date(now.getFullYear(), now.getMonth(), 0);
    return startDate === formatDate(s) && endDate === formatDate(e);
  }

  const presets = [
    { label: "今日", key: "today" },
    { label: "今週", key: "week" },
    { label: "今月", key: "month" },
    { label: "先月", key: "lastMonth" },
  ] as const;

  const periodLabel = period === "daily" ? "日次" : period === "weekly" ? "週次" : "月次";

  return (
    <div className="w-full flex flex-col gap-4 pb-6">
      <AdminPageHeader title="売上分析" />

      {/* 期間選択 */}
      <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-black px-4 py-3 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {presets.map(({ label, key }) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isPresetActive(key)
                  ? "bg-[color:var(--color-accent-char)] text-white"
                  : "border border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <DatePicker value={startDate} onChange={setStartDate} max={todayISO} />
          <span className="text-xs text-[color:var(--color-text-muted)]">〜</span>
          <DatePicker value={endDate} onChange={setEndDate} max={todayISO} />
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label="合計売上"
          value={yen(kpi.revenue)}
          sub={`1日平均 ${yen(kpi.dailyAvgRevenue)}`}
        />
        <KpiCard
          label="注文数"
          value={`${kpi.count.toLocaleString()}件`}
          sub={`1日平均 ${kpi.dailyAvgCount}件`}
        />
        <KpiCard
          label="客単価"
          value={kpi.guestAtv !== null ? yen(kpi.guestAtv) : "−"}
        />
      </div>

      {/* 売上推移チャート */}
      <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-black px-4 pt-4 pb-2 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-[color:var(--color-text-primary)]">売上推移</h2>
          <span className="text-xs text-[color:var(--color-text-muted)] bg-[color:var(--color-bg-subtle)] px-2 py-1 rounded-full">
            {periodLabel}
          </span>
        </div>

        {!isDateRangeValid ? (
          <p className="text-sm text-[color:var(--color-accent-warn)] py-12 text-center">
            開始日が終了日より後になっています
          </p>
        ) : filteredOrders.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)] py-12 text-center">
            この期間のデータがありません
          </p>
        ) : (
          <AreaChart
            labels={buckets.map((b) => b.label)}
            tooltipLabels={buckets.map((b) => b.rangeLabel)}
            values={buckets.map((b) => b.revenue)}
            activeIdx={detailKey ? buckets.findIndex((b) => b.key === detailKey) : null}
            onPointClick={(i) =>
              setDetailKey((cur) => cur === buckets[i].key ? null : buckets[i].key)
            }
            height={220}
          />
        )}
      </div>

      {/* 詳細 or テーブル別 */}
      {detail ? (
        /* 期間詳細ドリルダウン */
        <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-black p-4 shadow-sm">
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
              <p className="text-xs text-[color:var(--color-text-muted)] mb-1">テーブル単価</p>
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
      ) : (
        /* テーブル別売上 */
        <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-black p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[color:var(--color-text-primary)]">テーブル別売上</h3>
            <span className="text-xs text-[color:var(--color-text-muted)]">グラフをタップで期間詳細</span>
          </div>

          {tableBreakdown.length === 0 ? (
            <p className="text-xs text-[color:var(--color-text-muted)] py-4 text-center">データがありません</p>
          ) : (
            <div className="space-y-3">
              {tableBreakdown.map((t) => {
                const barPct = Math.round((t.revenue / maxTableRevenue) * 100);
                const totalPct = kpi.revenue > 0 ? ((t.revenue / kpi.revenue) * 100).toFixed(1) : "0.0";
                return (
                  <div key={t.table} className="flex items-center gap-3">
                    <span className="w-10 shrink-0 text-center text-sm font-bold text-[color:var(--color-text-primary)]">
                      {t.table}
                    </span>
                    <div className="flex-1 h-5 rounded-full bg-[color:var(--color-bg-subtle)] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${barPct}%`, backgroundColor: CHART_COLOR, opacity: 0.8 }}
                      />
                    </div>
                    <span className="shrink-0 w-24 text-right text-sm font-semibold text-[color:var(--color-text-primary)] tabular-nums">
                      {yen(t.revenue)}
                    </span>
                    <span className="shrink-0 w-10 text-right text-xs text-[color:var(--color-text-muted)] tabular-nums">
                      {t.count}件
                    </span>
                    <span className="shrink-0 w-12 text-right text-xs text-[color:var(--color-accent-char)] font-medium tabular-nums">
                      {totalPct}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
