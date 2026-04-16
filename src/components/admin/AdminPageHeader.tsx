"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
  className?: string;
};

export function AdminPageHeader({ title, subtitle, rightSlot, className }: Props) {
  return (
    <header
      className={`flex flex-wrap items-center justify-between gap-3 ${
        className ?? "mb-4"
      }`}
    >
      <h1 className="text-2xl font-bold text-[color:var(--color-text-primary)]">
        {title}
      </h1>
      {rightSlot ? (
        <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
      ) : null}
      {subtitle ? (
        <p className="basis-full text-xs text-[color:var(--color-text-muted)]">
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}
