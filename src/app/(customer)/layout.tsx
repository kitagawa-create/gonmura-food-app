import { CartProvider } from "@/lib/cart-context";
import { AnalyticsProvider } from "@/components/customer/AnalyticsProvider";

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
