"use client";

import type { HTMLAttributes, ReactNode } from "react";

type CardVariant = "default" | "subtle" | "elevated";
type CardPadding = "none" | "sm" | "md" | "lg";

type CardProps = {
  children: ReactNode;
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">;

const variantClass: Record<CardVariant, string> = {
  default:
    "bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)]",
  subtle:
    "bg-[color:var(--color-bg-subtle)] border border-[color:var(--color-border)]",
  elevated:
    "bg-[color:var(--color-bg-elevated)] text-[color:var(--color-text-on-dark)] border border-transparent",
};

const paddingClass: Record<CardPadding, string> = {
  none: "",
  sm: "p-2",
  md: "p-4",
  lg: "p-6",
};

export function Card({
  children,
  variant = "default",
  padding = "md",
  className = "",
  ...rest
}: CardProps) {
  return (
    <div
      className={`rounded-2xl shadow-sm ${variantClass[variant]} ${paddingClass[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
