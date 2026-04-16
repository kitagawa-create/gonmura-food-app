"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  documentId,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCart } from "@/lib/cart-context";
import { trackEvent } from "@/lib/analytics";
import { BackButton } from "@/components/ui/BackButton";
import { FadeImage } from "@/components/ui/FadeImage";
import Link from "next/link";

export default function OrderPage() {
  const { items, updateQuantity, removeItem, totalAmount, totalItems, clearCart, tableNumber } =
    useCart();
  const [customerNote, setCustomerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [unavailableNames, setUnavailableNames] = useState<string[]>([]);
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const router = useRouter();

  // カート内商品の画像URLを取得 (CartItem に imageUrl を持たせず、表示用にだけ取得)
  useEffect(() => {
    const ids = items.map((i) => i.menuId);
    if (ids.length === 0) {
      setImageMap({});
      return;
    }
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

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-[color:var(--color-bg-base)] flex flex-col items-center justify-center px-4">
        <p className="text-[color:var(--color-text-muted)] text-lg mb-4">カートが空です</p>
        <Link
          href="/menu"
          className="text-[color:var(--color-accent-char)] font-medium hover:underline"
        >
          メニューに戻る
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !tableNumber) return;
    setSubmitting(true);

    try {
      const ids = items.map((i) => i.menuId);
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
      const unavailable = items.filter((i) => orderable.get(i.menuId) !== true);
      if (unavailable.length > 0) {
        setUnavailableNames(unavailable.map((i) => i.name));
        for (const i of unavailable) removeItem(i.menuId);
        setSubmitting(false);
        return;
      }

      const orderRef = doc(collection(db, "orders"));
      await setDoc(orderRef, {
        items: items.map((item) => ({
          menuId: item.menuId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        })),
        status: "pending",
        tableNumber,
        customerNote,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      trackEvent("purchase", {
        table_number: tableNumber,
        items_count: items.length,
        total_amount: totalAmount,
      });

      clearCart();
      router.push(`/order/${orderRef.id}`);
    } catch {
      alert("注文の送信に失敗しました。もう一度お試しください。");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[color:var(--color-bg-base)] pb-36">
      <header className="sticky top-0 z-10 bg-[color:var(--color-bg-card)] border-b border-[color:var(--color-border)]">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 lg:px-8 py-2 flex items-center gap-2">
          <BackButton href="/menu" label="メニューに戻る" />
          <h1 className="text-lg font-bold text-[color:var(--color-text-primary)]">注文確認</h1>
          <span className="ml-auto text-xs text-[color:var(--color-text-muted)]">
            テーブル {tableNumber} / {totalItems}点
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
        {/* カート + 合計 を 1 つの連結カードに (二重線回避) */}
        <section className="bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] overflow-hidden">
          <ul className="divide-y divide-[color:var(--color-border)]">
            {items.map((item) => {
              const img = imageMap[item.menuId];
              return (
                <li key={item.menuId} className="flex items-center gap-3 px-3 sm:px-4 py-3">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-lg overflow-hidden bg-[color:var(--color-bg-subtle)]">
                    {img ? (
                      <FadeImage src={img} alt={item.name} className="w-full h-full" />
                    ) : (
                      <div className="w-full h-full" aria-hidden />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-[color:var(--color-text-primary)] text-sm truncate">
                      {item.name}
                    </h3>
                    <p className="text-[color:var(--color-accent-char)] font-bold text-sm">
                      {item.price.toLocaleString()}円
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.menuId, item.quantity - 1)}
                        className="w-8 h-8 rounded-full border border-[color:var(--color-border)] flex items-center justify-center text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
                        aria-label="数量を減らす"
                      >
                        −
                      </button>
                      <span className="font-bold text-[color:var(--color-text-primary)] w-7 text-center text-sm tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.menuId, item.quantity + 1)}
                        className="w-8 h-8 rounded-full border border-[color:var(--color-border)] flex items-center justify-center text-[color:var(--color-text-primary)] hover:opacity-80 transition-opacity"
                        aria-label="数量を増やす"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.menuId)}
                        aria-label={`${item.name}を削除`}
                        className="ml-auto p-2 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-warn)] transition-colors"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[color:var(--color-text-primary)] font-semibold text-sm tabular-nums w-20">
                    {(item.price * item.quantity).toLocaleString()}円
                  </div>
                </li>
              );
            })}
          </ul>

          {/* 合計行 (連結カード内、border-t-strong で強調) */}
          <div className="border-t border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-subtle)] px-4 py-3 flex justify-between items-center">
            <span className="font-bold text-[color:var(--color-text-primary)]">
              合計 ({totalItems}点)
            </span>
            <span className="font-bold text-[color:var(--color-accent-char)] text-xl">
              {totalAmount.toLocaleString()}円
            </span>
          </div>
        </section>

        {/* 備考 (別カード) */}
        <form onSubmit={handleSubmit}>
          <div className="bg-[color:var(--color-bg-card)] rounded-xl border border-[color:var(--color-border)] p-4">
            <label className="block font-medium text-[color:var(--color-text-primary)] mb-2 text-sm">
              備考（任意）
            </label>
            <textarea
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              placeholder="アレルギーや要望があればご記入ください"
              rows={3}
              maxLength={500}
              className="w-full bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)] rounded-lg px-4 py-2.5 text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-soy)] resize-none"
            />
          </div>
        </form>
      </main>

      {/* 固定フッター (border-t のみ。shadow との二重表現は避ける) */}
      <div className="fixed bottom-0 left-0 right-0 bg-[color:var(--color-bg-card)] border-t border-[color:var(--color-border-strong)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-[color:var(--color-accent-char)] text-white py-3.5 rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? "送信中..." : `注文を確定する (${totalAmount.toLocaleString()}円)`}
          </button>
          <Link
            href="/menu"
            className="block w-full text-center py-2 text-[color:var(--color-text-muted)] text-sm mt-2 hover:text-[color:var(--color-text-primary)] transition-colors"
          >
            メニューに戻る
          </Link>
        </div>
      </div>

      {unavailableNames.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setUnavailableNames([])}
        >
          <div
            className="w-full max-w-sm bg-[color:var(--color-bg-card)] rounded-2xl border border-[color:var(--color-border)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-[color:var(--color-text-primary)] mb-2">
              品切れの商品があります
            </h2>
            <p className="text-sm text-[color:var(--color-text-muted)] mb-3">
              以下の商品は品切れのため、カートから削除しました。
            </p>
            <ul className="mb-5 space-y-1 rounded-lg bg-[color:var(--color-bg-subtle)] px-4 py-3">
              {unavailableNames.map((n) => (
                <li key={n} className="text-sm text-[color:var(--color-accent-char)]">
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
    </div>
  );
}
