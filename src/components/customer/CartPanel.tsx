"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  documentId,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import { trackEvent } from "@/lib/analytics";
import type { CartItem } from "@/types";
import { FadeImage } from "@/components/ui/FadeImage";
import { taxIncluded } from "@/lib/order-utils";

export function CartPanel({
  hasOrders,
  onEditItem,
}: {
  hasOrders: boolean;
  onEditItem?: (item: CartItem) => void;
}) {
  const {
    items,
    updateQuantity,
    removeItem,
    updateItemNote,
    totalAmount,
    totalItems,
    clearCart,
    tableNumber,
    customerId,
  } = useCart();
  const [deleteTarget, setDeleteTarget] = useState<{ lineId: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [unavailableNames, setUnavailableNames] = useState<string[]>([]);
  const [imageMap, setImageMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!showComplete) return;
    const timer = setTimeout(() => setShowComplete(false), 3000);
    return () => clearTimeout(timer);
  }, [showComplete]);

  // メインアイテムの画像のみ取得
  useEffect(() => {
    const ids = items.filter((i) => i.setId === i.lineId).map((i) => i.menuId);
    if (ids.length === 0) return;
    const missing = ids.filter((id) => !(id in imageMap));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
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
    return () => { cancelled = true; };
  }, [items, imageMap]);

  // メインアイテム順に親子関係でグループ化
  const orderedSets = useMemo(() => {
    return items
      .filter((i) => i.setId === i.lineId)
      .map((main) => ({
        main,
        sides: items.filter((s) => s.setId === main.lineId),
      }));
  }, [items]);

  async function handleSubmit() {
    if (submitting || !tableNumber || items.length === 0) return;
    setSubmitting(true);
    try {
      // 全アイテムの menuId を収集して在庫確認
      const idSet = new Set<string>(items.map((i) => i.menuId));
      const ids = Array.from(idSet);
      if (ids.length > 50) {
        alert("一度に注文できる商品数を超えています。点数を減らしてください。");
        setSubmitting(false);
        return;
      }
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
      const snapDocs = (
        await Promise.all(chunks.map((chunk) => getDocs(query(collection(db, "menus"), where(documentId(), "in", chunk)))))
      ).flatMap((s) => s.docs);

      const orderable = new Map<string, boolean>();
      snapDocs.forEach((d) => {
        const data = d.data() as { status?: string };
        orderable.set(d.id, data.status === "active");
      });

      // セット単位で在庫チェック：メインまたは任意のサイドが注文不可ならセット全体を除外
      const unavailableSets = new Set<string>();
      for (const { main, sides } of orderedSets) {
        if (orderable.get(main.menuId) !== true) { unavailableSets.add(main.lineId); continue; }
        for (const s of sides) {
          if (orderable.get(s.menuId) !== true) { unavailableSets.add(main.lineId); break; }
        }
      }

      if (unavailableSets.size > 0) {
        const names = orderedSets
          .filter(({ main }) => unavailableSets.has(main.lineId))
          .map(({ main }) => main.name);
        setUnavailableNames(names);
        for (const { main } of orderedSets) {
          if (unavailableSets.has(main.lineId)) removeItem(main.lineId);
        }
        setSubmitting(false);
        return;
      }

      if (!customerId) throw new Error("customerId is not set");
      const cid = customerId;

      const orderRef = doc(collection(db, "customers", cid, "orders"));
      const batch = writeBatch(db);
      batch.set(orderRef, {
        orderId: orderRef.id,
        customerId: cid,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const item of items) {
        const itemId = crypto.randomUUID();
        batch.set(doc(db, "customers", cid, "orders", orderRef.id, "items", itemId), {
          itemId,
          menuId: item.menuId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          setId: item.setId,
          checked: false,
          note: item.note,
          customerId: cid,
          orderId: orderRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();

      trackEvent("purchase", {
        table_number: tableNumber,
        items_count: orderedSets.length,
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

        {/* ボディ */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {orderedSets.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-[color:var(--color-text-muted)]">
              カートは空です
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)] border-b border-[color:var(--color-border)]">
              {orderedSets.map(({ main, sides }) => {
                const img = imageMap[main.menuId];
                const setTotal = main.price + sides.reduce((s, sd) => s + sd.price * sd.quantity, 0);
                const isSet = sides.length > 0;
                return (
                  <li key={main.lineId} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEditItem?.(main)}
                        disabled={!onEditItem}
                        aria-label={`${main.name}を編集`}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:pointer-events-none"
                      >
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-[color:var(--color-bg-subtle)]">
                          {img ? (
                            <FadeImage src={img} alt={main.name} className="h-full w-full" />
                          ) : (
                            <div className="h-full w-full" aria-hidden />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-xs font-semibold text-[color:var(--color-text-primary)]">
                            {main.name}
                          </h3>
                          <p className="text-xs font-bold text-[color:var(--color-accent-char)] tabular-nums">
                            ¥{taxIncluded(setTotal).toLocaleString()}
                            <span className="ml-1 font-normal text-[color:var(--color-text-muted)]">（税抜¥{setTotal.toLocaleString()}）</span>
                          </p>
                        </div>
                        {onEditItem && (
                          <svg className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        )}
                      </button>

                      {/* 単品のみ数量変更可 */}
                      {!isSet && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              main.quantity === 1
                                ? setDeleteTarget({ lineId: main.lineId, name: main.name })
                                : updateQuantity(main.lineId, main.quantity - 1)
                            }
                            aria-label="数量を減らす"
                            className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--color-border)] text-sm text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
                          >
                            −
                          </button>
                          <span className="w-5 text-center text-xs font-bold tabular-nums text-[color:var(--color-text-primary)]">
                            {main.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(main.lineId, main.quantity + 1)}
                            aria-label="数量を増やす"
                            className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--color-border)] text-sm text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
                          >
                            +
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setDeleteTarget({ lineId: main.lineId, name: main.name })}
                        aria-label={`${main.name}を削除`}
                        className="shrink-0 p-1 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-warn)] transition-colors"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* サイドメニュー（ネスト表示） */}
                    {sides.length > 0 && (
                      <ul className="mt-1 ml-14 space-y-0.5">
                        {sides.map((s) => (
                          <li
                            key={s.lineId}
                            className="flex items-baseline justify-between text-[11px] text-[color:var(--color-text-muted)]"
                          >
                            <span className="truncate">＋ {s.name}</span>
                            <span className="shrink-0 tabular-nums">×{s.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* 備考 */}
                    <div className="mt-1.5 ml-14">
                      <input
                        type="text"
                        value={main.note}
                        onChange={(e) => updateItemNote(main.lineId, e.target.value)}
                        placeholder={`「${main.name}」への備考（アレルギー等）`}
                        maxLength={100}
                        className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-subtle)] px-2 py-1 text-[11px] text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent-char)]"
                      />
                      {main.note.length > 0 && (
                        <p className={`mt-0.5 text-right text-[10px] ${main.note.length >= 90 ? "text-[color:var(--color-accent-warn)]" : "text-[color:var(--color-text-muted)]"}`}>
                          {main.note.length}/100
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* フッター */}
        <div className="shrink-0 space-y-2 border-t border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-subtle)] px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[color:var(--color-text-primary)]">合計</span>
            <span className="text-lg font-bold text-[color:var(--color-accent-char)] tabular-nums">
              {taxIncluded(totalAmount).toLocaleString()}円
              <span className="ml-1 text-xs font-normal text-[color:var(--color-text-muted)]">（税抜{totalAmount.toLocaleString()}円）</span>
            </span>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || orderedSets.length === 0}
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
            <h2 className="mb-2 text-lg font-bold text-[color:var(--color-text-primary)]">品切れの商品があります</h2>
            <p className="mb-3 text-sm text-[color:var(--color-text-muted)]">以下の商品は品切れのため、カートから削除しました。</p>
            <ul className="mb-5 space-y-1 rounded-lg bg-[color:var(--color-bg-subtle)] px-4 py-3">
              {unavailableNames.map((n, i) => (
                <li key={i} className="text-sm text-[color:var(--color-accent-char)]">・{n}</li>
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
            <h2 className="mb-1 text-lg font-bold text-[color:var(--color-text-primary)]">注文を送信しました</h2>
            <p className="text-sm text-[color:var(--color-text-muted)]">調理が完了するまでしばらくお待ちください</p>
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
            <h2 className="mb-2 text-lg font-bold text-[color:var(--color-text-primary)]">商品を削除</h2>
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
