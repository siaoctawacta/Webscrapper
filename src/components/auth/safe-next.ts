/**
 * Where to go after signing in. Only same-site relative paths are allowed ("/collections?x=1"),
 * never protocol-relative ("//evil.com"), backslash tricks ("/\evil.com"), absolute URLs or the
 * auth pages themselves (to avoid loops). Pure; safe on server and client.
 */
const BASE = "http://leadfinder.invalid";
const AUTH_PAGES = ["/sign-in", "/sign-up", "/pending"];

export function safeNextPath(next: unknown, fallback = "/search"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2000) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  // Backslashes and control characters/whitespace are normalised by browsers in surprising ways.
  if (/[\\\u0000-\u001F\u007F\s]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  if (AUTH_PAGES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return fallback;
  if (url.pathname.startsWith("/api/")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
