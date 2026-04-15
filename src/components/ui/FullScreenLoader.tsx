"use client";

export function FullScreenLoader({ message }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-neutral-950">
      <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      {message && (
        <p className="mt-4 text-sm text-neutral-400">{message}</p>
      )}
    </div>
  );
}
