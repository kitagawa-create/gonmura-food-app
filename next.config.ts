import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      // 全ページ: CDN キャッシュを無効化 (デプロイ即反映)
      // _next/static はハッシュ付きなのでブラウザキャッシュに任せる
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      headers: [
        { key: "Cache-Control", value: "no-store, must-revalidate" },
        { key: "CDN-Cache-Control", value: "no-store" },
      ],
    },
  ],
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
