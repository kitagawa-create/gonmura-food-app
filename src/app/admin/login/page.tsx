"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithEmail, logout, isAdminUser } from "@/lib/admin-auth";

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
      const ok = await isAdminUser(user.uid);
      if (!ok) {
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
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-sm rounded-2xl bg-neutral-900 border border-neutral-800 p-8"
      >
        <h1 className="text-xl font-bold text-white text-center mb-1">Gonmura Food</h1>
        <p className="text-sm text-neutral-500 text-center mb-8">管理画面ログイン</p>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-neutral-400">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-neutral-400">パスワード</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-500 text-white py-3 rounded-xl text-sm font-bold hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </div>
        {error && (
          <p className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
