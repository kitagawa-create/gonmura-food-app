"use client";

import Link from "next/link";

type BackButtonProps = {
  href: string;
  label: string;
  variant?: "light" | "dark";
  className?: string;
};

export function BackButton({
  href,
  label,
  variant = "light",
  className = "",
}: BackButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] px-3 rounded-full text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

  const palette =
    variant === "dark"
      ? "bg-[color:var(--color-bg-elevated)] text-[color:var(--color-text-on-dark)] hover:opacity-90 focus-visible:ring-[color:var(--color-accent-char)] focus-visible:ring-offset-[color:var(--color-bg-elevated)]"
      : "bg-[color:var(--color-bg-card)] text-[color:var(--color-text-primary)] border border-[color:var(--color-border)] hover:bg-[color:var(--color-bg-subtle)] focus-visible:ring-[color:var(--color-accent-soy)] focus-visible:ring-offset-[color:var(--color-bg-base)]";

  return (
    <Link
      href={href}
      aria-label={label}
      className={`${base} ${palette} ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12.5 4.5L6 11l6.5 6.5" />
      </svg>
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
