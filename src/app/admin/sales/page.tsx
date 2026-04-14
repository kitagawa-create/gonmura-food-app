"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order, Category, Menu } from "@/types";

type Period = "daily" | "weekly" | "monthly";

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

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

export default function AdminSalesPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("daily");

  useEffect(() => {
    async function fetchData() {
      const [ordersSnap, catsSnap, menusSnap] = await Promise.all([
        getDocs(query(collection(db, "orders"), where("status", "==", "paid"))),
        getDocs(collection(db, "categories")),
        getDocs(collection(db, "menus")),
      ]);
      setOrders(ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Order));
      setCategories(catsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Category));
      setMenus(menusSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Menu));
      setLoading(false);
    }
    fetchData();
  }, []);

  // 1. 売上レポート（日別/週別/月別）
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
        tables: val.tables.size,
        count: val.count,
        revenue: val.revenue,
        avgPerTable: val.tables.size > 0 ? Math.round(val.revenue / val.tables.size) : 0,
      }))
      .sort((a, b) => b.period.localeCompare(a.period));
  }, [orders, period]);

  // 2. メニューABC分析
  const abcAnalysis = useMemo(() => {
    const menuMap = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const order of orders) {
      for (const item of order.items) {
        const entry = menuMap.get(item.name) || { name: item.name, qty: 0, revenue: 0 };
        entry.qty += item.quantity;
        entry.revenue += item.price * item.quantity;
        menuMap.set(item.name, entry);
      }
    }

    const sorted = Array.from(menuMap.values()).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = sorted.reduce((s, m) => s + m.revenue, 0);

    let cumulative = 0;
    return sorted.map((m) => {
      cumulative += m.revenue;
      const ratio = totalRevenue > 0 ? cumulative / totalRevenue : 0;
      const rank = ratio <= 0.7 ? "A" : ratio <= 0.9 ? "B" : "C";
      return {
        ...m,
        percent: totalRevenue > 0 ? Math.round((m.revenue / totalRevenue) * 1000) / 10 : 0,
        rank,
      };
    });
  }, [orders]);

  // 3. ピーク時間帯分析
  const peakAnalysis = useMemo(() => {
    const grid = new Map<string, number>();
    for (const order of orders) {
      const date = order.createdAt?.toDate?.();
      if (!date) continue;
      const dayName = DAY_NAMES[date.getDay()];
      const hour = date.getHours();
      const key = `${dayName}-${hour}`;
      grid.set(key, (grid.get(key) || 0) + 1);
    }

    const hours = Array.from({ length: 24 }, (_, i) => i).filter((h) => h >= 10 && h <= 22);
    return { grid, hours };
  }, [orders]);

  // 4. カテゴリ別注文率
  const categoryAnalysis = useMemo(() => {
    const totalOrders = orders.length;
    const menuCategoryMap = new Map<string, string[]>();
    for (const menu of menus) {
      menuCategoryMap.set(menu.id, menu.categoryIds);
    }

    const catStats = new Map<string, { orderIds: Set<string>; qty: number; revenue: number }>();
    for (const order of orders) {
      for (const item of order.items) {
        const catIds = menuCategoryMap.get(item.menuId) || [];
        for (const catId of catIds) {
          const entry = catStats.get(catId) || { orderIds: new Set(), qty: 0, revenue: 0 };
          entry.orderIds.add(order.id);
          entry.qty += item.quantity;
          entry.revenue += item.price * item.quantity;
          catStats.set(catId, entry);
        }
      }
    }

    return categories
      .map((cat) => {
        const stats = catStats.get(cat.id);
        return {
          name: cat.name,
          qty: stats?.qty || 0,
          revenue: stats?.revenue || 0,
          orderRate: totalOrders > 0 && stats ? Math.round((stats.orderIds.size / totalOrders) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [orders, categories, menus]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-sm text-gray-500">読み込み中...</p>
      </div>
    );
  }

  const totalRevenue = orders.reduce((s, o) => s + orderTotal(o), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <h1 className="text-2xl font-bold">売上分析</h1>

      {/* サマリー */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500">総売上</p>
          <p className="text-2xl font-bold">¥{totalRevenue.toLocaleString()}</p>
        </div>
        <div className="rounded border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500">精算済み注文数</p>
          <p className="text-2xl font-bold">{orders.length}</p>
        </div>
        <div className="rounded border border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500">平均注文単価</p>
          <p className="text-2xl font-bold">
            ¥{orders.length > 0 ? Math.round(totalRevenue / orders.length).toLocaleString() : 0}
          </p>
        </div>
      </div>

      {/* 1. 売上レポート */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">売上レポート</h2>
          <div className="flex gap-1">
            {(["daily", "weekly", "monthly"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs rounded ${
                  period === p ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {p === "daily" ? "日別" : p === "weekly" ? "週別" : "月別"}
              </button>
            ))}
          </div>
        </div>
        {salesReport.length === 0 ? (
          <p className="text-sm text-gray-500">データがありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="p-2">{period === "daily" ? "日付" : period === "weekly" ? "週（月曜始まり）" : "月"}</th>
                  <th className="p-2 text-right">テーブル数</th>
                  <th className="p-2 text-right">注文件数</th>
                  <th className="p-2 text-right">売上</th>
                  <th className="p-2 text-right">テーブル単価</th>
                </tr>
              </thead>
              <tbody>
                {salesReport.map((row) => (
                  <tr key={row.period} className="border-b border-gray-100">
                    <td className="p-2">{row.period}</td>
                    <td className="p-2 text-right">{row.tables}</td>
                    <td className="p-2 text-right">{row.count}</td>
                    <td className="p-2 text-right font-medium">¥{row.revenue.toLocaleString()}</td>
                    <td className="p-2 text-right">¥{row.avgPerTable.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 2. メニューABC分析 */}
      <section>
        <h2 className="text-lg font-bold mb-3">メニューABC分析</h2>
        {abcAnalysis.length === 0 ? (
          <p className="text-sm text-gray-500">データがありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="p-2">ランク</th>
                  <th className="p-2">メニュー</th>
                  <th className="p-2 text-right">注文数</th>
                  <th className="p-2 text-right">売上</th>
                  <th className="p-2 text-right">構成比</th>
                </tr>
              </thead>
              <tbody>
                {abcAnalysis.map((m) => (
                  <tr key={m.name} className="border-b border-gray-100">
                    <td className="p-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          m.rank === "A"
                            ? "bg-green-100 text-green-800"
                            : m.rank === "B"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                        }`}
                      >
                        {m.rank}
                      </span>
                    </td>
                    <td className="p-2">{m.name}</td>
                    <td className="p-2 text-right">{m.qty}</td>
                    <td className="p-2 text-right font-medium">¥{m.revenue.toLocaleString()}</td>
                    <td className="p-2 text-right">{m.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. ピーク時間帯分析 */}
      <section>
        <h2 className="text-lg font-bold mb-3">ピーク時間帯（曜日 x 時間）</h2>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="p-1 border border-gray-200"></th>
                {peakAnalysis.hours.map((h) => (
                  <th key={h} className="p-1 border border-gray-200 text-center w-10">
                    {h}時
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAY_NAMES.map((day) => (
                <tr key={day}>
                  <td className="p-1 border border-gray-200 font-medium text-center">{day}</td>
                  {peakAnalysis.hours.map((h) => {
                    const count = peakAnalysis.grid.get(`${day}-${h}`) || 0;
                    const intensity = Math.min(count / 5, 1);
                    return (
                      <td
                        key={h}
                        className="p-1 border border-gray-200 text-center"
                        style={{
                          backgroundColor: count > 0 ? `rgba(249, 115, 22, ${0.15 + intensity * 0.7})` : "transparent",
                          color: intensity > 0.5 ? "white" : undefined,
                        }}
                      >
                        {count || ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2">数字は注文件数。色が濃いほど注文が多い時間帯</p>
      </section>

      {/* 4. カテゴリ別注文率 */}
      <section>
        <h2 className="text-lg font-bold mb-3">カテゴリ別注文率</h2>
        {categoryAnalysis.length === 0 ? (
          <p className="text-sm text-gray-500">データがありません</p>
        ) : (
          <div className="space-y-3">
            {categoryAnalysis.map((cat) => (
              <div key={cat.name} className="rounded border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">{cat.name}</h3>
                  <span className="text-sm font-bold">¥{cat.revenue.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>注文数量: {cat.qty}</span>
                  <span>注文率: {cat.orderRate}%</span>
                </div>
                <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-orange-500 rounded-full"
                    style={{ width: `${Math.min(cat.orderRate, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2">
          注文率 = そのカテゴリが含まれる注文の割合（例: トッピング40% → 10件中4件がトッピングを追加）
        </p>
      </section>
    </div>
  );
}
