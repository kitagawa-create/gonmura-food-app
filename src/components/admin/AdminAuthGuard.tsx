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
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        読み込み中...
      </div>
    );
  }

  if (status === "not-admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-bold">アクセス拒否</h1>
        <p className="text-sm text-gray-600">
          このアカウントは管理者として登録されていません。
        </p>
        <button
          className="rounded bg-gray-800 px-4 py-2 text-sm text-white"
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
