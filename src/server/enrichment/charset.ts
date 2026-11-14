/**
 * Decode an HTML body to text, following the HTML encoding-sniffing order: byte-order mark, then the
 * Content-Type charset, then a <meta charset> / <meta http-equiv> in the first bytes, else UTF-8 —
 * with a windows-1252 fallback when nothing was declared and the bytes are not valid UTF-8 (common
 * on older sites written in French). Pure module.
 */

const PRESCAN_BYTES = 4096;

/** Normalize a declared label to one TextDecoder accepts, or null if unknown. */
export function resolveEncoding(label: string | null | undefined): string | null {
  if (!label) return null;
  const clean = label.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (!clean) return null;
  try {
    const enc = new TextDecoder(clean).encoding;
    // A meta prescan that finds "utf-16" was read as ASCII, so the document is not UTF-16.
    return enc.startsWith("utf-16") ? "utf-8" : enc;
  } catch {
    return null;
  }
}

/** charset parameter of a Content-Type header value. */
export function charsetFromContentType(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const m = /;\s*charset\s*=\s*("?)([^";\s]+)\1/i.exec(contentType);
  return m ? m[2]! : null;
}

function bomEncoding(buf: Uint8Array): { encoding: string; skip: number } | null {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { encoding: "utf-8", skip: 3 };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { encoding: "utf-16be", skip: 2 };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { encoding: "utf-16le", skip: 2 };
  return null;
}

/** <meta charset="…"> or <meta http-equiv="Content-Type" content="…; charset=…"> near the top. */
export function metaCharset(buf: Uint8Array): string | null {
  const head = Buffer.from(buf.buffer, buf.byteOffset, Math.min(buf.length, PRESCAN_BYTES)).toString("latin1");
  const m = /<meta\b[^>]*?\bcharset\s*=\s*["']?\s*([a-z0-9_.:-]+)/i.exec(head);
  return m ? m[1]! : null;
}

/** Which encoding we used and whether it was declared by the site. */
export function sniffEncoding(buf: Uint8Array, headerCharset: string | null): { encoding: string; declared: boolean; skip: number } {
  const bom = bomEncoding(buf);
  if (bom) return { ...bom, declared: true };
  const fromHeader = resolveEncoding(headerCharset);
  if (fromHeader) return { encoding: fromHeader, declared: true, skip: 0 };
  const fromMeta = resolveEncoding(metaCharset(buf));
  if (fromMeta) return { encoding: fromMeta, declared: true, skip: 0 };
  return { encoding: "utf-8", declared: false, skip: 0 };
}

export function decodeHtml(buf: Uint8Array, headerCharset: string | null = null): string {
  const { encoding, declared, skip } = sniffEncoding(buf, headerCharset);
  const bytes = skip ? buf.subarray(skip) : buf;
  if (!declared) {
    try {
      // stream: a body truncated at the size cap may end mid-character; that must not count as invalid.
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
    } catch {
      // Not valid UTF-8 and nothing declared: the classic Western default.
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }
  return new TextDecoder(encoding).decode(bytes);
}
