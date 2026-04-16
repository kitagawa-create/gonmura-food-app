"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const TABLE_KEY = "gonmura-table";
const PIN_KEY = "gonmura-table-pin";
const MIN_TABLE = 1;
const MAX_TABLE = 30;

export default function AdminTablesPage() {
  const [mounted, setMounted] = useState(false);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [currentPin, setCurrentPin] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [pinDraft, setPinDraft] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TABLE_KEY);
      const n = raw !== null ? Number(raw) : NaN;
      const valid = Number.isFinite(n) && Number.isInteger(n) && n >= MIN_TABLE && n <= MAX_TABLE;
      setTableNumber(valid ? n : null);
      setDraft(valid ? String(n) : "");
      setCurrentPin(localStorage.getItem(PIN_KEY) ?? "");
      setPinDraft(localStorage.getItem(PIN_KEY) ?? "");
    } catch {
      // localStorage 利用不可
    }
    setMounted(true);
  }, []);

  const handleSave = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmed = draft.trim();
      if (trimmed === "") {
        setError("テーブル番号を入力してください。");
        return;
      }
      const n = Math.trunc(Number(trimmed));
      if (!Number.isFinite(n) || n < MIN_TABLE || n > MAX_TABLE) {
        setError(`${MIN_TABLE}〜${MAX_TABLE} の整数を入力してください。`);
        return;
      }
      if (!/^\d{4}$/.test(pinDraft)) {
        setError("PINは4桁の数字で入力してください。");
        return;
      }

      try {
        localStorage.setItem(TABLE_KEY, String(n));
        localStorage.setItem(PIN_KEY, pinDraft);
      } catch {
        setError("保存に失敗しました (localStorage 利用不可)。");
        return;
      }
      setTableNumber(n);
      setCurrentPin(pinDraft);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    },
    [draft, pinDraft]
  );

  return (
    <div className="w-full max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-[color:var(--color-text-primary)]">
        テーブル設定
      </h1>
      <p className="mb-6 text-xs text-[color:var(--color-text-muted)]">
        この端末に割り当てるテーブル番号と、変更用PINを設定します。
      </p>

      {error && (
        <p className="mb-4 rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 text-sm text-[color:var(--color-accent-warn)]">
          {error}
        </p>
      )}

      {/* 現在の状態 */}
      <section className="mb-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-5 shadow-sm">
        <p className="text-xs text-[color:var(--color-text-muted)]">現在の設定</p>
        {!mounted ? (
          <p className="mt-1 text-lg text-[color:var(--color-text-muted)]">読み込み中…</p>
        ) : tableNumber !== null ? (
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-4xl font-bold text-[color:var(--color-text-primary)]">
              {tableNumber}
            </span>
            <span className="text-sm text-[color:var(--color-text-muted)]">番テーブル</span>
            {currentPin && (
              <span className="rounded-full bg-[color:var(--color-accent-negi)]/15 border border-[color:var(--color-accent-negi)]/40 px-2 py-0.5 text-xs text-[color:var(--color-accent-negi)]">
                PIN 設定済
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-lg text-[color:var(--color-text-muted)]">未設定</p>
        )}
      </section>

      {/* 設定フォーム */}
      <form
        onSubmit={handleSave}
        className="mb-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-5 shadow-sm space-y-4"
      >
        <div>
          <label
            htmlFor="table-number"
            className="mb-1 block text-sm font-semibold text-[color:var(--color-text-primary)]"
          >
            テーブル番号
          </label>
          <p className="mb-2 text-xs text-[color:var(--color-text-muted)]">
            {MIN_TABLE}〜{MAX_TABLE} の整数
          </p>
          <input
            id="table-number"
            type="number"
            inputMode="numeric"
            min={MIN_TABLE}
            max={MAX_TABLE}
            step={1}
            required
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-32 bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-lg text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
          />
        </div>

        <div>
          <label
            htmlFor="table-pin"
            className="mb-1 block text-sm font-semibold text-[color:var(--color-text-primary)]"
          >
            変更用 PIN（4桁の数字）
          </label>
          <p className="mb-2 text-xs text-[color:var(--color-text-muted)]">
            お客様がテーブル番号を変更する際に求められます
          </p>
          <input
            id="table-pin"
            type="password"
            inputMode="numeric"
            maxLength={4}
            required
            value={pinDraft}
            onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="0000"
            className="w-32 bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-lg tracking-[0.3em] text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="submit"
            className="rounded-xl bg-[color:var(--color-accent-char)] px-5 py-2 text-sm text-white font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors"
          >
            保存
          </button>
          {savedFlash && (
            <span className="rounded-full bg-[color:var(--color-accent-negi)]/15 border border-[color:var(--color-accent-negi)]/40 px-2 py-0.5 text-xs text-[color:var(--color-accent-negi)]">
              保存しました
            </span>
          )}
        </div>
      </form>

      {/* 客用画面へ */}
      {tableNumber !== null && (
        <Link
          href="/menu"
          className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--color-border)] px-5 py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          客用画面を開く
        </Link>
      )}
    </div>
  );
}
