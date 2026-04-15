"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeAuth, isAdminUser } from "@/lib/admin-auth";

type Status = "loading" | "authorized" | "unauthorized" | "not-admin";

export function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const unsub = subscribeAuth(async (user) => {
      if (!user) {
        setStatus("unauthorized");
        return;
      }
      const ok = await isAdminUser(user.uid);
      setStatus(ok ? "authorized" : "not-admin");
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
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "not-admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 bg-neutral-950">
        <h1 className="text-xl font-bold text-white">アクセス拒否</h1>
        <p className="text-sm text-neutral-400">
          このアカウントは管理者として登録されていません。
        </p>
        <button
          className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm text-white font-bold hover:bg-orange-600 transition-colors"
          onClick={async () => {
            const { logout } = await import("@/lib/admin-auth");
            await logout();
            router.replace("/admin/login");
          }}
        >
          ログアウト
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
