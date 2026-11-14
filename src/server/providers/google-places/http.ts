import "server-only";
import { ProviderError, type ProviderContext, type UsageEvent } from "../types";

/**
 * Places API (New) HTTP client: field-mask headers, timeouts, retries with exponential backoff and
 * jitter for 429 / 5xx / network errors, one usage event per HTTP request, and plain-language
 * ProviderErrors. The API key is only ever sent in the X-Goog-Api-Key header — never in URLs,
 * logs or error messages.
 */

export const PLACES_API_BASE = "https://places.googleapis.com/v1";

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface GooglePlacesDeps {
  /** Injected for tests (no real waiting). */
  sleep?: Sleep;
  /** 0..1, for backoff jitter. */
  random?: () => number;
  /** Per-request timeout. Default 15 s. */
  requestTimeoutMs?: number;
  /** Default 3 (first try + 2 retries). */
  maxAttempts?: number;
  /** First backoff step. Default 500 ms. */
  baseDelayMs?: number;
  baseUrl?: string;
}

export interface PlacesRequest {
  operation: UsageEvent["operation"];
  method: "GET" | "POST";
  /** Path below the API base, e.g. "/places:searchText". */
  path: string;
  fieldMask: string;
  body?: unknown;
  /** Price of one successful request in USD per 1000. */
  pricePer1000: number;
}

export const PROVIDER_MESSAGES = {
  authBase: "Google rejected the API key or billing is not enabled for Places API (New).",
  authDefaultHint:
    "Check that the key in GOOGLE_MAPS_API_KEY is valid, that “Places API (New)” is enabled for its Google Cloud project, and that billing is active.",
  keyInvalid: "The key in GOOGLE_MAPS_API_KEY is not valid — copy it again from Google Cloud Console (APIs & Services → Credentials).",
  serviceDisabled: "Enable “Places API (New)” for the key's Google Cloud project (APIs & Services → Library).",
  billingDisabled: "Turn on billing for the key's Google Cloud project.",
  keyServiceBlocked: "The key's API restrictions don't allow “Places API (New)” — add it to the key's allowed APIs.",
  keyAppBlocked: "The key's application restrictions block this server — allow this server's IP address or remove the website restriction.",
  quota:
    "Google's request limit for Places API (New) was reached. Wait a minute and try again, or raise the quota in Google Cloud Console.",
  unavailable: "Google Places is temporarily unavailable. Please try again in a few minutes.",
  timeout: "Google Places did not answer in time. Please try again in a few minutes.",
  badResponse: "Google Places sent a response we couldn't read. Please try again.",
  invalid: "Google could not process this request",
  notFound: "Google could not find this place — it may have been removed or merged with another listing.",
} as const;

const defaultSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

type GoogleErrorInfo = { message: string | null; status: string | null; reasons: string[] };

function readGoogleError(text: string): GoogleErrorInfo {
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown; status?: unknown; details?: unknown } };
    const e = body.error;
    if (!e || typeof e !== "object") return { message: null, status: null, reasons: [] };
    const reasons = Array.isArray(e.details)
      ? e.details
          .map((d: unknown) => (d && typeof d === "object" && "reason" in d ? (d as { reason: unknown }).reason : null))
          .filter((r): r is string => typeof r === "string")
      : [];
    return {
      message: typeof e.message === "string" ? e.message : null,
      status: typeof e.status === "string" ? e.status : null,
      reasons,
    };
  } catch {
    return { message: null, status: null, reasons: [] };
  }
}

const AUTH_REASONS = new Set([
  "API_KEY_INVALID",
  "API_KEY_EXPIRED",
  "SERVICE_DISABLED",
  "BILLING_DISABLED",
  "API_KEY_SERVICE_BLOCKED",
  "API_KEY_IP_ADDRESS_BLOCKED",
  "API_KEY_HTTP_REFERRER_BLOCKED",
  "API_KEY_ANDROID_APP_BLOCKED",
  "API_KEY_IOS_APP_BLOCKED",
  "CONSUMER_INVALID",
]);

function authHint(reasons: string[]): string {
  if (reasons.includes("API_KEY_INVALID") || reasons.includes("API_KEY_EXPIRED")) return PROVIDER_MESSAGES.keyInvalid;
  if (reasons.includes("SERVICE_DISABLED")) return PROVIDER_MESSAGES.serviceDisabled;
  if (reasons.includes("BILLING_DISABLED")) return PROVIDER_MESSAGES.billingDisabled;
  if (reasons.includes("API_KEY_SERVICE_BLOCKED")) return PROVIDER_MESSAGES.keyServiceBlocked;
  if (reasons.some((r) => /_BLOCKED$/.test(r))) return PROVIDER_MESSAGES.keyAppBlocked;
  return PROVIDER_MESSAGES.authDefaultHint;
}

