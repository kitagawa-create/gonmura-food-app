"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageLoader } from "@/components/ui/PageLoader";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Category, Menu, Order } from "@/types";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { comboLineTotal } from "@/lib/order-utils";

const TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
});

// ---------- helpers ----------

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

// ---------- page ----------

export default function AdminOrdersPage() {
  const [view, setView] = useState<"orders" | "history">("orders");
  const [error, setError] = useState<string | null>(null);
  const toppingMenuIds = useToppingMenuIds();

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
        <NewOrdersView onError={setError} toppingMenuIds={toppingMenuIds} />
      ) : (
        <HistoryView onError={setError} toppingMenuIds={toppingMenuIds} />
      )}
    </div>
  );
}

// menus + categories から「トッピング」カテゴリに属する menuId の Set を取得。
// 描画毎ではなく一度だけ fetch し useMemo で Set 化する (パフォーマンス要件)。
function useToppingMenuIds(): Set<string> {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [menusSnap, catsSnap] = await Promise.all([
          getDocs(collection(db, "menus")),
          getDocs(collection(db, "categories")),
        ]);
        if (cancelled) return;
        setMenus(menusSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Menu, "id">) })));
        setCategories(
          catsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Category, "id">) }))
        );
      } catch {
        /* 失敗時は空のまま (グルーピングなしで表示継続) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const toppingCatIds = new Set(
      categories.filter((c) => c.name === "トッピング").map((c) => c.id)
    );
    const ids = new Set<string>();
    for (const m of menus) {
      if (m.categoryIds?.some((cid) => toppingCatIds.has(cid))) ids.add(m.id);
    }
    return ids;
  }, [menus, categories]);
}

// ========== 新規注文ビュー ==========

function NewOrdersView({
  onError,
  toppingMenuIds,
}: {
  onError: (msg: string | null) => void;
  toppingMenuIds: Set<string>;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<string>(todayISO());
  const [now, setNow] = useState(() => Date.now());
  const prevOrderCountRef = useRef<number | null>(null);

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
      collection(db, "orders"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<", Timestamp.fromDate(end)),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Omit<Order, "id">) })
        );
        // 新規注文ビューには pending のみ表示
        const active = all.filter(
          (o) => o.status === "pending"
        );

        if (
          prevOrderCountRef.current !== null &&
          all.length > prevOrderCountRef.current
        ) {
          playNotificationSound();
        }
        prevOrderCountRef.current = all.length;
        setOrders(active);
        setLoading(false);
      },
      (e) => {
        onError(e.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [dateFilter, onError]);

  const toggleCheck = useCallback(
    async (order: Order, itemIdx: number) => {
      onError(null);
      const prev = order.checkedItems ?? [];
      const next = prev.includes(itemIdx)
        ? prev.filter((i) => i !== itemIdx)
        : [...prev, itemIdx];

      // optimistic (チェック更新のみ、完了遷移はしない)
      setOrders((os) =>
        os.map((o) =>
          o.id === order.id ? { ...o, checkedItems: next } : o
        )
      );

      try {
        await updateDoc(doc(db, "orders", order.id), {
          checkedItems: next,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        setOrders((os) =>
          os.map((o) =>
            o.id === order.id ? { ...o, checkedItems: prev } : o
          )
        );
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  const completeOrder = useCallback(
    async (order: Order) => {
      onError(null);
      setOrders((os) => os.filter((o) => o.id !== order.id));
      try {
        await updateDoc(doc(db, "orders", order.id), {
          status: "completed",
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        setOrders((os) => [...os, order]);
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  const deleteOrder = useCallback(
    async (id: string) => {
      onError(null);
      try {
        await deleteDoc(doc(db, "orders", id));
      } catch (e) {
        onError(e instanceof Error ? e.message : "削除に失敗しました。");
      }
    },
    [onError]
  );

  // items[idx] を削除。最後の1件だった場合は注文自体を deleteDoc。
  // checkedItems は idx を除外 + idx より後ろのインデックスを 1 つ詰める。
  const cancelItem = useCallback(
    async (order: Order, idx: number) => {
      onError(null);
      const newItems = order.items.filter((_, i) => i !== idx);
      if (newItems.length === 0) {
        try {
          await deleteDoc(doc(db, "orders", order.id));
        } catch (e) {
          onError(e instanceof Error ? e.message : "削除に失敗しました。");
        }
        return;
      }
      const newChecked = (order.checkedItems ?? [])
        .filter((i) => i !== idx)
        .map((i) => (i > idx ? i - 1 : i));
      try {
        await updateDoc(doc(db, "orders", order.id), {
          items: newItems,
          checkedItems: newChecked,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  const bulkCheckAll = useCallback(
    async (order: Order) => {
      onError(null);
      const allIndices = order.items.map((_, i) => i);
      setOrders((os) =>
        os.map((o) => (o.id === order.id ? { ...o, checkedItems: allIndices } : o))
      );
      try {
        await updateDoc(doc(db, "orders", order.id), {
          checkedItems: allIndices,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        setOrders((os) =>
          os.map((o) =>
            o.id === order.id ? { ...o, checkedItems: order.checkedItems ?? [] } : o
          )
        );
        onError(e instanceof Error ? e.message : "更新に失敗しました。");
      }
    },
    [onError]
  );

  const bulkUncheckAll = useCallback(
    async (order: Order) => {
      onError(null);
      setOrders((os) =>
        os.map((o) => (o.id === order.id ? { ...o, checkedItems: [] } : o))
      );
      try {
        await updateDoc(doc(db, "orders", order.id), {
          checkedItems: [],
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        setOrders((os) =>
          os.map((o) =>
            o.id === order.id ? { ...o, checkedItems: order.checkedItems ?? [] } : o
          )
        );
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
        未完了: {orders.length}件
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {orders.map((order) => (
          <ActiveOrderCard
            key={order.id}
            order={order}
            now={now}
            toppingMenuIds={toppingMenuIds}
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
  now,
  toppingMenuIds,
  onToggle,
  onComplete,
  onDelete,
  onCancelItem,
  onBulkCheck,
  onBulkUncheck,
}: {
  order: Order;
  now: number;
  toppingMenuIds: Set<string>;
  onToggle: (order: Order, idx: number) => void;
  onComplete: (order: Order) => void;
  onDelete: (id: string) => void;
  onCancelItem: (order: Order, idx: number) => void;
  onBulkCheck: (order: Order) => void;
  onBulkUncheck: (order: Order) => void;
}) {
  const [showCancel, setShowCancel] = useState(false);
  const [cancelItemIdx, setCancelItemIdx] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [autoCompleteCountdown, setAutoCompleteCountdown] = useState<number | null>(null);
  const total = order.items.reduce((s, i) => s + comboLineTotal(i), 0);
  const created = order.createdAt?.toDate?.();
  const elapsed = created ? timeAgo(created) : "";
  const checked = new Set(order.checkedItems ?? []);
  const allDone = checked.size >= order.items.length;
  const progress = `${checked.size}/${order.items.length}`;

  // 全チェック時に5秒後自動で提供完了。編集中(取消操作の途中)は停止。
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

  // 10分以上経過した pending 注文は赤枠 + 赤バッジで強調。
  const isUrgent =
    order.status === "pending" &&
    !!created &&
    now - created.getTime() > 10 * 60 * 1000;

  const cancelTarget = cancelItemIdx !== null ? order.items[cancelItemIdx] : null;
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
          T{order.tableNumber}
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

      {/* 備考 */}
      {order.customerNote && (
        <div className="mb-3 rounded-lg border-l-4 border-[color:var(--color-accent-warn)] bg-[color:var(--color-accent-warn)]/10 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--color-accent-warn)]">
            備考
          </p>
          <p className="text-base leading-snug text-[color:var(--color-text-primary)]">
            {order.customerNote}
          </p>
        </div>
      )}

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
          disabled={checked.size === 0}
          className="flex-1 rounded-lg border border-[color:var(--color-border)] px-2 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] disabled:cursor-not-allowed disabled:opacity-30 transition-colors"
        >
          全取り消し
        </button>
      </div>
      {/* 商品チェックリスト */}
      <ul className="mb-3 space-y-1">
        {order.items.map((item, idx) => {
          const done = checked.has(idx);
          // 新スキーマ: item.toppings に含まれる → コンボ1杯としてネスト表示
          // 旧スキーマ: toppings 未設定 → menuId ベースの heuristic で 1 行分インデント
          const hasNestedToppings = !!item.toppings && item.toppings.length > 0;
          const isLegacyTopping = !hasNestedToppings && toppingMenuIds.has(item.menuId);
          return (
            <li key={`${item.menuId}-${idx}`} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => onToggle(order, idx)}
                className={`flex-1 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  done
                    ? "bg-[color:var(--color-accent-negi)]/10"
                    : "bg-[color:var(--color-bg-subtle)] hover:bg-[color:var(--color-bg-subtle)]/80"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* チェックボックス */}
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
                      isLegacyTopping ? "pl-5" : ""
                    } ${
                      done
                        ? "line-through text-[color:var(--color-text-muted)]"
                        : "text-[color:var(--color-text-primary)]"
                    }`}
                  >
                    {isLegacyTopping && (
                      <span className="mr-1 text-[color:var(--color-text-muted)]">＋</span>
                    )}
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
                {/* ネストトッピング: チェックなしで一覧表示 (コンボ全体のチェックで共に提供扱い) */}
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
              </button>
              {editMode && (
                <button
                  type="button"
                  onClick={() => setCancelItemIdx(idx)}
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
          <button
            type="button"
            onClick={() => setShowCancel(true)}
            className="rounded-lg border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
          >
            取消
          </button>
          <p className="text-[11px] text-[color:var(--color-text-muted)]">
            ¥{total.toLocaleString()}
          </p>
        </div>
      )}

      <ConfirmDialog
        open={showCancel}
        title={`テーブル ${order.tableNumber} の注文を削除`}
        message={`${order.items.map((i) => i.name).join("、")}（¥${total.toLocaleString()}）を削除しますか？この操作は取り消せません。`}
        confirmLabel="削除する"
        confirmColor="red"
        onConfirm={() => {
          onDelete(order.id);
          setShowCancel(false);
        }}
        onCancel={() => setShowCancel(false)}
      />

      <ConfirmDialog
        open={cancelItemIdx !== null}
        title={`商品をキャンセル`}
        message={
          cancelTarget
            ? `${cancelTarget.name} ×${cancelTarget.quantity}（¥${comboLineTotal(cancelTarget).toLocaleString()}）をキャンセルしますか？${isLastItem ? "これが最後の商品のため注文自体が削除されます。" : ""}`
            : ""
        }
        confirmLabel={isLastItem ? "注文を削除" : "キャンセルする"}
        confirmColor="red"
        onConfirm={() => {
          if (cancelItemIdx !== null) onCancelItem(order, cancelItemIdx);
          setCancelItemIdx(null);
        }}
        onCancel={() => setCancelItemIdx(null)}
      />
    </div>
  );
}

// ========== 履歴ビュー ==========

function HistoryView({
  onError,
  toppingMenuIds,
}: {
  onError: (msg: string | null) => void;
  toppingMenuIds: Set<string>;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateSearch, setDateSearch] = useState<string>(todayISO());
  const [tableFilter, setTableFilter] = useState<number | null>(null);

  // completed → pending に戻す。paid は register のドーナツ集計が壊れるため不可。
  const revertOrder = useCallback(
    async (order: Order) => {
      onError(null);
      if (order.status === "paid") return;
      try {
        await updateDoc(doc(db, "orders", order.id), {
          status: "pending",
          checkedItems: [],
          updatedAt: serverTimestamp(),
        });
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
      collection(db, "orders"),
      where("status", "in", ["completed", "paid"]),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<", Timestamp.fromDate(end)),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setOrders(
          snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as Omit<Order, "id">) })
          )
        );
        setLoading(false);
      },
      (e) => {
        onError(e.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [dateSearch, onError]);

  const totalAmount = useMemo(
    () => orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.price * i.quantity, 0), 0),
    [orders]
  );

  const availableTables = useMemo(
    () => [...new Set(orders.map((o) => o.tableNumber))].sort((a, b) => a - b),
    [orders]
  );

  const filteredOrders = useMemo(
    () => (tableFilter !== null ? orders.filter((o) => o.tableNumber === tableFilter) : orders),
    [orders, tableFilter]
  );

  return (
    <div className="flex-1 overflow-y-auto -mr-3 md:-mr-6 pr-3 md:pr-6">
      {/* 日付検索 */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="date"
          value={dateSearch}
          onChange={(e) => {
            const v = e.target.value;
            if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
              setDateSearch(v);
              setTableFilter(null);
            }
          }}
          onKeyDown={(e) => e.preventDefault()}
          className="bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
        />
        <button
          type="button"
          onClick={() => setDateSearch(todayISO())}
          className="rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
        >
          今日
        </button>
        <select
          value={tableFilter ?? ""}
          onChange={(e) =>
            setTableFilter(e.target.value === "" ? null : Number(e.target.value))
          }
          className="bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
        >
          <option value="">全テーブル</option>
          {availableTables.map((n) => (
            <option key={n} value={n}>
              T{n}
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
              toppingMenuIds={toppingMenuIds}
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
  toppingMenuIds,
  onRevert,
}: {
  order: Order;
  toppingMenuIds: Set<string>;
  onRevert: (order: Order) => void;
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
            T{order.tableNumber}
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
        {order.items.map((item, i) => {
          const hasNestedToppings = !!item.toppings && item.toppings.length > 0;
          const isLegacyTopping = !hasNestedToppings && toppingMenuIds.has(item.menuId);
          return (
            <li key={i}>
              <div className={`flex justify-between ${isLegacyTopping ? "pl-4" : ""}`}>
                <span>
                  {isLegacyTopping && (
                    <span className="mr-1 text-[color:var(--color-text-muted)]">＋</span>
                  )}
                  {item.name}
                </span>
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
            </li>
          );
        })}
      </ul>
      {order.customerNote && (
        <p className="mt-2 text-xs text-[color:var(--color-text-muted)] border-t border-[color:var(--color-border)] pt-2">
          備考: {order.customerNote}
        </p>
      )}

      {/* 新規に戻す (paid は register ドーナツ集計が壊れるため非表示) */}
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
        title={`テーブル ${order.tableNumber} の注文を新規に戻す`}
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
