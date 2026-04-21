export function StickyFilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 bg-[color:var(--color-bg-base)] py-3 border-b border-[color:var(--color-border)]">
      {children}
    </div>
  );
}
