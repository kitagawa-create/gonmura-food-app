"use client";

import { useCart } from "@/lib/cart-context";
import Link from "next/link";

export default function CartPage() {
  const { items, updateQuantity, removeItem, totalAmount, totalItems } =
    useCart();

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <p className="text-gray-500 text-lg mb-4">カートは空です</p>
        <Link
          href="/menu"
          className="text-orange-500 font-medium hover:underline"
        >
          メニューに戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <header className="sticky top-0 z-10 bg-white shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center">
          <Link href="/menu" className="text-gray-600 mr-4">
            &larr;
          </Link>
          <h1 className="text-xl font-bold">カート</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.menuId}
              className="bg-white rounded-lg shadow-sm p-4"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-gray-900">{item.name}</h3>
                  <p className="text-orange-600 font-bold mt-1">
                    {item.price.toLocaleString()}円
                  </p>
                </div>
                <button
                  onClick={() => removeItem(item.menuId)}
                  className="text-gray-400 hover:text-red-500 text-sm"
                >
                  削除
                </button>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={() =>
                    updateQuantity(item.menuId, item.quantity - 1)
                  }
                  className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100"
                >
                  -
                </button>
                <span className="font-medium w-8 text-center">
                  {item.quantity}
                </span>
                <button
                  onClick={() =>
                    updateQuantity(item.menuId, item.quantity + 1)
                  }
                  className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100"
                >
                  +
                </button>
                <span className="ml-auto text-gray-700 font-medium">
                  {(item.price * item.quantity).toLocaleString()}円
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-lg shadow-sm p-4 mt-6">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">合計 ({totalItems}点)</span>
            <span className="text-xl font-bold text-orange-600">
              {totalAmount.toLocaleString()}円
            </span>
          </div>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg">
        <div className="max-w-lg mx-auto px-4 py-3 space-y-2">
          <Link
            href="/order"
            className="block w-full bg-orange-500 text-white text-center py-3 rounded-lg font-medium hover:bg-orange-600 transition-colors"
          >
            注文に進む
          </Link>
          <Link
            href="/menu"
            className="block w-full text-center py-2 text-gray-500 text-sm hover:underline"
          >
            メニューに戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
