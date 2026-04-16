"use client";

export function FullScreenLoader({ message }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[color:var(--color-bg-base)]">
      <div className="w-12 h-12 border-4 border-[color:var(--color-accent-char)] border-t-transparent rounded-full animate-spin" />
      {message && (
        <p className="mt-4 text-sm text-[color:var(--color-text-muted)]">{message}</p>
      )}
    </div>
  );
}