export class PlacesHttp {
  private readonly sleep: Sleep;
  private readonly random: () => number;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    deps: GooglePlacesDeps = {},
  ) {
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
    this.timeoutMs = deps.requestTimeoutMs ?? 15_000;
    this.maxAttempts = Math.max(1, deps.maxAttempts ?? 3);
    this.baseDelayMs = deps.baseDelayMs ?? 500;
    this.baseUrl = (deps.baseUrl ?? PLACES_API_BASE).replace(/\/+$/, "");
  }

  /** Remove anything that looks like an API key from text that may reach users or logs. */
  redact(text: string): string {
    let out = text;
    if (this.apiKey) out = out.split(this.apiKey).join("[redacted]");
    return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]");
  }

  /** Perform one logical request (with retries). Returns the parsed JSON body. */
  async request(req: PlacesRequest, ctx: ProviderContext = {}): Promise<unknown> {
    const fetchImpl = ctx.fetch ?? globalThis.fetch;
    const url = `${this.baseUrl}${req.path}`;
    const headers: Record<string, string> = {
      "X-Goog-Api-Key": this.apiKey,
      "X-Goog-FieldMask": req.fieldMask,
      Accept: "application/json",
    };
    if (req.body !== undefined) headers["Content-Type"] = "application/json";
    const body = req.body === undefined ? undefined : JSON.stringify(req.body);

    for (let attempt = 1; ; attempt++) {
      ctx.signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
      const canRetry = attempt < this.maxAttempts;

      let res: Response;
      try {
        res = await fetchImpl(url, { method: req.method, headers, body, signal });
      } catch (e) {
        await this.usage(ctx, req, false);
        if (ctx.signal?.aborted) throw ctx.signal.reason ?? e;
        if (canRetry) {
          await this.sleep(this.backoff(attempt, null), ctx.signal);
          continue;
        }
        const timedOut = timeout.aborted;
        throw new ProviderError(timedOut ? PROVIDER_MESSAGES.timeout : PROVIDER_MESSAGES.unavailable, "unavailable");
      }

      await this.usage(ctx, req, res.ok);

      if (res.ok) {
        try {
          return (await res.json()) as unknown;
        } catch {
          throw new ProviderError(PROVIDER_MESSAGES.badResponse, "unavailable", res.status);
        }
      }

      const status = res.status;
      if ((status === 429 || status >= 500) && canRetry) {
        this.discard(res);
        await this.sleep(this.backoff(attempt, res.headers.get("retry-after")), ctx.signal);
        continue;
      }
      throw this.toError(status, await this.readText(res));
    }
  }

  private toError(status: number, text: string): ProviderError {
    const info = readGoogleError(text);
    if (status === 401 || status === 403 || info.reasons.some((r) => AUTH_REASONS.has(r))) {
      return new ProviderError(`${PROVIDER_MESSAGES.authBase} ${authHint(info.reasons)}`, "auth", status);
    }
    if (status === 429) return new ProviderError(PROVIDER_MESSAGES.quota, "quota", status);
    if (status >= 500) return new ProviderError(PROVIDER_MESSAGES.unavailable, "unavailable", status);
    if (status === 404) return new ProviderError(PROVIDER_MESSAGES.notFound, "invalid", status);
    const detail = info.message ? this.redact(info.message).replace(/\s+/g, " ").trim().slice(0, 300) : "";
    return new ProviderError(detail ? `${PROVIDER_MESSAGES.invalid}: ${detail}` : `${PROVIDER_MESSAGES.invalid}.`, "invalid", status);
  }

  /** Exponential backoff with jitter; honours Retry-After (seconds) up to 30 s. */
  private backoff(attempt: number, retryAfter: string | null): number {
    const exp = this.baseDelayMs * 2 ** (attempt - 1);
    const jittered = Math.round(exp * (0.5 + this.random()));
    const ra = retryAfter !== null && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : 0;
    return Math.min(30_000, Math.max(jittered, ra));
  }

  private async usage(ctx: ProviderContext, req: PlacesRequest, succeeded: boolean) {
    // Google only bills requests it answered successfully; failed attempts are logged at no cost.
    await ctx.onUsage?.({
      operation: req.operation,
      requests: 1,
      costUsd: succeeded ? req.pricePer1000 / 1000 : 0,
      billable: succeeded,
    });
  }

  private async readText(res: Response): Promise<string> {
    try {
      return (await res.text()).slice(0, 20_000);
    } catch {
      return "";
    }
  }

  /** Release the connection without reading the body (fire-and-forget: cancel may never settle). */
  private discard(res: Response) {
    try {
      res.body?.cancel().catch(() => {});
    } catch {
      // ignore
    }
  }
}
