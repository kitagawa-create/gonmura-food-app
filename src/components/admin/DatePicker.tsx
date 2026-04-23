"use client";

import { useState, useRef, useEffect } from "react";

type Props = {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
  max: string; // YYYY-MM-DD
  className?: string;
};

function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}

function firstDayOfWeek(y: number, m: number) {
  return new Date(y, m, 1).getDay(); // 0=日
}

function parseDate(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m - 1, d]; // month is 0-indexed
}

function formatDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function DatePicker({ value, onChange, max, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [selY, selM] = parseDate(value);
  const [viewY, setViewY] = useState(selY);
  const [viewM, setViewM] = useState(selM);
  const ref = useRef<HTMLDivElement>(null);
  const [maxY, maxM] = parseDate(max);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // value が変わったら表示月も追従
  useEffect(() => {
    const [y, m] = parseDate(value);
    queueMicrotask(() => {
      setViewY(y);
      setViewM(m);
    });
  }, [value]);

  const canPrev = viewY > 2020 || viewM > 0;
  const canNext = viewY < maxY || (viewY === maxY && viewM < maxM);

  const prevMonth = () => {
    if (!canPrev) return;
    if (viewM === 0) { setViewY(y => y - 1); setViewM(11); }
    else setViewM(m => m - 1);
  };

  const nextMonth = () => {
    if (!canNext) return;
    if (viewM === 11) { setViewY(y => y + 1); setViewM(0); }
    else setViewM(m => m + 1);
  };

  const totalDays = daysInMonth(viewY, viewM);
  const firstDay = firstDayOfWeek(viewY, viewM);
  const [dispY, dispM, dispD] = parseDate(value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)] hover:bg-[color:var(--color-bg-subtle)] transition-colors"
      >
        <svg className="h-3.5 w-3.5 text-[color:var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {dispY}/{String(dispM + 1).padStart(2, "0")}/{String(dispD).padStart(2, "0")}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-72 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)] shadow-lg p-4">
          {/* ヘッダー */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={prevMonth}
              disabled={!canPrev}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ‹
            </button>
            <span className="text-sm font-bold text-[color:var(--color-text-primary)]">
              {viewY}年{viewM + 1}月
            </span>
            <button
              type="button"
              onClick={nextMonth}
              disabled={!canNext}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ›
            </button>
          </div>

          {/* 曜日ヘッダー */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((w, i) => (
              <span
                key={w}
                className={`text-center text-[11px] font-medium pb-1 ${
                  i === 0 ? "text-[color:var(--color-accent-warn)]" :
                  i === 6 ? "text-[color:var(--color-accent-char)]" :
                  "text-[color:var(--color-text-muted)]"
                }`}
              >
                {w}
              </span>
            ))}
          </div>

          {/* 日付グリッド */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array.from({ length: firstDay }).map((_, i) => <span key={`e-${i}`} />)}
            {Array.from({ length: totalDays }).map((_, i) => {
              const day = i + 1;
              const dateStr = formatDate(viewY, viewM, day);
              const isFuture = dateStr > max;
              const isSelected = dateStr === value;
              const isToday = dateStr === max;
              const dow = (firstDay + i) % 7;

              return (
                <button
                  key={day}
                  type="button"
                  disabled={isFuture}
                  onClick={() => { onChange(dateStr); setOpen(false); }}
                  className={`
                    mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors
                    ${isFuture
                      ? "text-[color:var(--color-border)] cursor-not-allowed"
                      : isSelected
                        ? "bg-[color:var(--color-accent-char)] text-white font-bold"
                        : isToday
                          ? "border border-[color:var(--color-accent-char)] text-[color:var(--color-accent-char)] font-bold hover:bg-[color:var(--color-accent-char)]/10"
                          : dow === 0
                            ? "text-[color:var(--color-accent-warn)] hover:bg-[color:var(--color-bg-subtle)]"
                            : dow === 6
                              ? "text-[color:var(--color-accent-char)] hover:bg-[color:var(--color-bg-subtle)]"
                              : "text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-bg-subtle)]"
                    }
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
