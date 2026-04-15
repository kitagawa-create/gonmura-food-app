"use client";

import { createContext, useContext } from "react";
import type { AdminRole } from "@/types";

const AdminContext = createContext<AdminRole | null>(null);

export function AdminProvider({
  role,
  children,
}: {
  role: AdminRole;
  children: React.ReactNode;
}) {
  return <AdminContext.Provider value={role}>{children}</AdminContext.Provider>;
}

export function useAdminRole(): AdminRole {
  const role = useContext(AdminContext);
  if (!role) throw new Error("useAdminRole must be used within AdminProvider");
  return role;
}
