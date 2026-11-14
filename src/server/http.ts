import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import type { ApiError } from "@/lib/api-types";
import { HttpError, notFound } from "./errors";
import { ListQueryError } from "@/lib/list-query";
import { env } from "./env";
import { requireActiveUser, requireAdminUser, type AppUser } from "./auth/session";

export { HttpError, notFound, type ErrorCode } from "./errors";

export function json<T>(data: T, status = 200, headers?: HeadersInit) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    const body: ApiError = { error: { code: err.code, message: err.message, details: err.details } };
    return json(body, err.status);
  }
  if (err instanceof ListQueryError) {
    return json<ApiError>({ error: { code: "validation_failed", message: err.message, details: err.issues } }, 422);
  }
  if (err instanceof ZodError) {
    return json<ApiError>(
      {
        error: {
          code: "validation_failed",
          message: "Invalid request",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      422,
    );
  }
  console.error("[api] unhandled error", err);
  return json<ApiError>({ error: { code: "internal", message: "Something went wrong" } }, 500);
}

/** Parse and validate a JSON body. Throws HttpError/ZodError (handled by the route wrappers). */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 1_000_000) throw new HttpError("bad_request", "Request body too large");
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError("bad_request", "Body must be valid JSON");
  }
  return schema.parse(raw);
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence for cookie-authenticated mutations: the Origin (or Referer) must match this app.
 * Session cookies are SameSite=Lax as well; this is the second layer.
 */
export function assertSameOrigin(req: Request) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) throw new HttpError("forbidden", "Missing Origin header");
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    throw new HttpError("forbidden", "Invalid Origin header");
  }
  const allowed = new Set<string>([new URL(env().APP_URL).host]);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) allowed.add(host);
  if (!allowed.has(o.host)) throw new HttpError("forbidden", "Cross-origin request blocked");
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

type Params = Record<string, string | string[]>;
type Ctx<P> = { params: Promise<P> };
type Handler<P, U> = (req: NextRequest, ctx: { params: P; user: U; ip: string | null }) => Promise<Response>;

/** Route wrapper for signed-in, approved users. Enforces same-origin on mutations. */
export function withUser<P extends Params = Record<string, never>>(handler: Handler<P, AppUser>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      assertSameOrigin(req);
      const user = await requireActiveUser(req.headers);
      return await handler(req, { params: await ctx.params, user, ip: clientIp(req) });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Route wrapper for admins. */
export function withAdmin<P extends Params = Record<string, never>>(handler: Handler<P, AppUser>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      assertSameOrigin(req);
      const user = await requireAdminUser(req.headers);
      return await handler(req, { params: await ctx.params, user, ip: clientIp(req) });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Route wrapper for public endpoints (still gets uniform error handling). */
export function withPublic<P extends Params = Record<string, never>>(handler: Handler<P, null>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      return await handler(req, { params: await ctx.params, user: null, ip: clientIp(req) });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Validate a path id; unknown/garbage ids are 404 (never 500). */
export function uuidParam(v: string | string[] | undefined, what = "Resource"): string {
  if (typeof v !== "string" || !isUuid(v)) throw notFound(what);
  return v;
}
