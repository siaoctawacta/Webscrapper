import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic redirect only: real authorization happens in every page/route (src/server/auth/session.ts).
 */
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up", "/pending", "/api/", "/c/", "/bot", "/_next", "/favicon", "/icon"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!getSessionCookie(req)) {
    const url = new URL("/sign-in", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp)$).*)"],
};
