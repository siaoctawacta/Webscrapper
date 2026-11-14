import "server-only";
import { eq } from "drizzle-orm";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole, UserStatus } from "@/lib/domain";
import { db } from "../db";
import { user } from "../db/schema";
import { getAuth } from "./auth";
import { HttpError } from "../errors";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
};

/**
 * Current user from the session cookie, with role/status read fresh from the database
 * (so an admin disabling or approving someone takes effect on the next request).
 */
export async function getUserFromHeaders(h: Headers): Promise<AppUser | null> {
  const s = await getAuth().api.getSession({ headers: h });
  if (!s?.user) return null;
  const [row] = await db()
    .select({ id: user.id, name: user.name, email: user.email, role: user.role, status: user.status })
    .from(user)
    .where(eq(user.id, s.user.id))
    .limit(1);
  return row ?? null;
}


export async function requireActiveUser(h: Headers): Promise<AppUser> {
  const u = await getUserFromHeaders(h);
  if (!u) throw new HttpError("unauthorized", "Please sign in");
  if (u.status === "pending") throw new HttpError("forbidden", "Your account is waiting for an administrator's approval");
  if (u.status !== "active") throw new HttpError("forbidden", "Your account is disabled");
  return u;
}

export async function requireAdminUser(h: Headers): Promise<AppUser> {
  const u = await requireActiveUser(h);
  if (u.role !== "admin") throw new HttpError("forbidden", "Administrators only");
  return u;
}

/* ── Server Components / Server Actions ── */

export async function currentUser(): Promise<AppUser | null> {
  return getUserFromHeaders(await nextHeaders());
}

/** For pages: redirect to sign-in / pending instead of throwing. */
export async function pageUser(): Promise<AppUser> {
  const u = await currentUser();
  if (!u) redirect("/sign-in");
  if (u.status === "pending") redirect("/pending");
  if (u.status !== "active") redirect("/sign-in?disabled=1");
  return u;
}

export async function pageAdmin(): Promise<AppUser> {
  const u = await pageUser();
  if (u.role !== "admin") redirect("/search");
  return u;
}
