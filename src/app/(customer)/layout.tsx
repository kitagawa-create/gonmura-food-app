import type { Metadata } from "next";
import { CartProvider } from "@/lib/cart-context";
import { AnalyticsProvider } from "@/components/customer/AnalyticsProvider";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gonmura Food",
  description: "本格家系ラーメン 権村家のモバイルオーダー",
};

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CartProvider>
      <AnalyticsProvider>{children}</AnalyticsProvider>
    </CartProvider>
  );
}
