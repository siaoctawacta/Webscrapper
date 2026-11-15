import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { account, invitations, session, user, verification } from "../db/schema";
import { env } from "../env";
import type { UserRole, UserStatus } from "@/lib/domain";
import { rateLimit } from "../rate-limit";
import { hashToken, INVITE_TOKEN_HEADER, secretsEqual, SETUP_TOKEN_HEADER } from "./tokens";

export type SignUpTokens = { invite?: string | null; setup?: string | null };

const headerOf = (ctx: unknown, name: string): string | null =>
  ((ctx as { headers?: Headers } | null)?.headers?.get(name) ?? null)?.trim() || null;

/**
 * Decide role/status for a new account. There is no email verification, so an email address alone
 * never grants anything; proof comes from a secret token:
 *  - The very first account becomes the admin. In production it must present SETUP_TOKEN
 *    (via /sign-up?setup=<token>); in development no token is needed.
 *  - An invite link token (hashed in `invitations`) for this exact email → active with the invited role.
 *  - Otherwise SIGNUP_MODE decides: approval → pending; invite/closed → rejected (same answer whether or
 *    not the email was invited, so sign-up can't be used to discover invitations).
 */
export async function decideNewUser(
  email: string,
  tokens: SignUpTokens = {},
): Promise<{ role: UserRole; status: UserStatus; invitationId?: string }> {
  const e = env();
  const normalized = email.trim().toLowerCase();

  // Serialize first-user bootstrap so two simultaneous sign-ups cannot both become admin.
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(724001)`);
    const [{ n }] = (await tx.select({ n: count() }).from(user)) as [{ n: number }];
    if (n === 0) {
      if (e.SETUP_TOKEN) {
        if (!tokens.setup || !secretsEqual(tokens.setup, e.SETUP_TOKEN)) {
          throw new APIError("FORBIDDEN", { message: "LeadFinder isn't set up yet. Open the setup link (/sign-up?setup=…) to create the first admin account." });
        }
      } else if (e.APP_ENV === "production") {
        throw new APIError("FORBIDDEN", { message: "LeadFinder isn't set up yet. The server needs a SETUP_TOKEN to create the first admin account." });
      }
      return { role: "admin" as const, status: "active" as const };
    }

    if (tokens.invite) {
      const [invite] = await tx
        .select()
        .from(invitations)
        .where(and(eq(invitations.tokenHash, hashToken(tokens.invite)), eq(invitations.email, normalized), isNull(invitations.acceptedAt)))
        .limit(1);
      if (invite) return { role: invite.role, status: "active" as const, invitationId: invite.id };
    }

    if (e.SIGNUP_MODE === "approval") return { role: "member" as const, status: "pending" as const };
    throw new APIError("FORBIDDEN", {
      message: e.SIGNUP_MODE === "invite" ? "Sign-up needs a valid invitation link. Ask your administrator for one." : "Sign-up is closed.",
    });
  });
}

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "LeadFinder",
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET ?? "dev-only-insecure-secret-change-me-please",
    trustedOrigins: [e.APP_URL],
    database: drizzleAdapter(db(), { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "member", input: false },
        status: { type: "string", required: false, defaultValue: "pending", input: false },
      },
    },
    rateLimit: {
      enabled: e.APP_ENV !== "test",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Disabled accounts cannot sign in at all (pending accounts may, to see the "awaiting approval" page).
          before: async (sess) => {
            const [row] = await db().select({ status: user.status }).from(user).where(eq(user.id, sess.userId)).limit(1);
            if (row?.status === "disabled") {
              throw new APIError("FORBIDDEN", { message: "Your account is disabled. Contact your administrator." });
            }
          },
        },
      },
      user: {
        create: {
          before: async (u, ctx) => {
            const decision = await decideNewUser(u.email, {
              invite: headerOf(ctx, INVITE_TOKEN_HEADER),
              setup: headerOf(ctx, SETUP_TOKEN_HEADER),
            });
            return { data: { ...u, email: u.email.toLowerCase(), role: decision.role, status: decision.status } };
          },
          after: async (u, ctx) => {
            const token = headerOf(ctx, INVITE_TOKEN_HEADER);
            if (!token) return;
            await db()
              .update(invitations)
              .set({ acceptedAt: new Date() })
              .where(and(eq(invitations.tokenHash, hashToken(token)), eq(invitations.email, u.email.toLowerCase())));
          },
        },
      },
    },
    hooks: {
      // Per-account limit on password attempts. Unlike the per-IP limit above it cannot be dodged by
      // spoofing X-Forwarded-For.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email" || e.APP_ENV === "test") return;
        const email = typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
        if (!email) return;
        try {
          await rateLimit(`signin:${email}`, 10, 15 * 60);
        } catch {
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in attempts for this account. Wait 15 minutes and try again." });
        }
      }),
    },
    advanced: {
      ipAddress: { ipAddressHeaders: [e.CLIENT_IP_HEADER] },
      useSecureCookies: e.APP_URL.startsWith("https://"),
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
    },
    telemetry: { enabled: false },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __leadfinderAuth?: Auth };

export function getAuth(): Auth {
  if (!g.__leadfinderAuth) g.__leadfinderAuth = createAuth();
  return g.__leadfinderAuth;
}
