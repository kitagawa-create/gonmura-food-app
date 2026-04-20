"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/PageLoader";
import {
  Timestamp,
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Category, Customer, Menu, OrderWithItems } from "@/types";
import { normalizeMenu, normalizeOrder, normalizeOrderItem } from "@/lib/order-utils";
import { useAdminRole } from "@/components/admin/AdminContext";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { comboLineTotal, flattenForReceipt } from "@/lib/order-utils";

type Period = "daily" | "weekly" | "monthly";
type Analysis = "sales" | "menu" | "dow";

const BLUE = "#3b82f6";
const DOW_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

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

type Bucket = { key: string; label: string; rangeLabel: string; revenue: number; count: number };
type Series = {
  name: string;
  color: string;
  values: number[];
  formatValue: (v: number) => string;
};

function LineChart({
  labels,
  tooltipLabels,
  series,
  height = 240,
  activeIdx = null,
  onPointClick,
}: {
  labels: string[];
  tooltipLabels?: string[];
  series: Series[];
  height?: number;
  activeIdx?: number | null;
  onPointClick?: (i: number) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const padL = 12, padR = 12, padT = 16, padB = 28;
  const W = 800;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const n = labels.length;
  if (n === 0) return null;

  const xs = (i: number) =>
    n === 1 ? padL + innerW / 2 : padL + (i * innerW) / (n - 1);
  const maxPerSeries = series.map((s) => Math.max(...s.values, 1));

  function seriesPath(values: number[], idx: number): string {
    const max = maxPerSeries[idx];
    return values
      .map((v, i) => {
        const y = padT + innerH - (v / max) * innerH;
        return `${i === 0 ? "M" : "L"}${xs(i).toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }
  const xTickEvery = Math.max(1, Math.ceil(n / 10));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0.25, 0.5, 0.75].map((p) => (
          <line
            key={p}
            x1={padL}
            x2={W - padR}
            y1={padT + innerH * p}
            y2={padT + innerH * p}
            stroke="#e2e8f0"
            strokeDasharray="3 3"
          />
        ))}
        {series.map((s, idx) => (
          <g key={s.name}>
            <path
              d={seriesPath(s.values, idx)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
            />
            {s.values.map((v, i) => {
              const y = padT + innerH - (v / maxPerSeries[idx]) * innerH;
              const active = activeIdx === i;
              return (
                <circle
                  key={i}
                  cx={xs(i)}
                  cy={y}
                  r={active ? 5 : hoverIdx === i ? 4 : 2.5}
                  fill={s.color}
                  stroke={active ? "#1a2332" : undefined}
                  strokeWidth={active ? 2 : 0}
                />
              );
            })}
          </g>
        ))}
        {hoverIdx !== null && (
          <line
            x1={xs(hoverIdx)}
            x2={xs(hoverIdx)}
            y1={padT}
            y2={padT + innerH}
            stroke="#cbd5e1"
            strokeWidth={1}
          />
        )}
        {labels.map((l, i) =>
          i % xTickEvery === 0 || i === n - 1 ? (
            <text
              key={i}
              x={xs(i)}
              y={height - 10}
              textAnchor="middle"
              fontSize={10}
              fill="#6b7b8d"
            >
              {l}
            </text>
          ) : null
        )}
        {labels.map((_, i) => {
          const left = i === 0 ? padL : (xs(i) + xs(i - 1)) / 2;
          const right = i === n - 1 ? W - padR : (xs(i) + xs(i + 1)) / 2;
          return (
            <rect
              key={i}
              x={left}
              y={padT}
              width={right - left}
              height={innerH}
              fill="transparent"
              style={{ cursor: onPointClick ? "pointer" : "default" }}
              onMouseEnter={() => setHoverIdx(i)}
              onClick={() => onPointClick?.(i)}
            />
          );
        })}
      </svg>
      {hoverIdx !== null && (
        <div className="pointer-events-none absolute top-2 right-2 rounded-lg border border-black bg-[color:var(--color-bg-card)]/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
          <div className="text-[color:var(--color-text-muted)] mb-1">
            {(tooltipLabels ?? labels)[hoverIdx]}
          </div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-[color:var(--color-text-primary)]">
                {s.name}
              </span>
              <span className="ml-auto tabular-nums font-medium text-[color:var(--color-text-primary)]">
                {s.formatValue(s.values[hoverIdx])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BarChart({
  items,
}: {
  items: { label: string; value: number; color: string; sub?: string; format?: (v: number) => string }[];
}) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="flex flex-col gap-2 pr-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 text-xs">
          <div
            className="w-28 shrink-0 text-right text-[color:var(--color-text-muted)] truncate text-[11px]"
            title={item.label}
          >
            {item.label}
          </div>
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <div className="flex-1 h-5 rounded-full bg-[color:var(--color-bg-subtle)] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(item.value / max) * 100}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
            <div className="w-24 shrink-0 text-right">
              <span className="tabular-nums font-medium text-[color:var(--color-text-primary)]">
                {item.format ? item.format(item.value) : `${item.value}個`}
              </span>
              {item.sub && (
                <span className="block text-[10px] text-[color:var(--color-text-muted)]">
                  {item.sub}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl bg-[color:var(--color-bg-card)] border border-black p-3 shadow-sm">
      <p className="text-xs text-[color:var(--color-text-muted)]">{label}</p>
      <p className="text-xl font-bold text-[color:var(--color-text-primary)] tabular-nums mt-0.5">
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-[color:var(--color-text-muted)] mt-0.5">
          {sub}
        </p>
      )}
    </div>
  );
}

export default function AdminSalesPage() {
  const role = useAdminRole();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<Analysis>("sales");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // 日付範囲 (今月1日〜今日をデフォルト)
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

  useEffect(() => {
    setDetailKey(null);
  }, [analysis, startDate, endDate]);

  useEffect(() => {
    if (role !== "owner") router.replace("/admin/orders");
  }, [role, router]);

  useEffect(() => {
    if (startDate > endDate) return;
    setLoading(true);
    async function fetchData() {
      try {
        const start = Timestamp.fromDate(new Date(startDate + "T00:00:00"));
        const end = Timestamp.fromDate(new Date(endDate + "T23:59:59.999"));
        const [ordersSnap, customersSnap] = await Promise.all([
          getDocs(query(
            collection(db, "orders"),
            where("status", "==", "paid"),
            where("createdAt", ">=", start),
            where("createdAt", "<=", end),
            orderBy("createdAt"),
          )),
          getDocs(collection(db, "customers")),
        ]);
        const orderDocs = ordersSnap.docs.map((d) =>
          normalizeOrder(d.id, d.data() as Record<string, unknown>)
        );
        const withItems = await Promise.all(
          orderDocs.map(async (order) => {
            const itemsSnap = await getDocs(collection(db, "orders", order.id, "items"));
            return {
              ...order,
              items: itemsSnap.docs.map((d) =>
                normalizeOrderItem(d.id, d.data() as Record<string, unknown>)
              ),
            };
          })
        );
        setOrders(withItems);
        setCustomers(customersSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Customer));
      } catch (e) {
        console.error("[sales] fetchData failed:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [startDate, endDate]);

  useEffect(() => {
    const unsubCats = onSnapshot(
      query(collection(db, "categories"), orderBy("sortOrder", "asc")),
      (snap) =>
        setCategories(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Category, "id">),
          }))
        )
    );
    const unsubMenus = onSnapshot(collection(db, "menus"), (snap) =>
      setMenus(
        snap.docs.map((d) => normalizeMenu(d.id, d.data() as Record<string, unknown>))
      )
    );
    return () => {
      unsubCats();
      unsubMenus();
    };
  }, []);

  const menuNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) {
      for (const it of flattenForReceipt(o.items)) {
        if (it.name) m.set(it.menuId, it.name);
      }
    }
    for (const menu of menus) {
      if (menu.name) m.set(menu.id, menu.name);
    }
    return m;
  }, [orders, menus]);

  const menuCategoryMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const menu of menus) m.set(menu.id, menu.categoryIds ?? []);
    return m;
  }, [menus]);

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
      const b = map.get(key) ?? {
        key,
        label: shortLabel(key, period),
        rangeLabel: rangeLabel(key, period),
        revenue: 0,
        count: 0,
      };
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
      const customer = customers.find((c) => c.id === o.customerId);
      if (!customer) continue;
      const s = sessionMap.get(o.customerId) ?? {
        revenue: 0,
        guestCount: customer.guestCount,
      };
      s.revenue += orderTotal(o);
      sessionMap.set(o.customerId, s);
    }
    const sessions = Array.from(sessionMap.values());
    const totalGuests = sessions.reduce((s, sess) => s + sess.guestCount, 0);
    const totalGuestRevenue = sessions.reduce((s, sess) => s + sess.revenue, 0);
    const guestAtv = totalGuests === 0 ? null : Math.round(totalGuestRevenue / totalGuests);
    return { revenue, count, dailyAvgRevenue, dailyAvgCount, guestAtv };
  }, [filteredOrders, customers, isDateRangeValid, startDate, endDate]);

  const menuBarItems = useMemo(() => {
    const map = new Map<string, { menuId: string; name: string; qty: number }>();
    for (const o of filteredOrders) {
      for (const it of flattenForReceipt(o.items)) {
        const e = map.get(it.menuId) ?? { menuId: it.menuId, name: it.name, qty: 0 };
        e.qty += it.quantity;
        e.name = menuNameMap.get(it.menuId) ?? it.name;
        map.set(it.menuId, e);
      }
    }
    let all = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
    if (categoryFilter !== "all") {
      all = all.filter((m) =>
        (menuCategoryMap.get(m.menuId) ?? []).includes(categoryFilter)
      );
    }
    return all.map((m) => ({ label: m.name, value: m.qty, color: BLUE }));
  }, [filteredOrders, categoryFilter, menuCategoryMap, menuNameMap]);

  // 時間帯×曜日ヒートマップ [hour0-23][dow0-6(月〜日)] = 注文数
  const heatmapData = useMemo(() => {
    const grid = Array.from({ length: 24 }, () => Array(7).fill(0) as number[]);
    for (const o of filteredOrders) {
      const d = o.createdAt?.toDate?.();
      if (!d) continue;
      const dow = (d.getDay() + 6) % 7;
      grid[d.getHours()][dow]++;
    }
    return grid;
  }, [filteredOrders]);

  const customerByIdMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const tableBreakdown = useMemo(() => {
    if (analysis !== "sales") return [];
    const map = new Map<number, { table: number; count: number; revenue: number }>();
    for (const o of filteredOrders) {
      const t = customerByIdMap.get(o.customerId)?.tableNumber ?? 0;
      const e = map.get(t) ?? { table: t, count: 0, revenue: 0 };
      e.count++;
      e.revenue += orderTotal(o);
      map.set(t, e);
    }
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((e) => ({ ...e, atv: e.count === 0 ? 0 : Math.round(e.revenue / e.count) }));
  }, [analysis, filteredOrders, customerByIdMap]);

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
    const label = buckets.find((b) => b.key === detailKey)?.label ?? detailKey;
    const rl = buckets.find((b) => b.key === detailKey)?.rangeLabel ?? detailKey;
    return { label: rl, count, revenue, atv, breakdown };
  }, [detailKey, filteredOrders, period, buckets]);

  if (role !== "owner") return null;
  if (loading) return <PageLoader />;

  const yen = (v: number) => `¥${v.toLocaleString()}`;

  const selectCls =
    "bg-[color:var(--color-bg-base)] border border-black rounded-lg px-2 py-1 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]";

  const todayISO = formatDate(new Date());

  const sectionTitle =
    analysis === "sales" ? "売上推移"
    : analysis === "menu" ? "メニュー別売数"
    : "曜日・時間帯";

  return (
    <div className="w-full flex flex-col gap-3 h-[calc(100dvh-24px)] md:h-[calc(100dvh-48px)]">
      <AdminPageHeader
        title="売上分析"
        className="relative z-30 shrink-0"
        rightSlot={
          <div className="relative">
            <button
              onClick={() => setAnalysisOpen((o) => !o)}
              className={`${selectCls} flex items-center gap-2 min-w-[120px] justify-between`}
            >
              <span>{analysis === "sales" ? "売上推移" : analysis === "menu" ? "メニュー別売数" : "曜日・時間帯"}</span>
              <span className="text-[10px] text-[color:var(--color-text-muted)]">▼</span>
            </button>
            {analysisOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg shadow-lg overflow-hidden min-w-[140px]"
                onMouseLeave={() => setAnalysisOpen(false)}
              >
                {(["sales", "menu", "dow"] as Analysis[]).map((val, i) => (
                  <div key={val}>
                    {i > 0 && <hr className="border-[color:var(--color-border)] my-0" />}
                    <button
                      onClick={() => { setAnalysis(val); setAnalysisOpen(false); }}
                      className={`w-full text-left px-3 py-1 text-sm hover:bg-[color:var(--color-bg-subtle)] ${analysis === val ? "font-medium text-[color:var(--color-accent-char)]" : "text-[color:var(--color-text-primary)]"}`}
                    >
                      {val === "sales" ? "売上推移" : val === "menu" ? "メニュー別売数" : "曜日・時間帯"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        }
      />

      {/* 期間 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 shrink-0 bg-[color:var(--color-bg-card)] rounded-xl border border-black px-4 py-2.5 shadow-sm">
        <span className="text-xs text-[color:var(--color-text-muted)]">開始</span>
        <input
          type="date"
          value={startDate}
          max={todayISO}
          onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value <= todayISO) setStartDate(e.target.value); }}
          onKeyDown={(e) => e.preventDefault()}
          className={selectCls}
        />
        <span className="text-xs text-[color:var(--color-text-muted)]">〜</span>
        <input
          type="date"
          value={endDate}
          max={todayISO}
          onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value <= todayISO) setEndDate(e.target.value); }}
          onKeyDown={(e) => e.preventDefault()}
          className={selectCls}
        />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-2 shrink-0">
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

      <section className="rounded-xl bg-[color:var(--color-bg-card)] border border-black p-4 flex flex-col flex-1 min-h-0 overflow-hidden shadow-sm">
        <div className="flex items-baseline gap-2 mb-3 shrink-0">
          <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">
            {sectionTitle}
          </h2>
          {analysis === "dow" && (
            <span className="text-xs text-[color:var(--color-text-muted)]">単位: 注文件数</span>
          )}
        </div>

        {/* メニュー別: カテゴリフィルター */}
        {analysis === "menu" && categories.length > 0 && (
          <div className="mb-3 flex gap-1.5 overflow-x-auto no-scrollbar pb-1 shrink-0">
            <button
              onClick={() => setCategoryFilter("all")}
              className={`shrink-0 min-h-[36px] rounded-full px-3 py-1 text-xs border transition-colors ${
                categoryFilter === "all"
                  ? "bg-[color:var(--color-accent-char)] text-white border-transparent"
                  : "bg-[color:var(--color-bg-card)] text-[color:var(--color-text-primary)] border-[color:var(--color-border)] hover:bg-[color:var(--color-bg-subtle)]"
              }`}
            >
              すべて
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryFilter(c.id)}
                className={`shrink-0 min-h-[36px] rounded-full px-3 py-1 text-xs border transition-colors ${
                  categoryFilter === c.id
                    ? "bg-[color:var(--color-accent-char)] text-white border-transparent"
                    : "bg-[color:var(--color-bg-card)] text-[color:var(--color-text-primary)] border-[color:var(--color-border)] hover:bg-[color:var(--color-bg-subtle)]"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* 期間エラー or データなし */}
        {!isDateRangeValid ? (
          <p className="text-sm text-[color:var(--color-accent-warn)] py-10 text-center">
            開始日が終了日より後になっています
          </p>
        ) : filteredOrders.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)] py-10 text-center">
            この期間のデータがありません
          </p>
        ) : analysis === "menu" ? (
          /* ===== メニュー別棒グラフ ===== */
          <div className="flex-1 min-h-0 overflow-y-auto -mr-4 pr-2 [scrollbar-gutter:stable]">
            {menuBarItems.length === 0 ? (
              <p className="text-sm text-[color:var(--color-text-muted)] py-10 text-center">
                該当メニューがありません
              </p>
            ) : (
              <BarChart items={menuBarItems} />
            )}
          </div>
        ) : analysis === "dow" ? (
          /* ===== 時間帯×曜日ヒートマップ ===== */
          (() => {
            const maxVal = Math.max(...heatmapData.flatMap((r) => r), 1);
            const colTotals = DOW_LABELS.map((_, d) =>
              heatmapData.reduce((s, row) => s + row[d], 0)
            );
            return (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {/* 凡例バー */}
                <div className="flex items-center gap-2 mb-2 shrink-0">
                  <span className="text-xs text-[color:var(--color-text-muted)]">少</span>
                  <div className="h-3 w-32 rounded-sm" style={{ background: "linear-gradient(to right, rgba(59,130,246,0.1), rgba(59,130,246,0.8))" }} />
                  <span className="text-xs text-[color:var(--color-text-muted)]">多</span>
                </div>
              <div className="flex-1 min-h-0 overflow-auto pb-2 -mr-4 pr-2 [scrollbar-gutter:stable]">
                <table className="text-xs tabular-nums min-w-full" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-[color:var(--color-bg-card)] w-10 py-1 text-center font-normal text-[color:var(--color-text-muted)]" style={{ border: "1px solid #000" }}>時</th>
                      {DOW_LABELS.map((d) => (
                        <th
                          key={d}
                          className="w-12 py-1 text-center font-medium text-[color:var(--color-text-primary)]"
                          style={{ border: "1px solid #000" }}
                        >
                          {d}
                        </th>
                      ))}
                      <th className="w-12 py-1 text-center font-normal text-[color:var(--color-text-muted)]" style={{ border: "1px solid #000" }}>計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapData.map((row, h) => {
                      const rowTotal = row.reduce((s, v) => s + v, 0);
                      return (
                        <tr key={h}>
                          <td className="sticky left-0 bg-[color:var(--color-bg-card)] text-center text-[color:var(--color-text-muted)] py-0.5 pr-1" style={{ border: "1px solid #000" }}>
                            {h}
                          </td>
                          {row.map((val, d) => (
                            <td
                              key={d}
                              className="text-center py-0.5"
                              style={{
                                border: "1px solid #000",
                                backgroundColor:
                                  val === 0
                                    ? undefined
                                    : `rgba(59,130,246,${0.1 + 0.7 * (val / maxVal)})`,
                                color: val / maxVal > 0.6 ? "#fff" : undefined,
                              }}
                            >
                              {val > 0 ? val : ""}
                            </td>
                          ))}
                          <td className="text-center font-medium text-[color:var(--color-text-muted)] py-0.5" style={{ border: "1px solid #000" }}>
                            {rowTotal > 0 ? rowTotal : ""}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="sticky left-0 bg-[color:var(--color-bg-card)] text-center text-[color:var(--color-text-muted)] py-1" style={{ border: "1px solid #000" }}>計</td>
                      {colTotals.map((t, i) => (
                        <td key={i} className="text-center font-medium text-[color:var(--color-text-primary)] py-1" style={{ border: "1px solid #000" }}>
                          {t > 0 ? t : ""}
                        </td>
                      ))}
                      <td className="text-center font-bold text-[color:var(--color-text-primary)] py-1" style={{ border: "1px solid #000" }}>
                        {colTotals.reduce((s, v) => s + v, 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              </div>
            );
          })()
        ) : (
          /* ===== 売上推移 ===== */
          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            <div className="shrink-0">
              <LineChart
                labels={buckets.map((b) => b.label)}
                tooltipLabels={buckets.map((b) => b.rangeLabel)}
                series={[
                  {
                    name: "売上",
                    color: BLUE,
                    values: buckets.map((b) => b.revenue),
                    formatValue: yen,
                  },
                ]}
                activeIdx={
                  detailKey
                    ? buckets.findIndex((b) => b.key === detailKey)
                    : null
                }
                onPointClick={(i) =>
                  setDetailKey((cur) =>
                    cur === buckets[i].key ? null : buckets[i].key
                  )
                }
                height={180}
              />
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {detail ? (
                /* 期間詳細ドリルダウン */
                <div className="flex-1 min-h-0 rounded-lg bg-[color:var(--color-bg-subtle)] border border-black p-3 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between mb-2 shrink-0">
                    <h3 className="text-sm font-bold text-[color:var(--color-text-primary)]">
                      {detail.label} の詳細
                    </h3>
                    <button
                      onClick={() => setDetailKey(null)}
                      className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
                    >
                      閉じる
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3 text-xs shrink-0">
                    <div>
                      <p className="text-[color:var(--color-text-muted)]">売上</p>
                      <p className="text-[color:var(--color-text-primary)] font-bold tabular-nums">
                        {yen(detail.revenue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[color:var(--color-text-muted)]">注文数</p>
                      <p className="text-[color:var(--color-text-primary)] font-bold tabular-nums">
                        {detail.count}件
                      </p>
                    </div>
                    <div>
                      <p className="text-[color:var(--color-text-muted)]">テーブル単価</p>
                      <p className="text-[color:var(--color-text-primary)] font-bold tabular-nums">
                        {yen(detail.atv)}
                      </p>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto -mr-4 pr-2 [scrollbar-gutter:stable]">
                    <table className="w-full text-xs tabular-nums">
                      <thead className="text-[color:var(--color-text-muted)] sticky top-0 bg-[color:var(--color-bg-subtle)]">
                        <tr>
                          <th className="text-left font-normal py-1">メニュー</th>
                          <th className="text-right font-normal py-1 w-16">数量</th>
                          <th className="text-right font-normal py-1 w-24">売上</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.breakdown.map((m) => (
                          <tr
                            key={m.name}
                            className="border-t border-[color:var(--color-border)]"
                          >
                            <td className="py-1 text-[color:var(--color-text-primary)] truncate pr-2">
                              {m.name}
                            </td>
                            <td className="py-1 text-right text-[color:var(--color-text-primary)]">
                              {m.qty}個
                            </td>
                            <td className="py-1 text-right text-[color:var(--color-text-primary)]">
                              {yen(m.revenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                /* テーブル別売上 */
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {tableBreakdown.length === 0 ? (
                    <p className="text-xs text-[color:var(--color-text-muted)]">
                      データがありません
                    </p>
                  ) : (
                    <>
                    <table className="w-full table-fixed text-xs tabular-nums shrink-0">
                      <thead>
                        <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-text-muted)]">
                          <th className="text-left font-normal py-1.5 w-1/4">テーブル</th>
                          <th className="text-right font-normal py-1.5 w-1/4">注文数</th>
                          <th className="text-right font-normal py-1.5 w-1/4">合計売上</th>
                          <th className="text-right font-normal py-1.5 w-1/4">テーブル単価</th>
                        </tr>
                      </thead>
                    </table>
                    <div className="flex-1 min-h-0 overflow-y-auto -mr-4 pr-2 [scrollbar-gutter:stable]">
                      <table className="w-full table-fixed text-xs tabular-nums">
                        <tbody>
                          {tableBreakdown.map((t) => (
                            <tr
                              key={t.table}
                              className="border-t border-[color:var(--color-border)]"
                            >
                              <td className="py-1.5 w-1/4 text-[color:var(--color-text-primary)]">
                                No.{t.table}
                              </td>
                              <td className="py-1.5 w-1/4 text-right text-[color:var(--color-text-primary)]">
                                {t.count}件
                              </td>
                              <td className="py-1.5 w-1/4 text-right text-[color:var(--color-text-primary)]">
                                {yen(t.revenue)}
                              </td>
                              <td className="py-1.5 w-1/4 text-right font-medium text-[color:var(--color-accent-char)]">
                                {yen(t.atv)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </>
                  )}
                  <p className="text-[11px] text-[color:var(--color-text-muted)] mt-2 shrink-0">
                    グラフのポイントをタップするとその期間の詳細が見られます
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
