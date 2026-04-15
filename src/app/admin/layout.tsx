"use client";

import { usePathname } from "next/navigation";
import { AdminAuthGuard } from "@/components/admin/AdminAuthGuard";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <AdminAuthGuard>
      <div className="flex min-h-screen bg-neutral-900">
        <AdminSidebar />
        <main className="flex-1 overflow-auto p-3 md:p-6">{children}</main>
      </div>
    </AdminAuthGuard>
  );
}
