// CONTRACT STUB — implemented by the "crawler" module agent. Keep these export signatures.
import type { FoundEmail, Socials, WebsiteCheck, WebsiteStatus } from "@/lib/domain";

export type EnrichmentResult = {
  websiteStatus: Exclude<WebsiteStatus, "none" | "unknown"> | "unknown";
  websiteCheck: WebsiteCheck;
  /** Best first: same-domain addresses, then others. Max 5. */
  emails: FoundEmail[];
  socials: Socials;
  /** tel: links found on the site (raw). */
  phones: string[];
  /** Mail-server check per email domain that was checked: false = domain has no MX record (→ email needs review). */
  mx: Record<string, boolean>;
};

export type EnrichOptions = {
  signal?: AbortSignal;
  /** Injected for tests. */
  fetch?: typeof fetch;
  /** Tests only: allow localhost/private addresses (production blocks them — SSRF protection). */
  allowPrivateNetwork?: boolean;
  /** Override DNS MX lookup (tests). Return [] when the domain has no mail server. */
  resolveMx?: (domain: string) => Promise<string[]>;
  timeoutMs?: number;
  maxPages?: number;
  userAgent?: string;
};

/** Visit a business website (respecting robots.txt) and extract published contact details. */
export async function enrichWebsite(_url: string, _opts?: EnrichOptions): Promise<EnrichmentResult> {
  throw new Error("Not implemented yet");
}
