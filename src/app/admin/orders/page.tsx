"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageLoader } from "@/components/ui/PageLoader";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import {
  Timestamp,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Order, OrderItem, OrderWithItems } from "@/types";
import { normalizeOrder, normalizeOrderItem, comboLineTotal, taxIncluded } from "@/lib/order-utils";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DatePicker } from "@/components/admin/DatePicker";
import { StickyFilterBar } from "@/components/admin/StickyFilterBar";

const TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
});

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diff < 1) return "たった今";
  if (diff < 60) return `${diff}分前`;
  return `${Math.floor(diff / 60)}時間${diff % 60}分前`;
}

function timeStr(date: Date): string {
  return TIME_FORMATTER.format(date);
}

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1100;
      osc2.type = "sine";
      gain2.gain.value = 0.3;
      osc2.start();
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc2.stop(ctx.currentTime + 0.5);
    }, 200);
  } catch {
    /* Audio not supported */
  }
}

// ---------- customer info helper ----------

type CustomerInfo = { tableId: string; guestCount: number };

async function fetchCustomerInfo(customerIds: string[]): Promise<Map<string, CustomerInfo>> {
  if (customerIds.length === 0) return new Map();
  const snaps = await Promise.all(customerIds.map((id) => getDoc(doc(db, "customers", id))));
  const result = new Map<string, CustomerInfo>();
  for (const snap of snaps) {
    if (!snap.exists()) continue;
    const d = snap.data();
    result.set(snap.id, {
      tableId: typeof d.tableId === "string" ? d.tableId : "",
      guestCount: typeof d.guestCount === "number" ? Math.trunc(d.guestCount) : 1,
    });
  }
  return result;
}

// ---------- page ----------

export default function AdminOrdersPage() {
  const [view, setView] = useState<"orders" | "history">("orders");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col">
      <AdminPageHeader
        title="注文管理"
        rightSlot={
          <div className="flex rounded-lg border border-[color:var(--color-border)] overflow-hidden">
            <button
              type="button"
              onClick={() => setView("orders")}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
                view === "orders"
                  ? "bg-[color:var(--color-accent-char)] text-white"
                  : "bg-[color:var(--color-bg-card)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
              }`}
            >
              新規注文
            </button>
            <button
              type="button"
              onClick={() => setView("history")}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
                view === "history"
                  ? "bg-[color:var(--color-accent-char)] text-white"
                  : "bg-[color:var(--color-bg-card)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
              }`}
            >
              履歴
            </button>
          </div>
        }
      />

      {error && (
        <p className="mb-4 rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 text-sm text-[color:var(--color-accent-warn)]">
          {error}
        </p>
      )}

      {view === "orders" ? (
        <NewOrdersView onError={setError} />
      ) : (
        <HistoryView onError={setError} />
      )}
    </div>
  );
}

// ========== 新規注文ビュー ==========

