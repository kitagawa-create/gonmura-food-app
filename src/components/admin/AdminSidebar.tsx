"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/admin-auth";

const NAV = [
  { href: "/admin/orders", label: "注文管理" },
  { href: "/admin/register", label: "レジ" },
  { href: "/admin/sales", label: "売上分析" },
  { href: "/admin/menus", label: "メニュー管理" },
  { href: "/admin/categories", label: "カテゴリ管理" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="border-b border-gray-200 px-4 py-4">
        <h1 className="text-lg font-bold">Gonmura 管理</h1>
      </div>
      <nav className="flex-1 p-2">
        <ul className="space-y-1">
          {NAV.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded px-3 py-2 text-sm ${
                    active
                      ? "bg-gray-800 text-white"
                      : "text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-gray-200 p-2">
        <button
          className="w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-200"
          onClick={async () => {
            await logout();
            router.replace("/admin/login");
          }}
        >
          ログアウト
        </button>
      </div>
    </aside>
  );
}
