"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithEmail, logout, getAdminRole } from "@/lib/admin-auth";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await loginWithEmail(email, password);
      const role = await getAdminRole(user.uid);
      if (role === null) {
        await logout();
        setError("このアカウントは管理者として登録されていません。");
        return;
      }
      router.replace("/admin/orders");
    } catch {
      setError("メールアドレスまたはパスワードが正しくありません。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:var(--color-bg-base)] p-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-sm rounded-2xl bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] p-8 shadow-sm"
      >
        <h1 className="text-xl font-bold text-[color:var(--color-text-primary)] text-center mb-1">Gonmura Food</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] text-center mb-8">管理画面ログイン</p>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-[color:var(--color-text-muted)]">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-xl px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-[color:var(--color-text-muted)]">パスワード</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[color:var(--color-bg-base)] border border-[color:var(--color-border)] rounded-xl px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[color:var(--color-accent-char)] text-white py-3 rounded-xl text-sm font-bold hover:bg-[color:var(--color-accent-char-hover)] transition-colors disabled:opacity-50"
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </div>
        {error && (
          <p className="mt-4 rounded-lg bg-[color:var(--color-accent-warn)]/10 border border-[color:var(--color-accent-warn)]/30 p-3 text-sm text-[color:var(--color-accent-warn)]">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
