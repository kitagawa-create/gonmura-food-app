"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeAuth, getAdminRole, logout } from "@/lib/admin-auth";
import { AdminProvider } from "./AdminContext";
import type { AdminRole } from "@/types";

type Status = "loading" | "authorized" | "unauthorized" | "not-admin";

export function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [role, setRole] = useState<AdminRole | null>(null);

  useEffect(() => {
    const unsub = subscribeAuth(async (user) => {
      if (!user) {
        setRole(null);
        setStatus("unauthorized");
        return;
      }
      const r = await getAdminRole(user.uid);
      if (r === null) {
        setRole(null);
        setStatus("not-admin");
        return;
      }
      setRole(r);
      setStatus("authorized");
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (status === "unauthorized") {
      router.replace("/admin/login");
    }
  }, [status, router]);

  if (status === "loading" || status === "unauthorized") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[color:var(--color-bg-base)]">
        <div className="w-6 h-6 border-2 border-[color:var(--color-accent-char)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "not-admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 bg-[color:var(--color-bg-base)]">
        <h1 className="text-xl font-bold text-[color:var(--color-text-primary)]">アクセス拒否</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          このアカウントは管理者として登録されていません。
        </p>
        <button
          className="rounded-xl bg-[color:var(--color-accent-char)] px-5 py-2.5 text-sm text-white font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors"
          onClick={async () => {
            await logout();
            router.replace("/admin/login");
          }}
        >
          ログアウト
        </button>
      </div>
    );
  }

  return <AdminProvider role={role!}>{children}</AdminProvider>;
}
