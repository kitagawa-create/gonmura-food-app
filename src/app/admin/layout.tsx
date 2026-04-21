import type { Metadata } from "next";
import AdminLayoutClient from "./AdminLayoutClient";

export const metadata: Metadata = {
  title: "Gonmura Food 管理画面",
  description: "Gonmura Food 注文・メニュー・売上管理システム",
  openGraph: {
    title: "Gonmura Food 管理画面",
    description: "Gonmura Food 注文・メニュー・売上管理システム",
    siteName: "Gonmura Food",
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
