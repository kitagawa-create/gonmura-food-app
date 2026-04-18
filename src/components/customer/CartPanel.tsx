"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  documentId,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import { trackEvent } from "@/lib/analytics";
import { FadeImage } from "@/components/ui/FadeImage";
import { comboUnitPrice } from "@/lib/order-utils";

export function CartPanel({ hasOrders }: { hasOrders: boolean }) {
  const {
    items,
    updateQuantity,
    removeItem,
    updateItemNote,
    totalAmount,
    totalItems,
    clearCart,
    tableNumber,
    guestCount,
    customerId,
    setCustomerId,
  } = useCart();
  const [deleteTarget, setDeleteTarget] = useState<{ lineId: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [unavailableNames, setUnavailableNames] = useState<string[]>([]);
  const [imageMap, setImageMap] = useState<Record<string, string>>({});

  // 完了ダイアログは 3 秒で自動クローズ (画面は /menu のままなので遷移なし)
  useEffect(() => {
    if (!showComplete) return;
    const timer = setTimeout(() => setShowComplete(false), 3000);
    return () => clearTimeout(timer);
  }, [showComplete]);

  // カート内商品の画像URLを取得。ラーメンの画像のみ表示 (トッピングはテキスト表示で十分)
  useEffect(() => {
    const ids = items.map((i) => i.menuId);
    if (ids.length === 0) return;
    const missing = ids.filter((id) => !(id in imageMap));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      // Firestore 'in' クエリは最大30件
      const chunks: string[][] = [];
      for (let i = 0; i < missing.length; i += 30) chunks.push(missing.slice(i, i + 30));
      const next: Record<string, string> = {};
      for (const chunk of chunks) {
        const snap = await getDocs(
          query(collection(db, "menus"), where(documentId(), "in", chunk))
        );
        snap.docs.forEach((d) => {
          const data = d.data() as { imageUrl?: string };
          if (data.imageUrl) next[d.id] = data.imageUrl;
        });
      }
      if (!cancelled) setImageMap((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [items, imageMap]);

  async function handleSubmit() {
    if (submitting || !tableNumber || items.length === 0) return;
    setSubmitting(true);
    try {
      // コンボ本体 + 全トッピングの menuId を重複なく収集して一括で在庫確認
      const idSet = new Set<string>();
      for (const i of items) {
        idSet.add(i.menuId);
        for (const t of i.toppings) idSet.add(t.menuId);
      }
      const ids = Array.from(idSet);
      if (ids.length > 30) {
        alert("一度に注文できる商品数を超えています。点数を減らしてください。");
        setSubmitting(false);
        return;
      }
      const snap = await getDocs(
        query(collection(db, "menus"), where(documentId(), "in", ids))
      );
      // 非公開 (isAvailable=false) と 売り切れ (isSoldOut=true) は注文不可
      const orderable = new Map<string, boolean>();
      snap.docs.forEach((d) => {
        const data = d.data() as { isAvailable?: boolean; isSoldOut?: boolean };
        orderable.set(d.id, data.isAvailable === true && data.isSoldOut !== true);
      });
      // コンボ本体 または いずれかのトッピングが注文不可ならコンボ全体を落とす
      const unavailable = items.filter((i) => {
        if (orderable.get(i.menuId) !== true) return true;
        for (const t of i.toppings) {
          if (orderable.get(t.menuId) !== true) return true;
        }
        return false;
      });
      if (unavailable.length > 0) {
        setUnavailableNames(unavailable.map((i) => i.name));
        for (const i of unavailable) removeItem(i.lineId);
        setSubmitting(false);
        return;
      }

      let cid: string;
      if (customerId) {
        cid = customerId;
      } else {
        const customerRef = doc(collection(db, "customers"));
        await setDoc(customerRef, {
          tableNumber,
          guestCount: guestCount ?? 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        cid = customerRef.id;
        setCustomerId(cid);
      }

      const orderRef = doc(collection(db, "orders"));
      const batch = writeBatch(db);
      batch.set(orderRef, {
        status: "pending",
        customerId: cid,
        items: items.map((item) => ({
          id: crypto.randomUUID(),
          menuId: item.menuId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          checked: false,
          note: item.note,
          toppings: item.toppings.map((t) => ({
            menuId: t.menuId,
            name: t.name,
            price: t.price,
            quantity: t.quantity,
          })),
        })),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      for (const menuId of idSet) {
        batch.set(doc(db, "orderedMenus", menuId), { menuId }, { merge: true });
      }
      await batch.commit();

      trackEvent("purchase", {
        table_number: tableNumber,
        items_count: items.length,
        total_amount: totalAmount,
      });

      setShowComplete(true);
      setSubmitting(false);
      clearCart();
    } catch (err) {
      console.error("[CartPanel] order submission failed:", err);
      alert("注文の送信に失敗しました。もう一度お試しください。");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex h-full flex-col bg-[color:var(--color-bg-card)]">
        {/* ヘッダー */}
        <div className="shrink-0 border-b border-[color:var(--color-border)] px-3 py-2">
          <h2 className="text-sm font-bold text-[color:var(--color-text-primary)]">
            注文内容 <span className="text-[color:var(--color-text-muted)] font-normal">({totalItems}点)</span>
          </h2>
        </div>

        {/* ボディ (スクロール) */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-[color:var(--color-text-muted)]">
              カートは空です
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)]">
              {items.map((item) => {
                const img = imageMap[item.menuId];
                const unitPrice = comboUnitPrice(item);
                return (
                  <li key={item.lineId} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-[color:var(--color-bg-subtle)]">
                        {img ? (
                          <FadeImage src={img} alt={item.name} className="h-full w-full" />
                        ) : (
                          <div className="h-full w-full" aria-hidden />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-xs font-semibold text-[color:var(--color-text-primary)]">
                          {item.name}
                        </h3>
                        <p className="text-xs font-bold text-[color:var(--color-accent-char)] tabular-nums">
                          ¥{unitPrice.toLocaleString()}
                          {item.toppings.length > 0 && (
                            <span className="ml-1 text-[10px] font-normal text-[color:var(--color-text-muted)]">
                              /杯
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => item.quantity === 1 ? setDeleteTarget({ lineId: item.lineId, name: item.name }) : updateQuantity(item.lineId, item.quantity - 1)}
                          aria-label="数量を減らす"
                          className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--color-border)] text-sm text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-xs font-bold tabular-nums text-[color:var(--color-text-primary)]">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.lineId, item.quantity + 1)}
                          aria-label="数量を増やす"
                          className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--color-border)] text-sm text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget({ lineId: item.lineId, name: item.name })}
                        aria-label={`${item.name}を削除`}
                        className="shrink-0 p-1 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-warn)] transition-colors"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    {/* トッピング (ネスト表示) */}
                    {item.toppings.length > 0 && (
                      <ul className="mt-1 ml-14 space-y-0.5">
                        {item.toppings.map((t) => (
                          <li
                            key={t.menuId}
                            className="flex items-baseline justify-between text-[11px] text-[color:var(--color-text-muted)]"
                          >
                            <span className="truncate">＋ {t.name}</span>
                            <span className="shrink-0 tabular-nums">×{t.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {/* 商品ごとの備考 */}
                    <div className="mt-1.5 ml-14">
                      <input
                        type="text"
                        value={item.note}
                        onChange={(e) => updateItemNote(item.lineId, e.target.value)}
                        placeholder={`「${item.name}」への備考（アレルギー等）`}
                        maxLength={100}
                        className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-2 py-1 text-[11px] text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent-char)]"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

        </div>

        {/* フッター (固定) */}
        <div className="shrink-0 space-y-2 border-t border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-subtle)] px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[color:var(--color-text-primary)]">合計</span>
            <span className="text-lg font-bold text-[color:var(--color-accent-char)] tabular-nums">
              {totalAmount.toLocaleString()}円
            </span>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || items.length === 0}
            className="w-full rounded-xl bg-[color:var(--color-accent-char)] py-2.5 text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "送信中..." : "注文を確定する"}
          </button>
          <Link
            href="/bill"
            aria-disabled={!hasOrders}
            tabIndex={hasOrders ? undefined : -1}
            className={`block w-full rounded-xl py-2.5 text-center text-sm font-bold text-white transition-opacity ${
              hasOrders
                ? "bg-[color:var(--color-accent-warn)] hover:opacity-90"
                : "bg-[color:var(--color-text-muted)] pointer-events-none opacity-50 cursor-not-allowed"
            }`}
          >
            お会計
          </Link>
        </div>
      </div>

      {/* 品切れ通知 */}
      {unavailableNames.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setUnavailableNames([])}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-bold text-[color:var(--color-text-primary)]">
              品切れの商品があります
            </h2>
            <p className="mb-3 text-sm text-[color:var(--color-text-muted)]">
              以下の商品は品切れのため、カートから削除しました。
            </p>
            <ul className="mb-5 space-y-1 rounded-lg bg-[color:var(--color-bg-subtle)] px-4 py-3">
              {unavailableNames.map((n, i) => (
                <li key={i} className="text-sm text-[color:var(--color-accent-char)]">
                  ・{n}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setUnavailableNames([])}
              className="w-full rounded-xl bg-[color:var(--color-accent-char)] py-3 text-sm font-bold text-white hover:opacity-90 transition-opacity"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* 注文完了ダイアログ */}
      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-6 text-center">
            <div className="mb-3 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--color-accent-negi)]/15">
                <svg className="h-8 w-8 text-[color:var(--color-accent-negi)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </span>
            </div>
            <h2 className="mb-1 text-lg font-bold text-[color:var(--color-text-primary)]">
              注文を送信しました
            </h2>
            <p className="text-sm text-[color:var(--color-text-muted)]">
              調理が完了するまでしばらくお待ちください
            </p>
          </div>
        </div>
      )}

      {/* 削除確認ダイアログ */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-bold text-[color:var(--color-text-primary)]">
              商品を削除
            </h2>
            <p className="mb-5 text-sm text-[color:var(--color-text-muted)]">
              「{deleteTarget.name}」をカートから削除しますか？
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-xl border border-[color:var(--color-border)] py-3 text-sm font-medium text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  removeItem(deleteTarget.lineId);
                  setDeleteTarget(null);
                }}
                className="flex-1 rounded-xl bg-[color:var(--color-accent-warn)] py-3 text-sm font-bold text-white hover:opacity-90 transition-opacity"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
