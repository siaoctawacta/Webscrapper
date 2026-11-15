/**
 * Reset a user's password from the server (there is no email-based reset):
 *   pnpm user:set-password someone@example.com 'new-password-at-least-10-chars'
 * In Docker:
 *   docker compose exec web node_modules/.bin/tsx --tsconfig tsconfig.worker.json src/scripts/set-password.ts someone@example.com 'new-password'
 * Signs the user out everywhere.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { getAuth } from "@/server/auth/auth";
import { closeDb, db } from "@/server/db";
import { account, session, user } from "@/server/db/schema";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error("Usage: set-password <email> <new password>");
  if (password.length < 10 || password.length > 128) throw new Error("The password must be 10 to 128 characters long.");
  const [u] = await db().select({ id: user.id }).from(user).where(eq(user.email, email.trim().toLowerCase())).limit(1);
  if (!u) throw new Error(`No account with the email ${email}.`);
  const ctx = await getAuth().$context;
  const hash = await ctx.password.hash(password);
  const updated = await db()
    .update(account)
    .set({ password: hash, updatedAt: new Date() })
    .where(and(eq(account.userId, u.id), eq(account.providerId, "credential")))
    .returning({ id: account.id });
  if (!updated.length) throw new Error("This account has no password sign-in to update.");
  const removed = await db().delete(session).where(eq(session.userId, u.id)).returning({ id: session.id });
  console.log(`Password updated for ${email}. Signed out of ${removed.length} session(s).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
