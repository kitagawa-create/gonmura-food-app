"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/PageLoader";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order } from "@/types";
import { useAdminRole } from "@/components/admin/AdminContext";

type Period = "daily" | "weekly" | "monthly";

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getWeekStart(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return formatDate(monday);
}

function getMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function orderTotal(order: Order): number {
  return order.items.reduce((s, i) => s + i.price * i.quantity, 0);
}

type BarDatum = { label: string; value: number; sub?: string };

function HorizontalBarChart({
  data,
  color = "#f97316",
  formatValue,
}: {
  data: BarDatum[];
  color?: string;
  formatValue?: (v: number) => string;
}) {
  const ceil = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => {
        const pct = (d.value / ceil) * 100;
        return (
          <div
            key={d.label}
            className="grid grid-cols-[7rem_1fr_6rem] items-center gap-2 text-sm"
          >
            <div className="truncate text-neutral-300" title={d.label}>
              {d.label}
            </div>
            <div className="h-5 bg-neutral-800 rounded-md overflow-hidden">
              <div
                className="h-full rounded-md transition-all"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
            <div className="text-right font-medium text-neutral-200 tabular-nums text-xs">
              {formatValue ? formatValue(d.value) : d.value}
              {d.sub && (
                <span className="ml-1 text-xs text-neutral-500">{d.sub}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function periodStart(period: Period): Date {
  const now = new Date();
  if (period === "daily") {
    now.setHours(0, 0, 0, 0);
    return now;
  }
  if (period === "weekly") {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export default function AdminSalesPage() {
  const role = useAdminRole();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("daily");

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

  const salesReport = useMemo(() => {
    const grouped = new Map<string, { tables: Set<string>; count: number; revenue: number }>();

    for (const order of orders) {
      const date = order.createdAt?.toDate?.();
      if (!date) continue;

      let key: string;
      if (period === "daily") key = formatDate(date);
      else if (period === "weekly") key = getWeekStart(date);
      else key = getMonth(date);

      const entry = grouped.get(key) || { tables: new Set<string>(), count: 0, revenue: 0 };
      entry.tables.add(`${order.tableNumber}-${formatDate(date)}`);
      entry.count++;
      entry.revenue += orderTotal(order);
      grouped.set(key, entry);
    }

    return Array.from(grouped.entries())
      .map(([key, val]) => ({
        period: key,
        count: val.count,
        revenue: val.revenue,
      }))
      .sort((a, b) => b.period.localeCompare(a.period));
  }, [orders, period]);

  const menuRanking = useMemo(() => {
    const start = periodStart(period);
    const menuMap = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const order of orders) {
      const date = order.createdAt?.toDate?.();
      if (!date || date < start) continue;
      for (const item of order.items) {
        const entry = menuMap.get(item.name) || { name: item.name, qty: 0, revenue: 0 };
        entry.qty += item.quantity;
        entry.revenue += item.price * item.quantity;
        menuMap.set(item.name, entry);
      }
    }
    return Array.from(menuMap.values()).sort((a, b) => b.qty - a.qty);
  }, [orders, period]);

  if (role !== "owner") return null;

  if (loading) {
    return <PageLoader />;
  }

  // 表示件数: 日別=30, 週別=20, 月別=無制限
  const REPORT_LIMIT =
    period === "daily" ? 30 : period === "weekly" ? 20 : Infinity;
  const limitedReport =
    REPORT_LIMIT === Infinity ? salesReport : salesReport.slice(0, REPORT_LIMIT);

  const salesChartData: BarDatum[] = [...limitedReport]
    .reverse()
    .map((row) => ({
      label: row.period,
      value: row.revenue,
      sub: `(${row.count})`,
    }));

  const menuChartData: BarDatum[] = menuRanking.slice(0, 10).map((m) => ({
    label: m.name,
    value: m.qty,
    sub: `¥${m.revenue.toLocaleString()}`,
  }));

  const rankingPeriodLabel =
    period === "daily" ? "今日" : period === "weekly" ? "今週" : "今月";

  return (
    <div className="w-full flex flex-col overflow-hidden h-[calc(100dvh-24px)] md:h-[calc(100dvh-48px)]">
      <div className="mb-3 flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold text-white">売上分析</h1>
        {/* 共通の期間切替 (日別 / 週別 / 月別) */}
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          aria-label="表示期間を切り替え"
        >
          <option value="daily">日別</option>
          <option value="weekly">週別</option>
          <option value="monthly">月別</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        {/* 売上レポート */}
        <section className="rounded-xl bg-neutral-900 border border-neutral-800 p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h2 className="text-lg font-bold text-white">売上レポート</h2>
          </div>
          {salesReport.length === 0 ? (
            <p className="text-sm text-neutral-500">データがありません</p>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                <HorizontalBarChart
                  data={salesChartData}
                  color="#f97316"
                  formatValue={(v) => `¥${v.toLocaleString()}`}
                />
              </div>
              <p className="text-xs text-neutral-600 mt-2 shrink-0">
                右の()内は注文件数{REPORT_LIMIT === Infinity
                  ? " / 全期間"
                  : ` / 直近${REPORT_LIMIT}${period === "daily" ? "日" : "週"}`}
              </p>
            </div>
          )}
        </section>

        {/* 人気メニューランキング */}
        <section className="rounded-xl bg-neutral-900 border border-neutral-800 p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h2 className="text-lg font-bold text-white">
              人気メニュー <span className="text-xs text-neutral-500 font-normal">({rankingPeriodLabel} Top 10)</span>
            </h2>
          </div>
          {menuRanking.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {rankingPeriodLabel}のデータがありません
            </p>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                <HorizontalBarChart
                  data={menuChartData}
                  color="#fbbf24"
                  formatValue={(v) => `${v}個`}
                />
              </div>
              <p className="text-xs text-neutral-600 mt-2 shrink-0">
                バーは注文数量、右の金額は売上額
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
