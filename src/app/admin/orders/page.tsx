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
import { normalizeOrder, normalizeOrderItem, comboLineTotal } from "@/lib/order-utils";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DatePicker } from "@/components/admin/DatePicker";

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
      onSnapshot(query(collectionGroup(db, "items"), where("orderId", "==", order.id)), (snap) => {
        setItemsByOrder((prev) => {
          const next = new Map(prev);
          next.set(order.id, snap.docs.map((d) => normalizeOrderItem(d.id, d.data() as Record<string, unknown>)));
          return next;
        });
      })
    );
    return () => unsubscribers.forEach((u) => u());
  }, [orders]);

  const ordersWithItems: OrderWithItems[] = useMemo(
    () => orders.map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] })),
    [orders, itemsByOrder]
  );

  const toggleCheck = useCallback(
    async (order: OrderWithItems, itemId: string) => {
      onError(null);
      const item = order.items.find((i) => i.id === itemId);
      if (!item) return;
      const newChecked = !item.checked;

      setItemsByOrder((prev) => {
        const next = new Map(prev);
        next.set(order.id, (prev.get(order.id) ?? []).map((i) => i.id === itemId ? { ...i, checked: newChecked } : i));
        return next;
      });

      try {
        await updateDoc(doc(db, "customers", order.customerId, "orders", order.id, "items", itemId), {
          checked: newChecked,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        setItemsByOrder((prev) => {
          const next = new Map(prev);
          next.set(order.id, (prev.get(order.id) ?? []).map((i) => i.id === itemId ? { ...i, checked: item.checked } : i));
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
      const orderBase: Order = { id: order.id, status: order.status, customerId: order.customerId, createdAt: order.createdAt, updatedAt: order.updatedAt };
      setOrders((os) => os.filter((o) => o.id !== order.id));
      try {
        await updateDoc(doc(db, "customers", order.customerId, "orders", order.id), {
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
        const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.id)));
        const batch = writeBatch(db);
        for (const d of itemsSnap.docs) batch.delete(d.ref);
        batch.delete(doc(db, "customers", order.customerId, "orders", order.id));
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
          const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.id)));
          const batch = writeBatch(db);
          for (const d of itemsSnap.docs) batch.delete(d.ref);
          batch.delete(doc(db, "customers", order.customerId, "orders", order.id));
          await batch.commit();
        } else {
          await deleteDoc(doc(db, "customers", order.customerId, "orders", order.id, "items", itemId));
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
        next.set(order.id, (prev.get(order.id) ?? []).map((i) => ({ ...i, checked: true })));
        return next;
      });
      try {
        const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.id)));
        const batch = writeBatch(db);
        const ts = serverTimestamp();
        for (const d of itemsSnap.docs) batch.update(d.ref, { checked: true, updatedAt: ts });
        await batch.commit();
      } catch (e) {
        setItemsByOrder((prev) => {
          const next = new Map(prev);
          next.set(order.id, order.items);
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
        next.set(order.id, (prev.get(order.id) ?? []).map((i) => ({ ...i, checked: false })));
        return next;
      });
      try {
        const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.id)));
        const batch = writeBatch(db);
        const ts = serverTimestamp();
        for (const d of itemsSnap.docs) batch.update(d.ref, { checked: false, updatedAt: ts });
        await batch.commit();
      } catch (e) {
        setItemsByOrder((prev) => {
          const next = new Map(prev);
          next.set(order.id, order.items);
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
            key={order.id}
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
    ? order.items.find((i) => i.id === cancelItemId) ?? null
    : null;
  const isLastItem = order.items.length === 1;

  return (
    <div
      className={`rounded-xl p-4 transition-colors ${
        isUrgent
          ? "bg-[color:var(--color-accent-warn)]/10 border-2 border-[color:var(--color-accent-warn)]"
          : "bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] shadow-sm"
      }`}
    >
      {/* テーブル番号 + 経過 + 進捗 + 編集 */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="inline-flex items-center justify-center min-w-[56px] h-12 px-3 rounded-lg bg-[color:var(--color-accent-char)] text-white text-2xl font-black leading-none">
          {tableNumber ?? "?"}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[color:var(--color-text-muted)]">{progress}</span>
          <span
            className={`inline-flex items-center rounded-lg text-lg font-bold leading-none ${
              isUrgent
                ? "px-3 py-2 bg-[color:var(--color-accent-warn)] text-white"
                : "px-2 py-1 text-[color:var(--color-text-primary)]"
            }`}
          >
            {elapsed}
          </span>
          <button
            type="button"
            onClick={() => setEditMode((m) => !m)}
            aria-label={editMode ? "編集終了" : "編集"}
            aria-pressed={editMode}
            className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              editMode
                ? "bg-[color:var(--color-accent-char)] text-white"
                : "border border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
            }`}
          >
            {editMode ? "完了" : "編集"}
          </button>
        </div>
      </div>

      {/* 一括操作 */}
      <div className="mb-2 flex gap-2">
        <button
          type="button"
          onClick={() => onBulkCheck(order)}
          disabled={allDone}
          className="flex-1 rounded-lg border border-[color:var(--color-border)] px-2 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] disabled:cursor-not-allowed disabled:opacity-30 transition-colors"
        >
          全チェック
        </button>
        <button
          type="button"
          onClick={() => onBulkUncheck(order)}
          disabled={checkedCount === 0}
          className="flex-1 rounded-lg border border-[color:var(--color-border)] px-2 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] disabled:cursor-not-allowed disabled:opacity-30 transition-colors"
        >
          全取り消し
        </button>
      </div>

      {/* 商品チェックリスト */}
      <ul className="mb-3 space-y-1">
        {order.items.map((item) => {
          const done = item.checked;
          const hasNestedToppings = item.toppings.length > 0;
          return (
            <li key={item.id} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => onToggle(order, item.id)}
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
                      <svg
                        className="h-4 w-4 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </span>
                  <span
                    className={`flex-1 text-lg leading-tight ${
                      done
                        ? "line-through text-[color:var(--color-text-muted)]"
                        : "text-[color:var(--color-text-primary)]"
                    }`}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`whitespace-nowrap text-xl font-bold ${
                      done
                        ? "text-[color:var(--color-text-muted)]"
                        : "text-[color:var(--color-accent-char)]"
                    }`}
                  >
                    ×{item.quantity}
                  </span>
                </div>
                {hasNestedToppings && (
                  <ul className="mt-1 ml-10 space-y-0.5">
                    {item.toppings!.map((t) => (
                      <li
                        key={t.menuId}
                        className={`flex items-baseline justify-between text-base ${
                          done
                            ? "text-[color:var(--color-text-muted)] line-through"
                            : "text-[color:var(--color-text-primary)]"
                        }`}
                      >
                        <span>
                          <span className="mr-1 text-[color:var(--color-text-muted)]">＋</span>
                          {t.name}
                        </span>
                        <span className="tabular-nums font-semibold">
                          ×{t.quantity * item.quantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {item.note && (
                  <p className="mt-1 ml-10 text-xs text-[color:var(--color-accent-warn)]">
                    ※ {item.note}
                  </p>
                )}
              </button>
              {editMode && (
                <button
                  type="button"
                  onClick={() => setCancelItemId(item.id)}
                  aria-label={`${item.name} をキャンセル`}
                  className="shrink-0 w-9 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] text-lg text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-accent-warn)]/10 hover:text-[color:var(--color-accent-warn)] transition-colors"
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
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
      ) : (
        <div className="flex items-center justify-between">
          {editMode ? (
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
            >
              取消
            </button>
          ) : (
            <span />
          )}
          <p className="text-[11px] text-[color:var(--color-text-muted)]">
            ¥{total.toLocaleString()}
          </p>
        </div>
      )}

      <ConfirmDialog
        open={showCancel}
        title={`テーブル ${tableNumber ?? "?"} の注文を削除`}
        message={`${order.items.map((i) => i.name).join("、")}（¥${total.toLocaleString()}）を削除しますか？この操作は取り消せません。`}
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
            ? `${cancelTarget.name} ×${cancelTarget.quantity}（¥${comboLineTotal(cancelTarget).toLocaleString()}）をキャンセルしますか？${isLastItem ? "これが最後の商品のため注文自体が削除されます。" : ""}`
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

function HistoryView({
  onError,
}: {
  onError: (msg: string | null) => void;
}) {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [customerInfoMap, setCustomerInfoMap] = useState<Map<string, CustomerInfo>>(new Map());
  const [tableNumberMap, setTableNumberMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dateSearch, setDateSearch] = useState<string>(todayISO());
  const [tableFilter, setTableFilter] = useState<string | null>(null);

  // tables コレクションをリアルタイム購読して tableId→tableNumber マップを維持
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
      if (order.status === "paid") return;
      try {
        const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.id)));
        const batch = writeBatch(db);
        const ts = serverTimestamp();
        for (const d of itemsSnap.docs) batch.update(d.ref, { checked: false, updatedAt: ts });
        batch.update(doc(db, "customers", order.customerId, "orders", order.id), { status: "pending", updatedAt: ts });
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

    const q = query(
      collectionGroup(db, "orders"),
      where("status", "in", ["completed", "paid"]),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<", Timestamp.fromDate(end)),
      orderBy("createdAt", "desc")
    );
    let cancelled = false;
    let gen = 0;
    const unsub = onSnapshot(
      q,
      async (snap) => {
        const current = ++gen;
        const orderDocs = snap.docs
          .filter((d) => d.ref.parent.parent !== null)
          .map((d) => normalizeOrder(d.id, d.data() as Record<string, unknown>, d.ref.parent.parent!.id));
        const withItems = await Promise.all(
          orderDocs.map(async (order) => {
            const itemsSnap = await getDocs(query(collectionGroup(db, "items"), where("orderId", "==", order.id)));
            return {
              ...order,
              items: itemsSnap.docs.map((d) => normalizeOrderItem(d.id, d.data() as Record<string, unknown>)),
            } as OrderWithItems;
          })
        );
        const ids = [...new Set(orderDocs.map((o) => o.customerId))];
        const ctMap = await fetchCustomerInfo(ids);
        if (cancelled || current !== gen) return;
        setCustomerInfoMap(ctMap);
        setOrders(withItems);
        setLoading(false);
      },
      (e) => {
        if (!cancelled) { onError(e.message); setLoading(false); }
      }
    );
    return () => { cancelled = true; unsub(); };
  }, [dateSearch, onError]);

  const getTableNumber = useCallback(
    (customerId: string) =>
      tableNumberMap.get(customerInfoMap.get(customerId)?.tableId ?? "") ?? "",
    [customerInfoMap, tableNumberMap]
  );

  const availableTables = useMemo(
    () =>
      [...new Set(orders.map((o) => getTableNumber(o.customerId)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "ja")),
    [orders, getTableNumber]
  );

  const filteredOrders = useMemo(
    () =>
      tableFilter !== null
        ? orders.filter((o) => getTableNumber(o.customerId) === tableFilter)
        : orders,
    [orders, tableFilter, getTableNumber]
  );

  return (
    <div className="flex-1 overflow-y-auto -mr-3 md:-mr-6 pr-3 md:pr-6">
      {/* 日付検索 */}
      <div className="flex items-center gap-3 mb-4">
        <DatePicker
          value={dateSearch}
          onChange={(v) => { setDateSearch(v); setTableFilter(null); }}
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
        <select
          value={tableFilter ?? ""}
          onChange={(e) =>
            setTableFilter(e.target.value === "" ? null : e.target.value)
          }
          className="bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
        >
          <option value="">全テーブル</option>
          {availableTables.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-xs text-[color:var(--color-text-muted)]">
          {filteredOrders.length}件
          {tableFilter !== null && ` / 全${orders.length}件`}
          {" "}/ ¥{filteredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + comboLineTotal(i), 0), 0).toLocaleString()}
        </span>
      </div>

      {loading ? (
        <PageLoader />
      ) : filteredOrders.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-[color:var(--color-text-muted)]">この日の履歴はありません</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredOrders.map((order) => (
            <HistoryOrderCard
              key={order.id}
              order={order}
              tableNumber={getTableNumber(order.customerId) || "?"}
              onRevert={revertOrder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 履歴カード ----------

function HistoryOrderCard({
  order,
  tableNumber,
  onRevert,
}: {
  order: OrderWithItems;
  tableNumber: string;
  onRevert: (order: OrderWithItems) => void;
}) {
  const [showRevert, setShowRevert] = useState(false);
  const total = order.items.reduce((s, i) => s + comboLineTotal(i), 0);
  const created = order.createdAt?.toDate?.();
  const isPaid = order.status === "paid";

  return (
    <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center min-w-[40px] h-8 px-2 rounded-md bg-[color:var(--color-accent-soy)] text-white text-sm font-bold leading-none">
            {tableNumber ?? "?"}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              isPaid
                ? "bg-[color:var(--color-accent-negi)]/15 text-[color:var(--color-accent-negi)]"
                : "bg-[color:var(--color-bg-subtle)] text-[color:var(--color-text-muted)]"
            }`}
          >
            {isPaid ? "精算済" : "提供済"}
          </span>
        </div>
        <div className="text-right">
          <p className="text-xs text-[color:var(--color-text-muted)]">
            {created ? timeStr(created) : ""}
          </p>
          <p className="text-sm font-bold text-[color:var(--color-text-primary)] tabular-nums">
            ¥{total.toLocaleString()}
          </p>
        </div>
      </div>
      <ul className="text-sm text-[color:var(--color-text-primary)] space-y-0.5">
        {order.items.map((item) => {
          const hasNestedToppings = item.toppings.length > 0;
          return (
            <li key={item.id}>
              <div className="flex justify-between">
                <span>{item.name}</span>
                <span className="text-[color:var(--color-text-muted)]">×{item.quantity}</span>
              </div>
              {hasNestedToppings && (
                <ul className="mt-0.5 ml-4 space-y-0">
                  {item.toppings!.map((t) => (
                    <li
                      key={t.menuId}
                      className="flex justify-between text-xs text-[color:var(--color-text-muted)]"
                    >
                      <span>
                        <span className="mr-0.5">＋</span>
                        {t.name}
                      </span>
                      <span>×{t.quantity * item.quantity}</span>
                    </li>
                  ))}
                </ul>
              )}
              {item.note && (
                <p className="mt-0.5 ml-4 text-xs text-[color:var(--color-accent-warn)]">
                  ※ {item.note}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {!isPaid && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setShowRevert(true)}
            className="rounded-lg border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
          >
            新規に戻す
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showRevert}
        title={`テーブル ${tableNumber ?? "?"} の注文を新規に戻す`}
        message="この注文を提供前(新規)に戻します。チェック状態はすべてリセットされます。"
        confirmLabel="戻す"
        confirmColor="green"
        onConfirm={() => {
          onRevert(order);
          setShowRevert(false);
        }}
        onCancel={() => setShowRevert(false)}
      />
    </div>
  );
}
