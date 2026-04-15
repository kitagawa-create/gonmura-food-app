"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/PageLoader";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order } from "@/types";
import { useAdminRole } from "@/components/admin/AdminContext";

type Period = "daily" | "weekly" | "monthly";
type Analysis = "sales"; // 2, 5, 6 を追加予定

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
}: {
  labels: string[];
  series: Series[];
  height?: number;
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

  function seriesPath(values: number[]): string {
    const max = Math.max(...values, 1);
    return values
      .map((v, i) => {
        const y = padT + innerH - (v / max) * innerH;
        return `${i === 0 ? "M" : "L"}${xs(i).toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }
  const maxPerSeries = series.map((s) => Math.max(...s.values, 1));
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
              d={seriesPath(s.values)}
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
  const plain = (v: number) => v.toLocaleString();

  const series: Series[] = [
    {
      name: "売上",
      color: "#f97316",
      values: visible.map((b) => b.revenue),
      formatValue: yen,
    },
    {
      name: "注文数",
      color: "#38bdf8",
      values: visible.map((b) => b.count),
      formatValue: plain,
    },
    {
      name: "客単価",
      color: "#a3e635",
      values: visible.map((b) => (b.count === 0 ? 0 : Math.round(b.revenue / b.count))),
      formatValue: yen,
    },
  ];

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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-white">売上推移</h2>
          <div className="flex items-center gap-3 text-xs">
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-neutral-400">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <p className="text-sm text-neutral-500 py-10 text-center">
            データがありません
          </p>
        ) : (
          <LineChart
            labels={visible.map((b) => b.label)}
            series={series}
          />
        )}
        <p className="text-[11px] text-neutral-600 mt-2">
          各系列は最大値で正規化表示。値はホバーで確認できます。
        </p>
      </section>
    </div>
  );
}
