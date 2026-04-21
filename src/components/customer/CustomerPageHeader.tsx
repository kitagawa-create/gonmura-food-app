"use client";

import { BackButton } from "@/components/ui/BackButton";

export function CustomerPageHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-10 bg-[color:var(--color-bg-base)] border-b border-[color:var(--color-border)]">
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3">
        <BackButton href="/menu" label="メニューに戻る" size="sm" />
        <h1 className="text-base font-bold text-[color:var(--color-text-primary)]">{title}</h1>
      </div>
    </header>
  );
}
