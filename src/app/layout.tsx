import type { Metadata, Viewport } from "next";
import "./globals.css";

const BASE_URL = "https://gonmura-food-app--gonmura-food.asia-east1.hosted.app";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#3b82f6",
};

export const metadata: Metadata = {
  title: "Gonmura Food",
  description: "Gonmura Food のモバイルオーダーシステム",
  applicationName: "Gonmura Food",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Gonmura Food", statusBarStyle: "default" },
  formatDetection: { telephone: false, address: false, email: false },
  openGraph: {
    title: "Gonmura Food",
    description: "Gonmura Food のモバイルオーダーシステム",
    siteName: "Gonmura Food",
    url: BASE_URL,
    type: "website",
    locale: "ja_JP",
    images: [
      {
        url: `${BASE_URL}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: "Gonmura Food",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gonmura Food",
    description: "Gonmura Food のモバイルオーダーシステム",
    images: [`${BASE_URL}/opengraph-image`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
