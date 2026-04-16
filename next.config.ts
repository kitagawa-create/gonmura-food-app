import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      // 管理画面: CDN キャッシュを無効化 (デプロイ即反映のため)
      source: "/admin/:path*",
      headers: [
        { key: "Cache-Control", value: "no-store, must-revalidate" },
        { key: "CDN-Cache-Control", value: "no-store" },
      ],
    },
    {
      // 顧客側も短めのキャッシュに
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      headers: [
        { key: "CDN-Cache-Control", value: "s-maxage=60, stale-while-revalidate=30" },
      ],
    },
  ],
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
