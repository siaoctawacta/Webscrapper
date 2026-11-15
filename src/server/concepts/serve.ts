/**
 * HTTP responses for rendered concept pages. Pure module (no DB, no secrets).
 *
 * The page is static HTML: the CSP blocks every script, external font, image and form, and
 * `frame-ancestors 'self'` lets only this app embed it (the editor's sandboxed preview).
 */
import { escapeHtml } from "./render";

export const CONCEPT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

export type ConceptResponseOptions = {
  status?: number;
  /** Serve as a file download with this name (ASCII, already sanitised). */
  downloadName?: string;
  /** Public share page: short private caching instead of no-store. */
  isPublic?: boolean;
  headers?: Record<string, string>;
};

export function conceptHeaders(opts: ConceptResponseOptions = {}): Headers {
  const h = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": CONCEPT_CSP,
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": opts.isPublic ? "private, max-age=60" : "no-store",
    ...opts.headers,
  });
  if (opts.downloadName) {
    const safe = opts.downloadName.replace(/[^A-Za-z0-9._-]/g, "-");
    h.set("Content-Disposition", `attachment; filename="${safe}"`);
  }
  return h;
}

export function conceptHtmlResponse(html: string, opts: ConceptResponseOptions = {}): Response {
  return new Response(html, { status: opts.status ?? 200, headers: conceptHeaders(opts) });
}

/** Minimal standalone page for errors on the public share route (same strict headers). */
export function conceptMessagePage(title: string, message: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif;background:#fafafa;color:#18181b;padding:24px}main{max-width:28rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem;letter-spacing:-.01em}p{margin:0;color:#52525b;line-height:1.6}@media (prefers-color-scheme:dark){body{background:#18181b;color:#fafafa}p{color:#a1a1aa}}</style>",
    "</head>",
    `<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>`,
    "</html>",
  ].join("\n");
}
