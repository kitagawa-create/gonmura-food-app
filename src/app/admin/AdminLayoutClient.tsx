"use client";

import { usePathname } from "next/navigation";
import { AdminAuthGuard } from "@/components/admin/AdminAuthGuard";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { ToastProvider } from "@/components/ui/Snackbar";

export default function AdminLayoutClient({
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
      <ToastProvider>
        <div className="flex h-[100dvh] bg-[color:var(--color-bg-base)] text-[color:var(--color-text-primary)]">
          <AdminSidebar />
          <main className="flex-1 overflow-y-auto p-3 md:p-6">{children}</main>
        </div>
      </ToastProvider>
    </AdminAuthGuard>
  );
}
