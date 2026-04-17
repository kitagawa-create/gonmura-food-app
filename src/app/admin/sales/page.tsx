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
type Analysis = "sales" | "menu" | "price";

const BLUE = "#3b82f6";
const COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#ef4444",
];

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
type Annotation = { idx: number; label: string };

function LineChart({
  labels,
  series,
  height = 240,
  sharedScale = false,
  activeIdx = null,
  onPointClick,
  annotations,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  sharedScale?: boolean;
  activeIdx?: number | null;
  onPointClick?: (i: number) => void;
  annotations?: Annotation[];
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
  const globalMax = Math.max(...series.flatMap((s) => s.values), 1);
  const maxPerSeries = series.map((s) =>
    sharedScale ? globalMax : Math.max(...s.values, 1)
  );

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
        {annotations?.map((ann) => (
          <g key={ann.idx}>
            <line
              x1={xs(ann.idx)}
              x2={xs(ann.idx)}
              y1={padT}
              y2={padT + innerH}
              stroke="#ef4444"
              strokeDasharray="4 3"
              strokeWidth={1.5}
            />
            <text x={xs(ann.idx) + 4} y={padT + 10} fontSize={9} fill="#ef4444">
              {ann.label}
            </text>
          </g>
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
  items: { label: string; value: number; color: string }[];
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
            <span className="w-14 shrink-0 text-right tabular-nums font-medium text-[color:var(--color-text-primary)]">
              {item.value}個
            </span>
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
  const [period, setPeriod] = useState<Period>("daily");
  const [analysis, setAnalysis] = useState<Analysis>("sales");
  const [priceMenuId, setPriceMenuId] = useState<string>("");
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // 日付範囲 (今月1日〜今日をデフォルト)
  const [startYear, setStartYear] = useState(() => new Date().getFullYear());
  const [startMonth, setStartMonth] = useState(() => new Date().getMonth() + 1);
  const [startDay, setStartDay] = useState<number>(1);
  const [endYear, setEndYear] = useState(() => new Date().getFullYear());
  const [endMonth, setEndMonth] = useState(() => new Date().getMonth() + 1);
  const [endDay, setEndDay] = useState(() => new Date().getDate());

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
  }, [period, analysis, startYear, startMonth, startDay, endYear, endMonth, endDay]);

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
    const tableAtv = count === 0 ? 0 : Math.round(revenue / count);
    // 客単価: guestCount のある注文だけで算出
    const withGuests = filteredOrders.filter((o) => (o.guestCount ?? 0) > 0);
    const totalGuests = withGuests.reduce((s, o) => s + (o.guestCount as number), 0);
    const guestRevenue = withGuests.reduce((s, o) => s + orderTotal(o), 0);
    const guestAtv = totalGuests === 0 ? null : Math.round(guestRevenue / totalGuests);
    return { revenue, count, tableAtv, guestAtv, guestBase: withGuests.length };
  }, [filteredOrders]);

  // メニュー棒グラフデータ (全商品・青単色)
  const menuBarItems = useMemo(() => {
    const map = new Map<string, { menuId: string; name: string; qty: number }>();
    for (const o of filteredOrders) {
      for (const it of flattenForReceipt(o.items)) {
        const e = map.get(it.menuId) ?? {
          menuId: it.menuId,
          name: it.name,
          qty: 0,
        };
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

  // 価格変更のあるメニュー (全期間で検出)
  const priceChangedMenus = useMemo(() => {
    const map = new Map<
      string,
      { menuId: string; name: string; qty: number; prices: Set<number> }
    >();
    for (const o of orders) {
      for (const it of flattenForReceipt(o.items)) {
        const e = map.get(it.menuId) ?? {
          menuId: it.menuId,
          name: it.name,
          qty: 0,
          prices: new Set<number>(),
        };
        e.qty += it.quantity;
        e.name = it.name;
        e.prices.add(Math.trunc(it.price));
        map.set(it.menuId, e);
      }
    }
    return Array.from(map.values())
      .filter((m) => m.prices.size >= 2)
      .sort((a, b) => b.qty - a.qty);
  }, [orders]);

  useEffect(() => {
    if (analysis !== "price") return;
    if (priceChangedMenus.length === 0) {
      if (priceMenuId) setPriceMenuId("");
      return;
    }
    if (!priceChangedMenus.some((m) => m.menuId === priceMenuId)) {
      setPriceMenuId(priceChangedMenus[0].menuId);
    }
  }, [analysis, priceMenuId, priceChangedMenus]);

  const visibleKeys = useMemo(() => new Set(buckets.map((b) => b.key)), [buckets]);

  const priceSeries: Series[] = useMemo(() => {
    if (analysis !== "price" || !priceMenuId) return [];
    const priceBuckets = new Map<number, Map<string, number>>();
    for (const o of filteredOrders) {
      const date = o.createdAt?.toDate?.();
      if (!date) continue;
      const key = bucketKey(date, period);
      if (!visibleKeys.has(key)) continue;
      for (const it of flattenForReceipt(o.items)) {
        if (it.menuId !== priceMenuId) continue;
        const price = Math.trunc(it.price);
        const b = priceBuckets.get(price) ?? new Map<string, number>();
        b.set(key, (b.get(key) ?? 0) + it.quantity);
        priceBuckets.set(price, b);
      }
    }
    return Array.from(priceBuckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([price, bmap], i) => ({
        name: `¥${price.toLocaleString()}`,
        color: COLORS[i % COLORS.length],
        values: buckets.map((b) => bmap.get(b.key) ?? 0),
        formatValue: (v: number) => `${v}個`,
      }));
  }, [analysis, priceMenuId, filteredOrders, period, buckets, visibleKeys]);

  const priceAnnotations: Annotation[] = useMemo(() => {
    if (analysis !== "price" || !priceMenuId || buckets.length === 0) return [];
    const firstBucket = new Map<number, string>();
    for (const o of filteredOrders) {
      const date = o.createdAt?.toDate?.();
      if (!date) continue;
      const key = bucketKey(date, period);
      for (const it of flattenForReceipt(o.items)) {
        if (it.menuId !== priceMenuId) continue;
        const price = Math.trunc(it.price);
        const existing = firstBucket.get(price);
        if (!existing || key < existing) firstBucket.set(price, key);
      }
    }
    const sorted = Array.from(firstBucket.entries()).sort((a, b) =>
      a[1].localeCompare(b[1])
    );
    return sorted.slice(1).flatMap(([price, bkey]) => {
      const idx = buckets.findIndex((b) => b.key === bkey);
      if (idx < 0) return [];
      return [{ idx, label: `¥${price.toLocaleString()}に変更` }];
    });
  }, [analysis, priceMenuId, filteredOrders, period, buckets]);

  const priceBeforeAfter = useMemo(() => {
    if (
      analysis !== "price" ||
      !priceMenuId ||
      priceAnnotations.length === 0 ||
      priceSeries.length === 0
    )
      return null;
    const changeIdx = priceAnnotations[priceAnnotations.length - 1].idx;
    const totalPerBucket = buckets.map((_, i) =>
      priceSeries.reduce((s, ser) => s + ser.values[i], 0)
    );
    const beforeSlice = totalPerBucket.slice(0, changeIdx);
    const afterSlice = totalPerBucket.slice(changeIdx);
    const beforeAvg =
      beforeSlice.length === 0
        ? 0
        : Math.round(beforeSlice.reduce((s, v) => s + v, 0) / beforeSlice.length);
    const afterAvg =
      afterSlice.length === 0
        ? 0
        : Math.round(afterSlice.reduce((s, v) => s + v, 0) / afterSlice.length);
    const diff =
      beforeAvg === 0
        ? null
        : Math.round(((afterAvg - beforeAvg) / beforeAvg) * 100);
    return { beforeAvg, afterAvg, diff };
  }, [analysis, priceMenuId, priceAnnotations, priceSeries, buckets]);

  const tableBreakdown = useMemo(() => {
    if (analysis !== "sales") return [];
    const map = new Map<
      number,
      { table: number; count: number; revenue: number }
    >();
    for (const o of filteredOrders) {
      const t = o.tableNumber;
      const e = map.get(t) ?? { table: t, count: 0, revenue: 0 };
      e.count++;
      e.revenue += orderTotal(o);
      map.set(t, e);
    }
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((e) => ({
        ...e,
        atv: e.count === 0 ? 0 : Math.round(e.revenue / e.count),
      }));
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
    const menuMap = new Map<
      string,
      { name: string; qty: number; revenue: number }
    >();
    for (const o of filtered) {
      for (const it of flattenForReceipt(o.items)) {
        const e = menuMap.get(it.menuId) ?? {
          name: it.name,
          qty: 0,
          revenue: 0,
        };
        e.qty += it.quantity;
        e.revenue += it.price * it.quantity;
        menuMap.set(it.menuId, e);
      }
    }
    const breakdown = Array.from(menuMap.values()).sort(
      (a, b) => b.revenue - a.revenue
    );
    const label =
      buckets.find((b) => b.key === detailKey)?.label ?? detailKey;
    return { label, count, revenue, atv, breakdown };
  }, [detailKey, filteredOrders, period, buckets]);

  if (role !== "owner") return null;
  if (loading) return <PageLoader />;

  const yen = (v: number) => `¥${v.toLocaleString()}`;

  const selectCls =
    "bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-2 py-1 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]";

  const startDayMax = getDaysInMonth(startYear, startMonth);
  const endDayMax = getDaysInMonth(endYear, endMonth);

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
            <option value="price">価格変更推移</option>
          </select>
        }
      />

      {/* 期間 + 集計単位 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 shrink-0 bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] px-4 py-2.5 shadow-sm">
        <span className="text-xs text-[color:var(--color-text-muted)]">開始</span>
        <select
          value={startYear}
          onChange={(e) => setStartYear(Number(e.target.value))}
          className={selectCls}
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select
          value={startMonth}
          onChange={(e) => setStartMonth(Number(e.target.value))}
          className={selectCls}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        <select
          value={startDay}
          onChange={(e) => setStartDay(Number(e.target.value))}
          className={selectCls}
        >
          {Array.from({ length: startDayMax }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}日
            </option>
          ))}
        </select>

        <span className="text-xs text-[color:var(--color-text-muted)] px-1">〜</span>

        <select
          value={endYear}
          onChange={(e) => setEndYear(Number(e.target.value))}
          className={selectCls}
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select
          value={endMonth}
          onChange={(e) => setEndMonth(Number(e.target.value))}
          className={selectCls}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        <select
          value={endDay}
          onChange={(e) => setEndDay(Number(e.target.value))}
          className={selectCls}
        >
          {Array.from({ length: endDayMax }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}日
            </option>
          ))}
        </select>

        <div className="ml-auto">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className={selectCls}
          >
            <option value="daily">日別</option>
            <option value="weekly">週別</option>
            <option value="monthly">月別</option>
          </select>
        </div>
      </div>

      {/* KPI: 合計売上 / 注文数 / テーブル単価 / 客単価 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
        <KpiCard label="合計売上" value={yen(kpi.revenue)} />
        <KpiCard label="注文数" value={`${kpi.count.toLocaleString()}件`} />
        <KpiCard
          label="テーブル単価"
          value={yen(kpi.tableAtv)}
          sub="注文あたり"
        />
        <KpiCard
          label="客単価"
          value={kpi.guestAtv !== null ? yen(kpi.guestAtv) : "−"}
          sub={
            kpi.guestAtv !== null
              ? `${kpi.guestBase}件から算出`
              : "人数データなし"
          }
        />
      </div>

      <section className="rounded-xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-4 flex flex-col flex-1 min-h-0 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2 shrink-0">
          <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">
            {analysis === "sales"
              ? "売上推移"
              : analysis === "menu"
              ? "メニュー別売数"
              : "価格変更推移"}
          </h2>
          {analysis === "price" && priceSeries.length > 0 && (
            <div className="flex items-center gap-3 text-xs flex-wrap justify-end">
              {priceSeries.map((s) => (
                <div key={s.name} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-[color:var(--color-text-muted)]">
                    {s.name}
                  </span>
                </div>
              ))}
            </div>
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

        {/* 価格変更: メニュー選択 */}
        {analysis === "price" && (
          <div className="mb-3 shrink-0">
            {priceChangedMenus.length === 0 ? (
              <p className="text-xs text-[color:var(--color-text-muted)]">
                価格変更履歴のあるメニューがありません
              </p>
            ) : (
              <select
                value={priceMenuId}
                onChange={(e) => setPriceMenuId(e.target.value)}
                className="w-full md:w-auto bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
              >
                {priceChangedMenus.map((m) => (
                  <option key={m.menuId} value={m.menuId}>
                    {m.name}（{m.prices.size}価格）
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* 期間エラー */}
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
        ) : analysis === "price" ? (
          /* ===== 価格変更推移 ===== */
          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            {priceSeries.length === 0 ? (
              <p className="text-sm text-[color:var(--color-text-muted)] py-10 text-center">
                この期間に販売実績がありません
              </p>
            ) : (
              <>
                {priceBeforeAfter && (
                  <div className="grid grid-cols-3 gap-2 shrink-0">
                    <div className="rounded-lg bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)] p-3">
                      <p className="text-[11px] text-[color:var(--color-text-muted)]">
                        変更前 平均販売数/期間
                      </p>
                      <p className="text-lg font-bold tabular-nums text-[color:var(--color-text-primary)] mt-0.5">
                        {priceBeforeAfter.beforeAvg}個
                      </p>
                    </div>
                    <div className="rounded-lg bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)] p-3">
                      <p className="text-[11px] text-[color:var(--color-text-muted)]">
                        変更後 平均販売数/期間
                      </p>
                      <p className="text-lg font-bold tabular-nums text-[color:var(--color-text-primary)] mt-0.5">
                        {priceBeforeAfter.afterAvg}個
                      </p>
                    </div>
                    {priceBeforeAfter.diff !== null && (
                      <div className="rounded-lg bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)] p-3">
                        <p className="text-[11px] text-[color:var(--color-text-muted)]">
                          変化率
                        </p>
                        <p
                          className={`text-lg font-bold tabular-nums mt-0.5 ${
                            priceBeforeAfter.diff >= 0
                              ? "text-[color:var(--color-accent-negi)]"
                              : "text-[color:var(--color-accent-warn)]"
                          }`}
                        >
                          {priceBeforeAfter.diff >= 0 ? "+" : ""}
                          {priceBeforeAfter.diff}%
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  <LineChart
                    labels={buckets.map((b) => b.label)}
                    series={priceSeries}
                    sharedScale
                    annotations={priceAnnotations}
                    height={200}
                  />
                </div>
                <p className="text-[11px] text-[color:var(--color-text-muted)] shrink-0">
                  赤い点線は価格変更日。価格帯ごとに線を分けて販売数推移を比較できます。
                </p>
              </>
            )}
          </div>
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
