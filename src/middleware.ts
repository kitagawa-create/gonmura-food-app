import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // 静的アセット以外は CDN キャッシュを無効化
  // Next.js が設定する s-maxage=31536000 を上書きする
  const path = request.nextUrl.pathname;
  if (!path.startsWith("/_next/static") && !path.startsWith("/_next/image")) {
    response.headers.set("Cache-Control", "no-store, must-revalidate");
    response.headers.set("CDN-Cache-Control", "no-store");
    response.headers.delete("x-nextjs-cache");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
