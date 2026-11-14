import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { count, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { account, invitations, session, user, verification } from "../db/schema";
import { env } from "../env";
import type { UserRole, UserStatus } from "@/lib/domain";

/**
 * Decide role/status for a new account. Rules:
 *  - The very first account, and any email in ADMIN_EMAILS, becomes an active admin.
 *  - An invited email becomes active with the invited role.
 *  - Otherwise SIGNUP_MODE decides: approval → pending; invite/closed → rejected.
 */
export async function decideNewUser(email: string): Promise<{ role: UserRole; status: UserStatus; invitationId?: string }> {
  const e = env();
  const normalized = email.trim().toLowerCase();
  if (e.ADMIN_EMAILS.includes(normalized)) return { role: "admin", status: "active" };

  // Serialize first-user bootstrap so two simultaneous sign-ups cannot both become admin.
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(724001)`);
    const [{ n }] = (await tx.select({ n: count() }).from(user)) as [{ n: number }];
    if (n === 0) return { role: "admin" as const, status: "active" as const };

    const [invite] = await tx.select().from(invitations).where(eq(invitations.email, normalized)).limit(1);
    if (invite && !invite.acceptedAt) return { role: invite.role, status: "active" as const, invitationId: invite.id };

    if (e.SIGNUP_MODE === "approval") return { role: "member" as const, status: "pending" as const };
    throw new APIError("FORBIDDEN", {
      message: e.SIGNUP_MODE === "invite" ? "Sign-up is by invitation only." : "Sign-up is closed.",
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
      user: {
        create: {
          before: async (u) => {
            const decision = await decideNewUser(u.email);
            return { data: { ...u, email: u.email.toLowerCase(), role: decision.role, status: decision.status } };
          },
          after: async (u) => {
            await db()
              .update(invitations)
              .set({ acceptedAt: new Date() })
              .where(eq(invitations.email, u.email.toLowerCase()));
          },
        },
      },
    },
    advanced: {
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
