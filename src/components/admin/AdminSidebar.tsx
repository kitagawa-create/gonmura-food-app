"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { logout } from "@/lib/admin-auth";
import { useAdminRole } from "./AdminContext";
import { ConfirmDialog } from "./ConfirmDialog";

const NAV = [
  { href: "/admin/orders", label: "注文管理", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { href: "/admin/register", label: "レジ", icon: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" },
  { href: "/admin/sales", label: "売上分析", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { href: "/admin/menus", label: "メニュー", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
  { href: "/admin/categories", label: "カテゴリ", icon: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" },
  { href: "/admin/tables", label: "テーブル", icon: "M3 10h18M3 14h18M10 10v8m4-8v8M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const role = useAdminRole();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const nav =
    role === "staff"
      ? NAV.filter((i) => i.href !== "/admin/sales" && i.href !== "/admin/categories" && i.href !== "/admin/tables")
      : NAV;

  return (
    <aside className="flex w-14 md:w-60 shrink-0 flex-col h-full overflow-y-auto bg-[color:var(--color-bg-elevated)] text-[color:var(--color-text-on-dark)] border-r border-[color:var(--color-border-strong)]/20">
      <div className="px-3 md:px-5 py-4 md:py-5 flex md:block items-center justify-center">
        <div className="md:hidden w-8 h-8 rounded-lg bg-[color:var(--color-accent-char)] flex items-center justify-center text-white font-bold text-sm">
          G
        </div>
        <h1 className="hidden md:block text-lg font-bold">Gonmura Food</h1>
        <p className="hidden md:block text-xs text-[color:var(--color-text-on-dark)]/60 mt-0.5">管理画面</p>
      </div>
      <nav className="flex-1 px-2 md:px-3">
        <ul className="space-y-1">
          {nav.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={item.label}
                  className={`flex items-center justify-center md:justify-start gap-3 rounded-lg px-2 md:px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-[color:var(--color-accent-char)]/20 text-[color:var(--color-accent-char)]"
                      : "text-[color:var(--color-text-on-dark)]/70 hover:bg-white/5 hover:text-[color:var(--color-text-on-dark)]"
                  }`}
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                  </svg>
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-[color:var(--color-text-on-dark)]/10 p-2 md:p-3">
        <button
          title="ログアウト"
          className="w-full flex items-center justify-center md:justify-start gap-3 rounded-lg px-2 md:px-3 py-2.5 text-sm text-[color:var(--color-text-on-dark)]/70 hover:bg-white/5 hover:text-[color:var(--color-text-on-dark)] transition-colors"
          onClick={() => setShowLogoutDialog(true)}
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="hidden md:inline">ログアウト</span>
        </button>
      </div>
      <ConfirmDialog
        open={showLogoutDialog}
        title="ログアウト"
        message="ログアウトしますか？"
        confirmLabel="ログアウト"
        confirmColor="red"
        onConfirm={async () => {
          await logout();
          router.replace("/admin/login");
        }}
        onCancel={() => setShowLogoutDialog(false)}
      />
    </aside>
  );
}
