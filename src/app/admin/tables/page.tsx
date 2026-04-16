"use client";

import { useCallback, useEffect, useState } from "react";

const TABLE_KEY = "gonmura-table";
const LOCK_KEY = "gonmura-table-locked";
const MIN_TABLE = 1;
const MAX_TABLE = 30;

export default function AdminTablesPage() {
  const [mounted, setMounted] = useState(false);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TABLE_KEY);
      const n = raw !== null ? Number(raw) : NaN;
      const valid = Number.isFinite(n) && Number.isInteger(n) && n >= MIN_TABLE && n <= MAX_TABLE;
      setTableNumber(valid ? n : null);
      setDraft(valid ? String(n) : "");
      setLocked(localStorage.getItem(LOCK_KEY) === "1");
    } catch {
      // localStorage 利用不可の環境ではデフォルト値のままにする
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
      try {
        localStorage.setItem(TABLE_KEY, String(n));
      } catch {
        setError("保存に失敗しました (localStorage 利用不可)。");
        return;
      }
      setTableNumber(n);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    },
    [draft]
  );

  const handleClear = useCallback(() => {
    try {
      localStorage.removeItem(TABLE_KEY);
    } catch {
      // noop
    }
    setTableNumber(null);
    setDraft("");
  }, []);

  const handleToggleLock = useCallback(() => {
    setError(null);
    if (!locked) {
      if (tableNumber === null) {
        setError("番号を保存してからロックしてください。");
        return;
      }
      try {
        localStorage.setItem(LOCK_KEY, "1");
      } catch {
        setError("保存に失敗しました (localStorage 利用不可)。");
        return;
      }
      setLocked(true);
    } else {
      try {
        localStorage.removeItem(LOCK_KEY);
      } catch {
        // noop
      }
      setLocked(false);
    }
  }, [locked, tableNumber]);

  return (
    <div className="w-full max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-[color:var(--color-text-primary)]">テーブル設定</h1>
      <p className="mb-6 text-xs text-[color:var(--color-text-muted)]">
        この端末に割り当てるテーブル番号を設定します。ロック中はお客様側の /setup 画面から番号を変更できなくなります。
      </p>

      {error && (
        <p className="mb-4 rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 text-sm text-[color:var(--color-accent-warn)]">
          {error}
        </p>
      )}

      <section className="mb-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-5 shadow-sm">
        <p className="text-xs text-[color:var(--color-text-muted)]">現在の設定</p>
        {!mounted ? (
          <p className="mt-1 text-lg text-[color:var(--color-text-muted)]">読み込み中…</p>
        ) : tableNumber !== null ? (
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-4xl font-bold text-[color:var(--color-text-primary)]">{tableNumber}</span>
            <span className="text-sm text-[color:var(--color-text-muted)]">番テーブル</span>
            {locked && (
              <span className="rounded-full bg-[color:var(--color-accent-char)]/15 border border-[color:var(--color-accent-char)]/40 px-2 py-0.5 text-xs text-[color:var(--color-accent-char)]">
                ロック中
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-lg text-[color:var(--color-text-muted)]">未設定</p>
        )}
      </section>

      <form
        onSubmit={handleSave}
        className="mb-4 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-5 shadow-sm"
      >
        <label htmlFor="table-number" className="mb-2 block text-sm font-semibold text-[color:var(--color-text-primary)]">
          テーブル番号を変更
        </label>
        <p className="mb-3 text-xs text-[color:var(--color-text-muted)]">
          {MIN_TABLE}〜{MAX_TABLE} の整数を入力してください。
        </p>
        <div className="flex flex-wrap gap-2">
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
          <button
            type="submit"
            className="rounded-xl bg-[color:var(--color-accent-char)] px-5 py-2 text-sm text-white font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors"
          >
            保存
          </button>
          {tableNumber !== null && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-xl border border-[color:var(--color-border)] px-4 py-2 text-sm text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
            >
              未設定に戻す
            </button>
          )}
          {savedFlash && (
            <span className="self-center rounded-full bg-[color:var(--color-accent-negi)]/15 border border-[color:var(--color-accent-negi)]/40 px-2 py-0.5 text-xs text-[color:var(--color-accent-negi)]">
              保存しました
            </span>
          )}
        </div>
      </form>

      <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[color:var(--color-text-primary)]">客向けにロック</p>
            <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
              ONにするとお客様側の /setup 画面からテーブル番号を変更できなくなります。開店後の誤操作対策用。
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleLock}
            role="switch"
            aria-checked={locked}
            aria-label="テーブル番号をロック"
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
              locked
                ? "bg-[color:var(--color-accent-char)]"
                : "bg-[color:var(--color-border-strong)]"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                locked ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </section>
    </div>
  );
}
