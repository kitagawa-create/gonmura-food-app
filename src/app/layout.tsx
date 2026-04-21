import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const BASE_URL = "https://gonmura-food-app--gonmura-food.asia-east1.hosted.app";

export const metadata: Metadata = {
  title: "Gonmura Food",
  description: "本格家系ラーメン 権村家のモバイルオーダーシステム",
  openGraph: {
    title: "Gonmura Food",
    description: "本格家系ラーメン 権村家のモバイルオーダーシステム",
    siteName: "Gonmura Food",
    url: BASE_URL,
    type: "website",
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
    description: "本格家系ラーメン 権村家のモバイルオーダーシステム",
    images: [`${BASE_URL}/opengraph-image`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
