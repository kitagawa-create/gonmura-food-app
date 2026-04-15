"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-context";

const STAFF_PIN = "1234";

export default function SetupPage() {
  const [pin, setPin] = useState("");
  const [tableInput, setTableInput] = useState("");
  const [step, setStep] = useState<"pin" | "table">("pin");
  const [error, setError] = useState("");
  const { setTableNumber } = useCart();
  const router = useRouter();

  function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin === STAFF_PIN) {
      setStep("table");
      setError("");
    } else {
      setError("PINが正しくありません");
    }
  }

  function handleTableSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseInt(tableInput, 10);
    if (isNaN(num) || num <= 0) {
      setError("正しいテーブル番号を入力してください");
      return;
    }
    setTableNumber(num);
    router.replace("/menu");
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm md:max-w-md bg-neutral-900 rounded-2xl border border-neutral-800 p-8 md:p-10">
        <h1 className="text-xl font-bold text-center text-white mb-6">
          {step === "pin" ? "スタッフ認証" : "テーブル設定"}
        </h1>

        {step === "pin" ? (
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-neutral-400 mb-1">スタッフPIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="4桁のPINを入力"
                className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-center text-2xl tracking-widest text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-orange-500 text-white py-3 rounded-xl font-bold hover:bg-orange-600 transition-colors"
            >
              認証
            </button>
          </form>
        ) : (
          <form onSubmit={handleTableSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-neutral-400 mb-1">テーブル番号</label>
              <input
                type="number"
                min="1"
                required
                value={tableInput}
                onChange={(e) => setTableInput(e.target.value)}
                placeholder="例: 5"
                className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-center text-2xl text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-orange-500 text-white py-3 rounded-xl font-bold hover:bg-orange-600 transition-colors"
            >
              設定完了
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 text-center text-sm text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}