function NewOrdersView({
  onError,
}: {
  onError: (msg: string | null) => void;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [itemsByOrder, setItemsByOrder] = useState<Map<string, OrderItem[]>>(new Map());
  const [customerInfoMap, setCustomerInfoMap] = useState<Map<string, CustomerInfo>>(new Map());
  const customerInfoMapRef = useRef<Map<string, CustomerInfo>>(new Map());
  const [tableNumberMap, setTableNumberMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<string>(todayISO());
  const [now, setNow] = useState(() => Date.now());
  const prevOrderCountRef = useRef<number | null>(null);

  // tables コレクションをリアルタイム購読して tableId→tableNumber マップを維持
  useEffect(() => {
    return onSnapshot(collection(db, "tables"), (snap) => {
      const map = new Map<string, string>();
      for (const d of snap.docs) map.set(d.id, d.data().tableNumber as string);
      setTableNumberMap(map);
    });
  }, []);

  // 経過時刻更新 + 日付自動ロールオーバー (30秒おき)
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
      const today = todayISO();
      setDateFilter((prev) => (prev !== today ? today : prev));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    prevOrderCountRef.current = null;
    const start = new Date(`${dateFilter}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const q = query(
      collectionGroup(db, "orders"),
      where("status", "==", "pending"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<", Timestamp.fromDate(end)),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs
          .filter((d) => d.ref.parent.parent !== null)
          .map((d) => normalizeOrder(d.id, d.data() as Record<string, unknown>, d.ref.parent.parent!.id));

        if (prevOrderCountRef.current !== null && all.length > prevOrderCountRef.current) {
          playNotificationSound();
        }
        prevOrderCountRef.current = all.length;

        setOrders(all);
        setLoading(false);
      },
      (e) => {
        onError(e.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [dateFilter, onError]);

  // orders が更新されるたびに未取得の顧客情報を追加取得
  useEffect(() => {
    const missingIds = orders
      .map((o) => o.customerId)
      .filter((id) => !customerInfoMapRef.current.has(id));
    if (missingIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const newData = await fetchCustomerInfo(missingIds);
      if (cancelled) return;
      customerInfoMapRef.current = new Map([...customerInfoMapRef.current, ...newData]);
      setCustomerInfoMap(new Map(customerInfoMapRef.current));
    })();
    return () => { cancelled = true; };
  }, [orders]);

  useEffect(() => {
    if (orders.length === 0) return;
    const unsubscribers = orders.map((order) =>
      onSnapshot(query(collectionGroup(db, "items"), where("orderId", "==", order.orderId)), (snap) => {
        setItemsByOrder((prev) => {
          const next = new Map(prev);
          next.set(order.orderId, snap.docs.map((d) => normalizeOrderItem(d.id, d.data() as Record<string, unknown>)));
          return next;
        });
      })
    );
    return () => unsubscribers.forEach((u) => u());
  }, [orders]);

  const ordersWithItems: OrderWithItems[] = useMemo(
    () => orders.map((o) => ({ ...o, items: itemsByOrder.get(o.orderId) ?? [] })),
    [orders, itemsByOrder]
  );

  const toggleCheck = useCallback(
    async (order: OrderWithItems, itemId: string) => {
      onError(null);
      const item = order.items.find((i) => i.itemId === itemId);
      if (!item) return;
      const newChecked = !item.checked;

      setItemsByOrder((prev) => {
        const next = new Map(prev);
        next.set(order.orderId, (prev.get(order.orderId) ?? []).map((i) => i.itemId === itemId ? { ...i, checked: newChecked } : i));
        return next;
      });

      try {
        await updateDoc(doc(db, "customers", order.customerId, "orders", order.orderId, "items", itemId), {
          checked: newChecked,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        setItemsByOrder((prev) => {
          const next = new Map(prev);
          next.set(order.orderId, (prev.get(order.orderId) ?? []).map((i) => i.itemId === itemId ? { ...i, checked: item.checked } : i));
          return next;
        });
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  const completeOrder = useCallback(
    async (order: OrderWithItems) => {
      onError(null);
      const orderBase: Order = { orderId: order.orderId, status: order.status, customerId: order.customerId, createdAt: order.createdAt, updatedAt: order.updatedAt };
      setOrders((os) => os.filter((o) => o.orderId !== order.orderId));
      try {
        await updateDoc(doc(db, "customers", order.customerId, "orders", order.orderId), {
          status: "completed",
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        setOrders((os) => [...os, orderBase]);
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  const deleteOrder = useCallback(
    async (order: OrderWithItems) => {
      onError(null);
      try {
        const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.orderId)));
        const batch = writeBatch(db);
        for (const d of itemsSnap.docs) batch.delete(d.ref);
        batch.delete(doc(db, "customers", order.customerId, "orders", order.orderId));
        await batch.commit();
      } catch (e) {
        onError(e instanceof Error ? e.message : "削除に失敗しました。");
      }
    },
    [onError]
  );

  const cancelItem = useCallback(
    async (order: OrderWithItems, itemId: string) => {
      onError(null);
      const isLast = order.items.length === 1;
      try {
        if (isLast) {
          const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.orderId)));
          const batch = writeBatch(db);
          for (const d of itemsSnap.docs) batch.delete(d.ref);
          batch.delete(doc(db, "customers", order.customerId, "orders", order.orderId));
          await batch.commit();
        } else {
          await deleteDoc(doc(db, "customers", order.customerId, "orders", order.orderId, "items", itemId));
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  const bulkCheckAll = useCallback(
    async (order: OrderWithItems) => {
      onError(null);
      setItemsByOrder((prev) => {
        const next = new Map(prev);
        next.set(order.orderId, (prev.get(order.orderId) ?? []).map((i) => ({ ...i, checked: true })));
        return next;
      });
      try {
        const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.orderId)));
        const batch = writeBatch(db);
        const ts = serverTimestamp();
        for (const d of itemsSnap.docs) batch.update(d.ref, { checked: true, updatedAt: ts });
        await batch.commit();
      } catch (e) {
        setItemsByOrder((prev) => {
          const next = new Map(prev);
          next.set(order.orderId, order.items);
          return next;
        });
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  const bulkUncheckAll = useCallback(
    async (order: OrderWithItems) => {
      onError(null);
      setItemsByOrder((prev) => {
        const next = new Map(prev);
        next.set(order.orderId, (prev.get(order.orderId) ?? []).map((i) => ({ ...i, checked: false })));
        return next;
      });
      try {
        const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.orderId)));
        const batch = writeBatch(db);
        const ts = serverTimestamp();
        for (const d of itemsSnap.docs) batch.update(d.ref, { checked: false, updatedAt: ts });
        await batch.commit();
      } catch (e) {
        setItemsByOrder((prev) => {
          const next = new Map(prev);
          next.set(order.orderId, order.items);
          return next;
        });
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  if (loading) return <PageLoader />;

  if (orders.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[color:var(--color-text-muted)]">新規注文はありません</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <p className="mb-3 text-xs text-[color:var(--color-text-muted)]">
        未完了: {ordersWithItems.length}件
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {ordersWithItems.map((order) => (
          <ActiveOrderCard
            key={order.orderId}
            order={order}
            tableNumber={tableNumberMap.get(customerInfoMap.get(order.customerId)?.tableId ?? "") ?? "?"}
            now={now}
            onToggle={toggleCheck}
            onComplete={completeOrder}
            onDelete={deleteOrder}
            onCancelItem={cancelItem}
            onBulkCheck={bulkCheckAll}
            onBulkUncheck={bulkUncheckAll}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- 新規注文カード ----------

function ActiveOrderCard({
  order,
  tableNumber,
  now,
  onToggle,
  onComplete,
  onDelete,
  onCancelItem,
  onBulkCheck,
  onBulkUncheck,
}: {
  order: OrderWithItems;
  tableNumber: string;
  now: number;
  onToggle: (order: OrderWithItems, itemId: string) => void;
  onComplete: (order: OrderWithItems) => void;
  onDelete: (order: OrderWithItems) => void;
  onCancelItem: (order: OrderWithItems, itemId: string) => void;
  onBulkCheck: (order: OrderWithItems) => void;
  onBulkUncheck: (order: OrderWithItems) => void;
}) {
  const [showCancel, setShowCancel] = useState(false);
  const [cancelItemId, setCancelItemId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [autoCompleteCountdown, setAutoCompleteCountdown] = useState<number | null>(null);
  const total = order.items.reduce((s, i) => s + comboLineTotal(i), 0);
  const created = order.createdAt?.toDate?.();
  const elapsed = created ? timeAgo(created) : "";
  const allDone = order.items.length > 0 && order.items.every((i) => i.checked);
  const checkedCount = order.items.filter((i) => i.checked).length;
  const progress = `${checkedCount}/${order.items.length}`;

  // 全チェック時に5秒後自動で提供完了。編集中は停止。
  useEffect(() => {
    if (!allDone || editMode) {
      setAutoCompleteCountdown(null);
      return;
    }
    setAutoCompleteCountdown(5);
    const interval = setInterval(() => {
      setAutoCompleteCountdown((c) => (c === null || c <= 1 ? 0 : c - 1));
    }, 1000);
    const timer = setTimeout(() => {
      onComplete(order);
    }, 5000);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [allDone, editMode, order, onComplete]);

  const isUrgent =
    order.status === "pending" &&
    !!created &&
    now - created.getTime() > 10 * 60 * 1000;

  const cancelTarget = cancelItemId !== null
    ? order.items.find((i) => i.itemId === cancelItemId) ?? null
    : null;
  const isLastItem = order.items.length === 1;

  return (
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
        if (allDone) onBulkUncheck(order); else onBulkCheck(order);
      }}
      className={`rounded-xl p-4 transition-colors cursor-pointer ${
        isUrgent
          ? "bg-[color:var(--color-accent-warn)]/10 border-2 border-[color:var(--color-accent-warn)]"
          : "bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] shadow-sm"
      }`}
    >
      {/* テーブル番号 + 経過 + 進捗 + 編集 */}
      <div className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center justify-center rounded-xl bg-[color:var(--color-accent-char)] px-3 py-1.5 min-w-[52px]">
              <span className="text-2xl font-bold leading-none text-white">{tableNumber ?? "?"}</span>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                isUrgent
                  ? "bg-[color:var(--color-accent-warn)] text-white"
                  : "bg-[color:var(--color-bg-subtle)] text-[color:var(--color-text-muted)]"
              }`}>
              {elapsed}
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditMode((m) => !m); }}
            aria-label={editMode ? "編集終了" : "編集"}
            aria-pressed={editMode}
            className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              editMode
                ? "bg-[color:var(--color-accent-char)] text-white"
                : "border border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
            }`}
          >
            {editMode ? "完了" : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            )}
          </button>
        </div>
        <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">完成済み {progress}</p>
      </div>

      {/* 商品チェックリスト */}
      <ul className="mb-3 space-y-1">
        {(() => {
          // setId でグループ化し、メイン→サイドの順で並べる（新フォーマット対応）
          const rendered: React.ReactNode[] = [];
          const added = new Set<string>();
          const sortedItems = [
            ...order.items.filter((i) => !i.setId || i.isMain),
            ...order.items.filter((i) => i.setId && !i.isMain),
          ];
          for (const item of sortedItems) {
            if (added.has(item.itemId)) continue;
            added.add(item.itemId);
            // 新フォーマットのサイドはメインの直後に挿入済みなのでここでは skip
            if (item.setId && !item.isMain) continue;

            const sides = item.setId
              ? order.items.filter((s) => !s.isMain && s.setId === item.setId)
              : [];
            sides.forEach((s) => added.add(s.itemId));

            const renderRow = (rowItem: typeof item, isSide: boolean) => {
              const done = rowItem.checked;
              return (
                <li key={rowItem.itemId} className={`flex items-stretch gap-1 ${isSide ? "ml-4" : ""}`}>
                  <button
                    type="button"
                    onClick={() => onToggle(order, rowItem.itemId)}
                    className={`flex-1 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      done
                        ? "bg-[color:var(--color-accent-negi)]/10"
                        : "bg-[color:var(--color-bg-subtle)] hover:bg-[color:var(--color-bg-subtle)]/80"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                          done
                            ? "border-[color:var(--color-accent-negi)] bg-[color:var(--color-accent-negi)]"
                            : "border-[color:var(--color-border-strong)]"
                        }`}
                      >
                        {done && (
                          <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className={`flex-1 text-lg leading-tight ${done ? "line-through text-[color:var(--color-text-muted)]" : "text-[color:var(--color-text-primary)]"}`}>
                        {isSide && <span className="mr-1 text-sm text-[color:var(--color-text-muted)]">＋</span>}
                        {rowItem.name}
                      </span>
                      <span className={`whitespace-nowrap text-xl font-bold ${done ? "text-[color:var(--color-text-muted)]" : "text-[color:var(--color-accent-char)]"}`}>
                        ×{rowItem.quantity}
                      </span>
                    </div>
                    {/* 旧フォーマット: toppings 埋め込みをテキスト表示 */}
                    {rowItem.toppings.length > 0 && (
                      <ul className="mt-1 ml-10 space-y-0.5">
                        {rowItem.toppings.map((t) => (
                          <li key={t.menuId} className={`flex items-baseline justify-between text-base ${done ? "text-[color:var(--color-text-muted)] line-through" : "text-[color:var(--color-text-primary)]"}`}>
                            <span><span className="mr-1 text-[color:var(--color-text-muted)]">＋</span>{t.name}</span>
                            <span className="tabular-nums font-semibold">×{t.quantity * rowItem.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {rowItem.note && (
                      <p className="mt-1 ml-10 text-xs text-[color:var(--color-accent-warn)]">※ {rowItem.note}</p>
                    )}
                  </button>
                  {editMode && (
                    <button
                      type="button"
                      onClick={() => setCancelItemId(rowItem.itemId)}
                      aria-label={`${rowItem.name} をキャンセル`}
                      className="shrink-0 w-9 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] text-lg text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-accent-warn)]/10 hover:text-[color:var(--color-accent-warn)] transition-colors"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            };

            rendered.push(renderRow(item, false));
            sides.forEach((s) => rendered.push(renderRow(s, true)));
          }
          return rendered;
        })()}
      </ul>

      {/* 完了ボタン (全チェック時) or 取消 + 合計 */}
      {allDone ? (
        <button
          type="button"
          onClick={() => onComplete(order)}
          className="w-full min-h-[44px] rounded-lg bg-[color:var(--color-accent-negi)] px-3 text-sm text-white font-bold hover:opacity-90 transition-opacity"
        >
          提供完了
          {autoCompleteCountdown !== null && ` (${autoCompleteCountdown})`}
        </button>
      ) : editMode ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowCancel(true); }}
          className="rounded-lg border border-[color:var(--color-accent-warn)]/50 px-3 py-1.5 text-xs text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-accent-warn)]/10 transition-colors"
        >
          オーダーキャンセル
        </button>
      ) : null}

      <ConfirmDialog
        open={showCancel}
        title={`テーブル ${tableNumber ?? "?"} の注文を削除`}
        message={`${order.items.map((i) => i.name).join("、")}（¥${taxIncluded(total).toLocaleString()}・税抜¥${total.toLocaleString()}）を削除しますか？この操作は取り消せません。`}
        confirmLabel="削除する"
        confirmColor="red"
        onConfirm={() => {
          onDelete(order);
          setShowCancel(false);
        }}
        onCancel={() => setShowCancel(false)}
      />

      <ConfirmDialog
        open={cancelItemId !== null}
        title="商品をキャンセル"
        message={
          cancelTarget
            ? `${cancelTarget.name} ×${cancelTarget.quantity}（¥${taxIncluded(comboLineTotal(cancelTarget)).toLocaleString()}・税抜¥${comboLineTotal(cancelTarget).toLocaleString()}）をキャンセルしますか？${isLastItem ? "これが最後の商品のため注文自体が削除されます。" : ""}`
            : ""
        }
        confirmLabel={isLastItem ? "注文を削除" : "キャンセルする"}
        confirmColor="red"
        onConfirm={() => {
          if (cancelItemId !== null) onCancelItem(order, cancelItemId);
          setCancelItemId(null);
        }}
        onCancel={() => setCancelItemId(null)}
      />
    </div>
  );
}

// ========== 履歴ビュー ==========

function HistoryView({ onError }: { onError: (msg: string | null) => void }) {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [customerInfoMap, setCustomerInfoMap] = useState<Map<string, CustomerInfo>>(new Map());
  const [tableNumberMap, setTableNumberMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dateSearch, setDateSearch] = useState<string>(todayISO());
  const [tableFilter, setTableFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkRevert, setShowBulkRevert] = useState(false);

  useEffect(() => {
    return onSnapshot(collection(db, "tables"), (snap) => {
      const map = new Map<string, string>();
      for (const d of snap.docs) map.set(d.id, d.data().tableNumber as string);
      setTableNumberMap(map);
    });
  }, []);

  const revertOrder = useCallback(
    async (order: OrderWithItems) => {
      onError(null);
      try {
        const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.orderId)));
        const batch = writeBatch(db);
        const ts = serverTimestamp();
        for (const d of itemsSnap.docs) batch.update(d.ref, { checked: false, updatedAt: ts });
        batch.update(doc(db, "customers", order.customerId, "orders", order.orderId), { status: "pending", updatedAt: ts });
        await batch.commit();
      } catch (e) {
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  useEffect(() => {
    setLoading(true);
    const start = new Date(`${dateSearch}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    let cancelled = false;
    let gen = 0;
    const unsub = onSnapshot(
      query(
        collectionGroup(db, "orders"),
        where("status", "==", "completed"),
        where("createdAt", ">=", Timestamp.fromDate(start)),
        where("createdAt", "<", Timestamp.fromDate(end)),
        orderBy("createdAt", "desc")
      ),
      async (snap) => {
        const current = ++gen;
        const orderDocs = snap.docs
          .filter((d) => d.ref.parent.parent !== null)
          .map((d) => normalizeOrder(d.id, d.data() as Record<string, unknown>, d.ref.parent.parent!.id));
        const withItems = await Promise.all(
          orderDocs.map(async (order) => {
            const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.orderId)));
            return { ...order, items: itemsSnap.docs.map((d) => normalizeOrderItem(d.id, d.data() as Record<string, unknown>)) } as OrderWithItems;
          })
        );
        const ids = [...new Set(orderDocs.map((o) => o.customerId))];
        const ctMap = await fetchCustomerInfo(ids);
        if (cancelled || current !== gen) return;
        setCustomerInfoMap(ctMap);
        setOrders(withItems);
        setLoading(false);
      },
      (e) => { if (!cancelled) { onError(e.message); setLoading(false); } }
    );
    return () => { cancelled = true; unsub(); };
  }, [dateSearch, onError]);

  const getTableNumber = useCallback(
    (customerId: string) => tableNumberMap.get(customerInfoMap.get(customerId)?.tableId ?? "") ?? "",
    [customerInfoMap, tableNumberMap]
  );

  const availableTables = useMemo(
    () => [...new Set(orders.map((o) => getTableNumber(o.customerId)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")),
    [orders, getTableNumber]
  );

  const filteredOrders = useMemo(
    () => tableFilter !== null ? orders.filter((o) => getTableNumber(o.customerId) === tableFilter) : orders,
    [orders, tableFilter, getTableNumber]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const revertSelected = useCallback(async () => {
    const targets = filteredOrders.filter((o) => selectedIds.has(o.orderId));
    await Promise.all(targets.map((o) => revertOrder(o)));
    setSelectedIds(new Set());
    setShowBulkRevert(false);
  }, [filteredOrders, selectedIds, revertOrder]);

  const totalAmount = filteredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + comboLineTotal(i), 0), 0);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <StickyFilterBar>
        <div className="flex items-center gap-3 flex-wrap">
          <DatePicker
            value={dateSearch}
            onChange={(v) => { setDateSearch(v); setTableFilter(null); setSelectedIds(new Set()); }}
            max={todayISO()}
          />
          <button
            type="button"
            onClick={() => setDateSearch(todayISO())}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
              dateSearch !== todayISO()
                ? "border-[color:var(--color-accent-char)] bg-[color:var(--color-accent-char)] text-white"
                : "border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
            }`}
          >
            今日
          </button>
          {availableTables.length > 0 && (
            <select
              value={tableFilter ?? ""}
              onChange={(e) => setTableFilter(e.target.value === "" ? null : e.target.value)}
              className="bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            >
              <option value="">全テーブル</option>
              {availableTables.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setShowBulkRevert(true)}
            className="ml-auto rounded-lg bg-[color:var(--color-accent-char)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
          >
            新規に戻す
          </button>
        </div>
      </StickyFilterBar>

      <div className="shrink-0 flex items-center gap-8 sm:gap-10 px-4 py-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] text-xs font-semibold text-[color:var(--color-text-muted)]">
        <div className="w-14 shrink-0 text-center">テーブル</div>
        <div className="w-16 shrink-0">注文</div>
        <div className="w-16 shrink-0">提供</div>
        <div className="flex-1 min-w-0">商品名</div>
        <div className="shrink-0 pl-1">合計</div>
      </div>
      <div className="flex-1 overflow-y-auto pt-3">
        {loading ? (
          <PageLoader />
        ) : filteredOrders.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-[color:var(--color-text-muted)]">この日の履歴はありません</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredOrders.map((order) => (
              <HistoryOrderCard
                key={order.orderId}
                order={order}
                tableNumber={getTableNumber(order.customerId) || "?"}
                selected={selectedIds.has(order.orderId)}
                onSelect={toggleSelect}
              />
            ))}
          </div>
        )}

        <ConfirmDialog
          open={showBulkRevert}
          title={`${selectedIds.size}件の注文を新規に戻す`}
          message="選択した注文を提供前(新規)に戻します。チェック状態はすべてリセットされます。"
          confirmLabel="戻す"
          confirmColor="green"
          onConfirm={revertSelected}
          onCancel={() => setShowBulkRevert(false)}
        />
      </div>
    </div>
  );
}

// ---------- 履歴カード ----------

function HistoryOrderCard({
  order,
  tableNumber,
  selected,
  onSelect,
}: {
  order: OrderWithItems;
  tableNumber: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = order.items.reduce((s, i) => s + comboLineTotal(i), 0);
  const created = order.createdAt?.toDate?.();
  const updated = order.updatedAt?.toDate?.();
  const PREVIEW = 2;
  const visibleItems = expanded ? order.items : order.items.slice(0, PREVIEW);
  const hiddenCount = order.items.length - PREVIEW;

  return (
    <div
      onClick={() => onSelect(order.orderId)}
      className={`flex items-start gap-8 sm:gap-10 rounded-xl border bg-[color:var(--color-bg-card)] p-4 shadow-sm transition-colors cursor-pointer ${
        selected ? "border-[color:var(--color-accent-char)] ring-2 ring-[color:var(--color-accent-char)]/20" : "border-[color:var(--color-border)]"
      }`}
    >
      <div className="shrink-0 flex flex-col items-center gap-1 w-14">
        <div className="inline-flex items-center justify-center rounded-xl bg-[color:var(--color-accent-char)] px-3 py-1.5 min-w-[52px]">
          <span className="text-2xl font-bold leading-none text-white">{tableNumber}</span>
        </div>
      </div>
      <div className="shrink-0 text-xs w-16">
        <p className="font-medium text-[color:var(--color-text-primary)] tabular-nums">{created ? TIME_FORMATTER.format(created) : "−"}</p>
      </div>
      <div className="shrink-0 text-xs w-16">
        <p className="font-medium text-[color:var(--color-text-primary)] tabular-nums">{updated ? TIME_FORMATTER.format(updated) : "−"}</p>
      </div>
      <div className="flex-1 min-w-0">
        <ul className="text-sm space-y-2">
          {visibleItems.map((item) => (
            <li key={item.itemId}>
              <div className="flex items-baseline gap-2">
                <span className="flex-1 text-[color:var(--color-text-primary)] truncate">{item.name}</span>
                <span className="w-8 shrink-0 text-right text-[color:var(--color-text-muted)] tabular-nums">×{item.quantity}</span>
              </div>
              {expanded && item.toppings.length > 0 && (
                <ul className="ml-3 mt-0.5 space-y-0">
                  {item.toppings.map((t) => (
                    <li key={t.menuId} className="flex items-baseline gap-2 text-xs text-[color:var(--color-text-muted)]">
                      <span className="flex-1 truncate">＋{t.name}</span>
                      <span className="w-8 shrink-0 text-right tabular-nums">×{t.quantity * item.quantity}</span>
                    </li>
                  ))}
                </ul>
              )}
              {expanded && item.note && (
                <p className="ml-3 mt-0.5 text-xs text-[color:var(--color-accent-warn)]">※ {item.note}</p>
              )}
            </li>
          ))}
        </ul>
        {order.items.length > PREVIEW && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="mt-1 text-xs text-[color:var(--color-accent-char)] hover:underline"
          >
            {expanded ? "▲ 閉じる" : `▼ 他${hiddenCount}品を見る`}
          </button>
        )}
      </div>
      <div className="shrink-0 pl-1">
        <p className="text-sm font-bold text-[color:var(--color-text-primary)] tabular-nums whitespace-nowrap">¥{taxIncluded(total).toLocaleString()}<span className="ml-1 text-xs font-normal text-[color:var(--color-text-muted)]">（税抜¥{total.toLocaleString()}）</span></p>
      </div>
    </div>
  );
}
