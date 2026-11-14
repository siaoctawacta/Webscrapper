import { eq } from "drizzle-orm";
import { getAuth } from "@/server/auth/auth";
import { db } from "@/server/db";
import { user } from "@/server/db/schema";
import type { UserRole, UserStatus } from "@/lib/domain";

let counter = 0;

export type TestUser = { id: string; email: string; cookie: string; headers: Headers };

/**
 * Create a user through Better Auth (real password hashing + session) and force role/status.
 * Returns a Cookie header usable with route handlers.
 */
export async function createTestUser(opts: { role?: UserRole; status?: UserStatus; email?: string } = {}): Promise<TestUser> {
  counter += 1;
  const email = opts.email ?? `user${counter}-${Date.now()}@test.local`;
  const password = "correct-horse-battery-staple";
  const res = await getAuth().api.signUpEmail({ body: { email, password, name: `Test User ${counter}` }, asResponse: true });
  if (!res.ok) throw new Error(`signUp failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string } };
  await db()
    .update(user)
    .set({ role: opts.role ?? "member", status: opts.status ?? "active" })
    .where(eq(user.id, body.user.id));
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  const cookie = setCookie.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  const headers = new Headers({ cookie, origin: "http://localhost:3000" });
  return { id: body.user.id, email, cookie, headers };
}
