"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type Period = "daily" | "weekly" | "monthly";
type Analysis = "sales" | "menu" | "price";
const MAX_MENU_SERIES = 5;
// Blue theme palette
const MENU_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
];
const PRICE_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#ef4444",
];
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
function getMonthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function bucketKey(d: Date, period: Period): string {
  if (period === "daily") return formatDate(d);
  if (period === "weekly") return formatDate(getWeekStart(d));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shortLabel(key: string, period: Period): string {
  if (period === "monthly") return key.slice(2); // "26-04"
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)}`;
}
function orderTotal(o: Order): number {
  return o.items.reduce((s, i) => s + i.price * i.quantity, 0);
}
function orderQty(o: Order): number {
  return o.items.reduce((s, i) => s + i.quantity, 0);
}

type Bucket = {
  key: string;
  label: string;
  revenue: number;
  count: number;
  qty: number;
};

type Series = {
  name: string;
  color: string;
  values: number[];
  formatValue: (v: number) => string;
};

function LineChart({
  labels,
  series,
  height = 260,
  sharedScale = false,
  activeIdx = null,
  onPointClick,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  sharedScale?: boolean;
  activeIdx?: number | null;
  onPointClick?: (i: number) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const padL = 12;
  const padR = 12;
  const padT = 12;
  const padB = 28;
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
        {/* 横ガイド */}
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

        {/* hover 縦線 */}
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

        {/* x ラベル */}
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

        {/* hover 反応のための透明 rect */}
        {labels.map((_, i) => {
          const left = i === 0 ? padL : (xs(i) + xs(i - 1)) / 2;
          const right =
            i === n - 1 ? W - padR : (xs(i) + xs(i + 1)) / 2;
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
          <div className="text-[color:var(--color-text-muted)] mb-1">{labels[hoverIdx]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-[color:var(--color-text-primary)]">{s.name}</span>
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
      {sub && <p className="text-[11px] text-[color:var(--color-text-muted)] mt-0.5">{sub}</p>}
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
  const [selectedMenuIds, setSelectedMenuIds] = useState<string[]>([]);
  const [priceMenuId, setPriceMenuId] = useState<string>("");
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  useEffect(() => {
    setDetailKey(null);
  }, [period, analysis]);

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
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Category, "id">) }))
        )
    );
    const unsubMenus = onSnapshot(collection(db, "menus"), (snap) =>
      setMenus(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Menu, "id">) }))
      )
    );
    return () => {
      unsubCats();
      unsubMenus();
    };
  }, []);

  const menuCategoryMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const menu of menus) m.set(menu.id, menu.categoryIds ?? []);
    return m;
  }, [menus]);

  const buckets: Bucket[] = useMemo(() => {
    const map = new Map<string, Bucket>();
    for (const o of orders) {
      const date = o.createdAt?.toDate?.();
      if (!date) continue;
      const key = bucketKey(date, period);
      const b = map.get(key) || {
        key,
        label: shortLabel(key, period),
        revenue: 0,
        count: 0,
        qty: 0,
      };
      b.revenue += orderTotal(o);
      b.count += 1;
      b.qty += orderQty(o);
      map.set(key, b);
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [orders, period]);

  const limit =
    period === "daily" ? 30 : period === "weekly" ? 20 : 12;
  const visible = buckets.slice(-limit);

  const menuOptions = useMemo(() => {
    const map = new Map<string, { menuId: string; name: string; qty: number }>();
    for (const o of orders) {
      for (const it of o.items) {
        const e = map.get(it.menuId) || { menuId: it.menuId, name: it.name, qty: 0 };
        e.qty += it.quantity;
        e.name = it.name;
        map.set(it.menuId, e);
      }
    }
    const all = Array.from(map.values()).sort((a, b) => b.qty - a.qty);
    if (categoryFilter === "all") return all;
    return all.filter((m) => (menuCategoryMap.get(m.menuId) ?? []).includes(categoryFilter));
  }, [orders, categoryFilter, menuCategoryMap]);

  const menuInitRef = useRef(false);
  useEffect(() => {
    if (analysis !== "menu" || menuInitRef.current) return;
    if (menuOptions.length === 0) return;
    menuInitRef.current = true;
    setSelectedMenuIds(menuOptions.slice(0, 3).map((m) => m.menuId));
  }, [analysis, menuOptions]);

  const visibleKeys = useMemo(() => new Set(visible.map((b) => b.key)), [visible]);

  const menuSeries: Series[] = useMemo(() => {
    if (analysis !== "menu") return [];
    const selected = selectedMenuIds.slice(0, MAX_MENU_SERIES);
    const perMenuBuckets = new Map<string, Map<string, number>>();
    for (const mid of selected) perMenuBuckets.set(mid, new Map());
    for (const o of orders) {
      const date = o.createdAt?.toDate?.();
      if (!date) continue;
      const key = bucketKey(date, period);
      if (!visibleKeys.has(key)) continue;
      for (const it of o.items) {
        const b = perMenuBuckets.get(it.menuId);
        if (!b) continue;
        b.set(key, (b.get(key) ?? 0) + it.quantity);
      }
    }
    return selected.map((mid, i) => {
      const label = menuOptions.find((m) => m.menuId === mid)?.name ?? mid;
      const bmap = perMenuBuckets.get(mid) ?? new Map();
      return {
        name: label,
        color: MENU_COLORS[i % MENU_COLORS.length],
        values: visible.map((b) => bmap.get(b.key) ?? 0),
        formatValue: (v: number) => `${v}個`,
      };
    });
  }, [analysis, selectedMenuIds, orders, period, visible, visibleKeys, menuOptions]);

  const priceChangedMenus = useMemo(() => {
    const map = new Map<string, { menuId: string; name: string; qty: number; prices: Set<number> }>();
    for (const o of orders) {
      for (const it of o.items) {
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

  const priceSeries: Series[] = useMemo(() => {
    if (analysis !== "price" || !priceMenuId) return [];
    const priceBuckets = new Map<number, Map<string, number>>();
    for (const o of orders) {
      const date = o.createdAt?.toDate?.();
      if (!date) continue;
      const key = bucketKey(date, period);
      if (!visibleKeys.has(key)) continue;
      for (const it of o.items) {
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
        color: PRICE_COLORS[i % PRICE_COLORS.length],
        values: visible.map((b) => bmap.get(b.key) ?? 0),
        formatValue: (v: number) => `${v}個`,
      }));
  }, [analysis, priceMenuId, orders, period, visible, visibleKeys]);

  const detail = useMemo(() => {
    if (!detailKey) return null;
    const filtered = orders.filter((o) => {
      const d = o.createdAt?.toDate?.();
      return !!d && bucketKey(d, period) === detailKey;
    });
    if (filtered.length === 0) return null;
    const count = filtered.length;
    const revenue = filtered.reduce((s, o) => s + orderTotal(o), 0);
    const qty = filtered.reduce((s, o) => s + orderQty(o), 0);
    const atv = count === 0 ? 0 : Math.round(revenue / count);
    const menuMap = new Map<
      string,
      { name: string; qty: number; revenue: number }
    >();
    for (const o of filtered) {
      for (const it of o.items) {
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
    const label = visible.find((b) => b.key === detailKey)?.label ?? detailKey;
    return { key: detailKey, label, count, revenue, qty, atv, breakdown };
  }, [detailKey, orders, period, visible]);

  function toggleMenu(mid: string) {
    setSelectedMenuIds((prev) => {
      if (prev.includes(mid)) return prev.filter((x) => x !== mid);
      if (prev.length >= MAX_MENU_SERIES) return prev;
      return [...prev, mid];
    });
  }

  const kpi = useMemo(() => {
    const revenue = visible.reduce((s, b) => s + b.revenue, 0);
    const count = visible.reduce((s, b) => s + b.count, 0);
    const qty = visible.reduce((s, b) => s + b.qty, 0);
    return {
      revenue,
      count,
      atv: count === 0 ? 0 : Math.round(revenue / count),
      avgQty: count === 0 ? 0 : Math.round((qty / count) * 10) / 10,
    };
  }, [visible]);

  if (role !== "owner") return null;
  if (loading) return <PageLoader />;

  const yen = (v: number) => `¥${v.toLocaleString()}`;

  const rangeLabel =
    visible.length === 0
      ? ""
      : `${visible[0].label} 〜 ${visible[visible.length - 1].label}`;

  return (
    <div className="w-full flex flex-col gap-3 h-[calc(100dvh-24px)] md:h-[calc(100dvh-48px)]">
      <AdminPageHeader
        title="売上分析"
        className="relative z-30 shrink-0"
        rightSlot={
          <>
            <select
              value={analysis}
              onChange={(e) => setAnalysis(e.target.value as Analysis)}
              className="bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            >
              <option value="sales">売上推移</option>
              <option value="menu">メニュー別売数</option>
              <option value="price">価格変更前後比較</option>
            </select>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              className="bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            >
              <option value="daily">日別</option>
              <option value="weekly">週別</option>
              <option value="monthly">月別</option>
            </select>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
        <KpiCard label="合計売上" value={yen(kpi.revenue)} sub={rangeLabel} />
        <KpiCard label="注文数" value={`${kpi.count.toLocaleString()}件`} />
        <KpiCard label="客単価" value={yen(kpi.atv)} />
        <KpiCard label="平均品数" value={`${kpi.avgQty}点/注文`} />
      </div>

      <section className="rounded-xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-4 flex flex-col flex-1 min-h-0 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2 shrink-0">
          <h2 className="text-lg font-bold text-[color:var(--color-text-primary)]">
            {analysis === "sales"
              ? "売上推移"
              : analysis === "menu"
              ? "メニュー別売数"
              : "価格変更前後比較"}
          </h2>
          {analysis !== "sales" && (
            <div className="flex items-center gap-3 text-xs flex-wrap justify-end">
              {(analysis === "menu" ? menuSeries : priceSeries).map((s) => (
                <div key={s.name} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-[color:var(--color-text-muted)]">{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {analysis === "price" && (
          <div className="mb-3">
            {priceChangedMenus.length === 0 ? (
              <p className="text-xs text-[color:var(--color-text-muted)]">価格変更履歴のあるメニューがありません</p>
            ) : (
              <select
                value={priceMenuId}
                onChange={(e) => setPriceMenuId(e.target.value)}
                className="w-full md:w-auto bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-1.5 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
              >
                {priceChangedMenus.map((m) => (
                  <option key={m.menuId} value={m.menuId}>
                    {m.name}({m.prices.size}価格・累計 {m.qty}個)
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {analysis === "menu" && (
          <>
            {categories.length > 0 && (
              <div className="mb-2 flex gap-1.5 overflow-x-auto no-scrollbar pb-1 shrink-0">
                <button
                  onClick={() => setCategoryFilter("all")}
                  className={`shrink-0 min-h-[44px] rounded-full px-3 py-1 text-xs border transition-colors ${
                    categoryFilter === "all"
                      ? "bg-[color:var(--color-accent-char)] text-white border-transparent"
                      : "bg-[color:var(--color-bg-card)] text-[color:var(--color-text-primary)] border-[color:var(--color-border)] hover:bg-[color:var(--color-bg-subtle)]"
                  }`}
                >
                  すべて
                </button>
                {categories.map((c) => {
                  const active = categoryFilter === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCategoryFilter(c.id)}
                      className={`shrink-0 min-h-[44px] rounded-full px-3 py-1 text-xs border transition-colors ${
                        active
                          ? "bg-[color:var(--color-accent-char)] text-white border-transparent"
                          : "bg-[color:var(--color-bg-card)] text-[color:var(--color-text-primary)] border-[color:var(--color-border)] hover:bg-[color:var(--color-bg-subtle)]"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mb-3 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {menuOptions.length === 0 ? (
                <p className="text-xs text-[color:var(--color-text-muted)]">
                  {categoryFilter === "all"
                    ? "注文データがありません"
                    : "該当メニューがありません"}
                </p>
              ) : (
                menuOptions.map((m) => {
                  const idx = selectedMenuIds.indexOf(m.menuId);
                  const active = idx >= 0;
                  const atCap =
                    !active && selectedMenuIds.length >= MAX_MENU_SERIES;
                  return (
                    <button
                      key={m.menuId}
                      onClick={() => toggleMenu(m.menuId)}
                      disabled={atCap}
                      className={`rounded-full px-3 py-1 text-xs border transition-colors ${
                        active
                          ? "border-transparent"
                          : atCap
                          ? "text-[color:var(--color-text-muted)]/60 border-[color:var(--color-border)] cursor-not-allowed"
                          : "text-[color:var(--color-text-muted)] border-[color:var(--color-border)] hover:bg-[color:var(--color-bg-subtle)]"
                      }`}
                      style={
                        active
                          ? {
                              backgroundColor:
                                MENU_COLORS[idx % MENU_COLORS.length] + "33",
                              color: MENU_COLORS[idx % MENU_COLORS.length],
                              borderColor:
                                MENU_COLORS[idx % MENU_COLORS.length] + "80",
                            }
                          : undefined
                      }
                      title={`累計 ${m.qty}個`}
                    >
                      {m.name}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        {visible.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)] py-10 text-center">
            データがありません
          </p>
        ) : analysis === "menu" && menuSeries.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)] py-10 text-center">
            メニューを選択してください(最大 {MAX_MENU_SERIES})
          </p>
        ) : analysis === "price" && priceSeries.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)] py-10 text-center">
            対象メニューの販売実績がありません
          </p>
        ) : analysis === "sales" ? (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="shrink-0">
              <LineChart
                labels={visible.map((b) => b.label)}
                series={[
                  {
                    name: "売上",
                    color: "#3b82f6",
                    values: visible.map((b) => b.revenue),
                    formatValue: yen,
                  },
                ]}
                activeIdx={
                  detailKey
                    ? visible.findIndex((b) => b.key === detailKey)
                    : null
                }
                onPointClick={(i) =>
                  setDetailKey((cur) =>
                    cur === visible[i].key ? null : visible[i].key
                  )
                }
                height={200}
              />
            </div>
            {detail ? (
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs shrink-0">
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
                    <p className="text-[color:var(--color-text-muted)]">客単価</p>
                    <p className="text-[color:var(--color-text-primary)] font-bold tabular-nums">
                      {yen(detail.atv)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[color:var(--color-text-muted)]">総品数</p>
                    <p className="text-[color:var(--color-text-primary)] font-bold tabular-nums">
                      {detail.qty}点
                    </p>
                  </div>
                </div>
                <p className="text-xs text-[color:var(--color-text-muted)] mb-1 shrink-0">
                  メニュー別内訳
                </p>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="text-[color:var(--color-text-muted)] sticky top-0 bg-[color:var(--color-bg-subtle)]">
                      <tr>
                        <th className="text-left font-normal py-1">メニュー</th>
                        <th className="text-right font-normal py-1 w-16">数量</th>
                        <th className="text-right font-normal py-1 w-24">
                          売上
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.breakdown.map((m) => (
                        <tr key={m.name} className="border-t border-[color:var(--color-border)]">
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
              <p className="text-[11px] text-[color:var(--color-text-muted)] shrink-0">
                ポイントをタップするとその期間の詳細(注文数/客単価/メニュー別内訳)が見られます。
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0">
              <LineChart
                labels={visible.map((b) => b.label)}
                series={analysis === "menu" ? menuSeries : priceSeries}
                sharedScale
              />
            </div>
            <p className="text-[11px] text-[color:var(--color-text-muted)] mt-2 shrink-0">
              {analysis === "menu"
                ? `同一スケールで比較。最大${MAX_MENU_SERIES}メニューまで重ね描き。`
                : "価格帯ごとに線を分けて売数推移を比較。値上げ前後の販売数変化を読み取れます。"}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
