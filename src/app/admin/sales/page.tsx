"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/PageLoader";
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Category, Menu, Order } from "@/types";
import { useAdminRole } from "@/components/admin/AdminContext";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { comboLineTotal, flattenForReceipt } from "@/lib/order-utils";

type Period = "daily" | "weekly" | "monthly";
type Analysis = "sales" | "menu" | "dow";

const BLUE = "#3b82f6";
const DOW_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
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
function orderTotal(o: Order): number {
  return o.items.reduce((s, i) => s + comboLineTotal(i), 0);
}

type Bucket = { key: string; label: string; revenue: number; count: number };
type Series = {
  name: string;
  color: string;
  values: number[];
  formatValue: (v: number) => string;
};

function LineChart({
  labels,
  series,
  height = 240,
  activeIdx = null,
  onPointClick,
}: {
  labels: string[];
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
        <div className="pointer-events-none absolute top-2 right-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
          <div className="text-[color:var(--color-text-muted)] mb-1">
            {labels[hoverIdx]}
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
    <div className="rounded-xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-3 shadow-sm">
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<Analysis>("sales");
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // 日付範囲 (今月1日〜今日をデフォルト)
  const [startYear, setStartYear] = useState(() => new Date().getFullYear());
  const [startMonth, setStartMonth] = useState(() => new Date().getMonth() + 1);
  const [startDay, setStartDay] = useState<number>(1);
  const [endYear, setEndYear] = useState(() => new Date().getFullYear());
  const [endMonth, setEndMonth] = useState(() => new Date().getMonth() + 1);
  const [endDay, setEndDay] = useState(() => new Date().getDate());

  const period = useMemo<Period>(() => {
    const start = new Date(startYear, startMonth - 1, startDay);
    const end = new Date(endYear, endMonth - 1, endDay);
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    if (days <= 14) return "daily";
    if (days <= 90) return "weekly";
    return "monthly";
  }, [startYear, startMonth, startDay, endYear, endMonth, endDay]);

  // 月変更時に日を上限でクランプ
  useEffect(() => {
    const max = getDaysInMonth(startYear, startMonth);
    if (startDay > max) setStartDay(max);
  }, [startYear, startMonth, startDay]);

  useEffect(() => {
    const max = getDaysInMonth(endYear, endMonth);
    if (endDay > max) setEndDay(max);
  }, [endYear, endMonth, endDay]);

  useEffect(() => {
    setDetailKey(null);
  }, [analysis, startYear, startMonth, startDay, endYear, endMonth, endDay]);

  useEffect(() => {
    if (role !== "owner") router.replace("/admin/orders");
  }, [role, router]);

  useEffect(() => {
    async function fetchData() {
      const snap = await getDocs(
        query(collection(db, "orders"), where("status", "==", "paid"))
      );
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order));
      setLoading(false);
    }
    fetchData();
  }, []);

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
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Menu, "id">),
        }))
      )
    );
    return () => {
      unsubCats();
      unsubMenus();
    };
  }, []);

  // 年ドロップダウン用: 最古の注文年〜今年
  const availableYears = useMemo(() => {
    const now = new Date();
    const dates = orders
      .map((o) => o.createdAt?.toDate?.())
      .filter(Boolean) as Date[];
    const minYear =
      dates.length > 0
        ? Math.min(...dates.map((d) => d.getFullYear()))
        : now.getFullYear();
    return Array.from(
      { length: now.getFullYear() - minYear + 1 },
      (_, i) => minYear + i
    );
  }, [orders]);

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

  const isDateRangeValid = useMemo(() => {
    const start = new Date(startYear, startMonth - 1, startDay);
    const end = new Date(endYear, endMonth - 1, endDay);
    return start <= end;
  }, [startYear, startMonth, startDay, endYear, endMonth, endDay]);

  const filteredOrders = useMemo(() => {
    if (!isDateRangeValid) return [];
    const start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
    const end = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
    return orders.filter((o) => {
      const d = o.createdAt?.toDate?.();
      return !!d && d >= start && d <= end;
    });
  }, [orders, isDateRangeValid, startYear, startMonth, startDay, endYear, endMonth, endDay]);

  const buckets: Bucket[] = useMemo(() => {
    const map = new Map<string, Bucket>();
    for (const o of filteredOrders) {
      const date = o.createdAt?.toDate?.();
      if (!date) continue;
      const key = bucketKey(date, period);
      const b = map.get(key) ?? {
        key,
        label: shortLabel(key, period),
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
      ? Math.round(
          (new Date(endYear, endMonth - 1, endDay).getTime() -
            new Date(startYear, startMonth - 1, startDay).getTime()) /
            86400000
        ) + 1
      : 1;
    const dailyAvgRevenue = days > 0 ? Math.round(revenue / days) : 0;
    const dailyAvgCount = days > 0 ? Math.round((count / days) * 10) / 10 : 0;
    const withGuests = filteredOrders.filter((o) => (o.guestCount ?? 0) > 0);
    const totalGuests = withGuests.reduce((s, o) => s + (o.guestCount as number), 0);
    const guestRevenue = withGuests.reduce((s, o) => s + orderTotal(o), 0);
    const guestAtv = totalGuests === 0 ? null : Math.round(guestRevenue / totalGuests);
    return { revenue, count, dailyAvgRevenue, dailyAvgCount, guestAtv };
  }, [filteredOrders, isDateRangeValid, startYear, startMonth, startDay, endYear, endMonth, endDay]);

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

  const tableBreakdown = useMemo(() => {
    if (analysis !== "sales") return [];
    const map = new Map<number, { table: number; count: number; revenue: number }>();
    for (const o of filteredOrders) {
      const t = o.tableNumber;
      const e = map.get(t) ?? { table: t, count: 0, revenue: 0 };
      e.count++;
      e.revenue += orderTotal(o);
      map.set(t, e);
    }
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((e) => ({ ...e, atv: e.count === 0 ? 0 : Math.round(e.revenue / e.count) }));
  }, [analysis, filteredOrders]);

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
    return { label, count, revenue, atv, breakdown };
  }, [detailKey, filteredOrders, period, buckets]);

  if (role !== "owner") return null;
  if (loading) return <PageLoader />;

  const yen = (v: number) => `¥${v.toLocaleString()}`;

  const selectCls =
    "bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-2 py-1 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]";

  const startDayMax = getDaysInMonth(startYear, startMonth);
  const endDayMax = getDaysInMonth(endYear, endMonth);

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
          <select
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value as Analysis)}
            className={selectCls}
          >
            <option value="sales">売上推移</option>
            <option value="menu">メニュー別売数</option>
            <option value="dow">曜日・時間帯</option>
          </select>
        }
      />

      {/* 期間 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 shrink-0 bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] px-4 py-2.5 shadow-sm">
        <span className="text-xs text-[color:var(--color-text-muted)]">開始</span>
        <select
          value={startYear}
          onChange={(e) => setStartYear(Number(e.target.value))}
          className={selectCls}
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
        <select
          value={startMonth}
          onChange={(e) => setStartMonth(Number(e.target.value))}
          className={selectCls}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{m}月</option>
          ))}
        </select>
        <select
          value={startDay}
          onChange={(e) => setStartDay(Number(e.target.value))}
          className={selectCls}
        >
          {Array.from({ length: startDayMax }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{d}日</option>
          ))}
        </select>

        <span className="text-xs text-[color:var(--color-text-muted)] px-1">〜</span>

        <select
          value={endYear}
          onChange={(e) => setEndYear(Number(e.target.value))}
          className={selectCls}
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
        <select
          value={endMonth}
          onChange={(e) => setEndMonth(Number(e.target.value))}
          className={selectCls}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{m}月</option>
          ))}
        </select>
        <select
          value={endDay}
          onChange={(e) => setEndDay(Number(e.target.value))}
          className={selectCls}
        >
          {Array.from({ length: endDayMax }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{d}日</option>
          ))}
        </select>
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

      <section className="rounded-xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-4 flex flex-col flex-1 min-h-0 overflow-hidden shadow-sm">
        <h2 className="text-lg font-bold text-[color:var(--color-text-primary)] mb-3 shrink-0">
          {sectionTitle}
        </h2>

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
          <div className="flex-1 min-h-0 overflow-y-auto">
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
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="text-xs tabular-nums border-collapse min-w-full">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-[color:var(--color-bg-card)] w-10 py-1 text-center font-normal text-[color:var(--color-text-muted)] border border-[color:var(--color-border)]">時</th>
                      {DOW_LABELS.map((d) => (
                        <th
                          key={d}
                          className="w-12 py-1 text-center font-medium text-[color:var(--color-text-primary)] border border-[color:var(--color-border)]"
                        >
                          {d}
                        </th>
                      ))}
                      <th className="w-12 py-1 text-center font-normal text-[color:var(--color-text-muted)] border border-[color:var(--color-border)]">計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapData.map((row, h) => {
                      const rowTotal = row.reduce((s, v) => s + v, 0);
                      return (
                        <tr key={h}>
                          <td className="sticky left-0 bg-[color:var(--color-bg-card)] text-center text-[color:var(--color-text-muted)] py-0.5 pr-1 border border-[color:var(--color-border)]">
                            {h}
                          </td>
                          {row.map((val, d) => (
                            <td
                              key={d}
                              className="text-center py-0.5 border border-[color:var(--color-border)]"
                              style={{
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
                          <td className="text-center font-medium text-[color:var(--color-text-muted)] py-0.5 border border-[color:var(--color-border)]">
                            {rowTotal > 0 ? rowTotal : ""}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="sticky left-0 bg-[color:var(--color-bg-card)] text-center text-[color:var(--color-text-muted)] py-1 border border-[color:var(--color-border)]">計</td>
                      {colTotals.map((t, i) => (
                        <td key={i} className="text-center font-medium text-[color:var(--color-text-primary)] py-1 border border-[color:var(--color-border)]">
                          {t > 0 ? t : ""}
                        </td>
                      ))}
                      <td className="text-center font-bold text-[color:var(--color-text-primary)] py-1 border border-[color:var(--color-border)]">
                        {colTotals.reduce((s, v) => s + v, 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })()
        ) : (
          /* ===== 売上推移 ===== */
          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            <div className="shrink-0">
              <LineChart
                labels={buckets.map((b) => b.label)}
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
                <div className="flex-1 min-h-0 rounded-lg bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)] p-3 flex flex-col overflow-hidden">
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
                  <div className="flex-1 min-h-0 overflow-y-auto">
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
                  <p className="text-xs font-medium text-[color:var(--color-text-muted)] mb-2 shrink-0">
                    テーブル別売上
                  </p>
                  {tableBreakdown.length === 0 ? (
                    <p className="text-xs text-[color:var(--color-text-muted)]">
                      データがありません
                    </p>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <table className="w-full text-xs tabular-nums">
                        <thead className="text-[color:var(--color-text-muted)] sticky top-0 bg-[color:var(--color-bg-card)]">
                          <tr>
                            <th className="text-left font-normal py-1.5">テーブル</th>
                            <th className="text-right font-normal py-1.5 w-16">注文数</th>
                            <th className="text-right font-normal py-1.5 w-24">合計売上</th>
                            <th className="text-right font-normal py-1.5 w-24">テーブル単価</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableBreakdown.map((t) => (
                            <tr
                              key={t.table}
                              className="border-t border-[color:var(--color-border)]"
                            >
                              <td className="py-1.5 text-[color:var(--color-text-primary)]">
                                No.{t.table}
                              </td>
                              <td className="py-1.5 text-right text-[color:var(--color-text-primary)]">
                                {t.count}件
                              </td>
                              <td className="py-1.5 text-right text-[color:var(--color-text-primary)]">
                                {yen(t.revenue)}
                              </td>
                              <td className="py-1.5 text-right font-medium text-[color:var(--color-accent-char)]">
                                {yen(t.atv)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
