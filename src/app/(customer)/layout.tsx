import { CartProvider } from "@/lib/cart-context";
import { AnalyticsProvider } from "@/components/customer/AnalyticsProvider";

export const dynamic = "force-dynamic";

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
