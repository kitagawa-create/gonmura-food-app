"use client";

export function PageLoader({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center w-full min-h-[60vh]">
      <div className="w-10 h-10 border-4 border-[color:var(--color-accent-char)] border-t-transparent rounded-full animate-spin" />
      {message && (
        <p className="mt-4 text-sm text-[color:var(--color-text-muted)]">{message}</p>
      )}
    </div>
  );
}
