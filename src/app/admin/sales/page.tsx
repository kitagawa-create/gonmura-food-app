"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/PageLoader";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order } from "@/types";
import { useAdminRole } from "@/components/admin/AdminContext";

type Period = "daily" | "weekly" | "monthly";
type Analysis = "sales" | "menu" | "price";
const MAX_MENU_SERIES = 5;
const MENU_COLORS = [
  "#f97316",
  "#38bdf8",
  "#a3e635",
  "#f472b6",
  "#fbbf24",
];
const PRICE_COLORS = [
  "#f97316",
  "#38bdf8",
  "#a3e635",
  "#f472b6",
  "#fbbf24",
  "#c084fc",
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

function BarChart({
  labels,
  values,
  color = "#f97316",
  formatValue,
  activeIdx,
  onBarClick,
  height = 260,
}: {
  labels: string[];
  values: number[];
  color?: string;
  formatValue: (v: number) => string;
  activeIdx?: number | null;
  onBarClick?: (i: number) => void;
  height?: number;
}) {
  const padL = 12;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const W = 800;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const n = values.length;
  if (n === 0) return null;
  const max = Math.max(...values, 1);
  const gap = 2;
  const bw = Math.max(1, innerW / n - gap);
  const xTickEvery = Math.max(1, Math.ceil(n / 10));
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      {[0.25, 0.5, 0.75].map((p) => (
        <line
          key={p}
          x1={padL}
          x2={W - padR}
          y1={padT + innerH * p}
          y2={padT + innerH * p}
          stroke="#262626"
          strokeDasharray="3 3"
        />
      ))}
      {values.map((v, i) => {
        const h = (v / max) * innerH;
        const x = padL + i * (bw + gap) + gap / 2;
        const y = padT + innerH - h;
        const isActive = activeIdx === i;
        return (
          <g
            key={i}
            onClick={() => onBarClick?.(i)}
            style={{ cursor: onBarClick ? "pointer" : "default" }}
          >
            <rect
              x={padL + i * (bw + gap)}
              y={padT}
              width={bw + gap}
              height={innerH}
              fill="transparent"
            />
            <rect
              x={x}
              y={y}
              width={bw}
              height={h}
              fill={color}
              opacity={activeIdx == null || isActive ? 1 : 0.45}
              rx={2}
            />
            {isActive && (
              <text
                x={x + bw / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize={10}
                fill="#fafafa"
              >
                {formatValue(v)}
              </text>
            )}
          </g>
        );
      })}
      {labels.map((l, i) =>
        i % xTickEvery === 0 || i === n - 1 ? (
          <text
            key={i}
            x={padL + i * (bw + gap) + bw / 2 + gap / 2}
            y={height - 10}
            textAnchor="middle"
            fontSize={10}
            fill="#737373"
          >
            {l}
          </text>
        ) : null
      )}
    </svg>
  );
}

function LineChart({
  labels,
  series,
  height = 260,
  sharedScale = false,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  sharedScale?: boolean;
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
            stroke="#262626"
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
              return (
                <circle
                  key={i}
                  cx={xs(i)}
                  cy={y}
                  r={hoverIdx === i ? 4 : 2.5}
                  fill={s.color}
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
            stroke="#525252"
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
              fill="#737373"
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
              onMouseEnter={() => setHoverIdx(i)}
            />
          );
        })}
      </svg>

      {hoverIdx !== null && (
        <div className="pointer-events-none absolute top-2 right-2 rounded-lg border border-neutral-700 bg-neutral-900/95 px-3 py-2 text-xs shadow-lg">
          <div className="text-neutral-400 mb-1">{labels[hoverIdx]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-neutral-300">{s.name}</span>
              <span className="ml-auto tabular-nums font-medium text-white">
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
    <div className="rounded-xl bg-neutral-900 border border-neutral-800 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-xl font-bold text-white tabular-nums mt-0.5">
        {value}
      </p>
      {sub && <p className="text-[11px] text-neutral-600 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function AdminSalesPage() {
  const role = useAdminRole();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("daily");
  const [analysis, setAnalysis] = useState<Analysis>("sales");
  const [selectedMenuIds, setSelectedMenuIds] = useState<string[]>([]);
  const [priceMenuId, setPriceMenuId] = useState<string>("");
  const [detailKey, setDetailKey] = useState<string | null>(null);

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
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  }, [orders]);

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

  useEffect(() => {
    if (analysis === "price" && !priceMenuId && menuOptions.length > 0) {
      setPriceMenuId(menuOptions[0].menuId);
    }
  }, [analysis, priceMenuId, menuOptions]);

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
    <div className="w-full flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h1 className="text-2xl font-bold text-white">売上分析</h1>
        <div className="flex items-center gap-2">
          <select
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value as Analysis)}
            className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="sales">売上推移</option>
            <option value="menu">メニュー別売数</option>
            <option value="price">価格変更前後比較</option>
          </select>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="daily">日別</option>
            <option value="weekly">週別</option>
            <option value="monthly">月別</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="合計売上" value={yen(kpi.revenue)} sub={rangeLabel} />
        <KpiCard label="注文数" value={`${kpi.count.toLocaleString()}件`} />
        <KpiCard label="客単価" value={yen(kpi.atv)} />
        <KpiCard label="平均品数" value={`${kpi.avgQty}点/注文`} />
      </div>

      <section className="rounded-xl bg-neutral-900 border border-neutral-800 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-lg font-bold text-white">
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
                  <span className="text-neutral-400">{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {analysis === "price" && (
          <div className="mb-3">
            {menuOptions.length === 0 ? (
              <p className="text-xs text-neutral-500">注文データがありません</p>
            ) : (
              <select
                value={priceMenuId}
                onChange={(e) => setPriceMenuId(e.target.value)}
                className="w-full md:w-auto bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                {menuOptions.map((m) => (
                  <option key={m.menuId} value={m.menuId}>
                    {m.name}（累計 {m.qty}個）
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {analysis === "menu" && (
          <div className="mb-3 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
            {menuOptions.length === 0 ? (
              <p className="text-xs text-neutral-500">注文データがありません</p>
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
                        ? "text-white border-transparent"
                        : atCap
                        ? "text-neutral-600 border-neutral-800 cursor-not-allowed"
                        : "text-neutral-400 border-neutral-700 hover:bg-neutral-800"
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
        )}

        {visible.length === 0 ? (
          <p className="text-sm text-neutral-500 py-10 text-center">
            データがありません
          </p>
        ) : analysis === "menu" && menuSeries.length === 0 ? (
          <p className="text-sm text-neutral-500 py-10 text-center">
            メニューを選択してください（最大 {MAX_MENU_SERIES}）
          </p>
        ) : analysis === "price" && priceSeries.length === 0 ? (
          <p className="text-sm text-neutral-500 py-10 text-center">
            対象メニューの販売実績がありません
          </p>
        ) : analysis === "sales" ? (
          <>
            <BarChart
              labels={visible.map((b) => b.label)}
              values={visible.map((b) => b.revenue)}
              formatValue={yen}
              activeIdx={
                detailKey
                  ? visible.findIndex((b) => b.key === detailKey)
                  : null
              }
              onBarClick={(i) =>
                setDetailKey((cur) =>
                  cur === visible[i].key ? null : visible[i].key
                )
              }
            />
            {detail && (
              <div className="mt-3 rounded-lg bg-neutral-800/60 border border-neutral-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-white">
                    {detail.label} の詳細
                  </h3>
                  <button
                    onClick={() => setDetailKey(null)}
                    className="text-xs text-neutral-500 hover:text-neutral-300"
                  >
                    閉じる
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
                  <div>
                    <p className="text-neutral-500">売上</p>
                    <p className="text-white font-bold tabular-nums">
                      {yen(detail.revenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">注文数</p>
                    <p className="text-white font-bold tabular-nums">
                      {detail.count}件
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">客単価</p>
                    <p className="text-white font-bold tabular-nums">
                      {yen(detail.atv)}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-500">総品数</p>
                    <p className="text-white font-bold tabular-nums">
                      {detail.qty}点
                    </p>
                  </div>
                </div>
                <p className="text-xs text-neutral-500 mb-1">メニュー別内訳</p>
                <div className="max-h-52 overflow-y-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="text-neutral-600 sticky top-0 bg-neutral-800/60">
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
                        <tr key={m.name} className="border-t border-neutral-800">
                          <td className="py-1 text-neutral-300 truncate pr-2">
                            {m.name}
                          </td>
                          <td className="py-1 text-right text-neutral-200">
                            {m.qty}個
                          </td>
                          <td className="py-1 text-right text-neutral-200">
                            {yen(m.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <LineChart
            labels={visible.map((b) => b.label)}
            series={analysis === "menu" ? menuSeries : priceSeries}
            sharedScale={analysis === "menu" || analysis === "price"}
          />
        )}
        <p className="text-[11px] text-neutral-600 mt-2">
          {analysis === "sales" &&
            "バーをタップするとその期間の詳細（注文数/客単価/メニュー別内訳）が見られます。"}
          {analysis === "menu" &&
            `同一スケールで比較。最大${MAX_MENU_SERIES}メニューまで重ね描き。`}
          {analysis === "price" &&
            "価格帯ごとに線を分けて売数推移を比較。値上げ前後の販売数変化を読み取れます。"}
        </p>
      </section>
    </div>
  );
}
