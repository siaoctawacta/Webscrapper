import "server-only";
import { eq } from "drizzle-orm";
import type { SenderProfile } from "@/lib/api-types";
import { mergeGridPrefs, parseStoredGridPrefs, type GridPrefs, type GridPrefsPatch } from "@/lib/grid-prefs";
import { audit } from "../audit";
import { db, type DbOrTx } from "../db";
import { userSettings } from "../db/schema";
import type { SenderProfileInput } from "./schema";

export { senderProfileInputSchema, normalizeWebUrl, type SenderProfileInput } from "./schema";

type UserRef = { id: string };

const PROFILE_KEYS = [
  "senderName",
  "senderCompany",
  "senderEmail",
  "senderPhone",
  "senderWebsite",
  "senderPortfolioUrl",
  "signature",
  "defaultLanguage",
] as const satisfies readonly (keyof SenderProfile)[];

export const emptySenderProfile = (): SenderProfile => ({
  senderName: null,
  senderCompany: null,
  senderEmail: null,
  senderPhone: null,
  senderWebsite: null,
  senderPortfolioUrl: null,
  signature: null,
  defaultLanguage: "en",
});

/** The user's sender profile for proposals. Fields never set are null; language defaults to English. */
export async function getSenderProfile(user: UserRef, tx?: DbOrTx): Promise<SenderProfile> {
  const [row] = await (tx ?? db())
    .select({
      senderName: userSettings.senderName,
      senderCompany: userSettings.senderCompany,
      senderEmail: userSettings.senderEmail,
      senderPhone: userSettings.senderPhone,
      senderWebsite: userSettings.senderWebsite,
      senderPortfolioUrl: userSettings.senderPortfolioUrl,
      signature: userSettings.signature,
      defaultLanguage: userSettings.defaultLanguage,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .limit(1);
  return row ?? emptySenderProfile();
}

/**
 * Update (upsert) the sender profile. Keys absent from `input` are left unchanged; null clears.
 * Input must already be validated with `senderProfileInputSchema`.
 */
export async function updateSenderProfile(
  user: UserRef,
  input: SenderProfileInput,
  opts: { ip?: string | null } = {},
): Promise<SenderProfile> {
  // The schema output has exactly the SenderProfile keys; keep only the ones provided.
  const values = Object.fromEntries(
    PROFILE_KEYS.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]),
  ) as Partial<SenderProfile>;
  const fields = Object.keys(values);
  if (fields.length === 0) return getSenderProfile(user);

  return db().transaction(async (tx) => {
    const [saved] = await tx
      .insert(userSettings)
      .values({ userId: user.id, ...values })
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...values, updatedAt: new Date() } })
      .returning();
    await audit(
      { actorId: user.id, action: "settings.update", resourceType: "user_settings", resourceId: user.id, metadata: { fields }, ip: opts.ip },
      tx,
    );
    if (!saved) throw new Error("Saving settings returned no row");
    return {
      senderName: saved.senderName,
      senderCompany: saved.senderCompany,
      senderEmail: saved.senderEmail,
      senderPhone: saved.senderPhone,
      senderWebsite: saved.senderWebsite,
      senderPortfolioUrl: saved.senderPortfolioUrl,
      signature: saved.signature,
      defaultLanguage: saved.defaultLanguage,
    };
  });
}

/** Saved grid preferences (invalid or outdated entries are dropped). */
export async function getGridPrefs(user: UserRef): Promise<GridPrefs> {
  const [row] = await db()
    .select({ gridPrefs: userSettings.gridPrefs })
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .limit(1);
  return parseStoredGridPrefs(row?.gridPrefs);
}

/** Merge a validated patch into the saved grid preferences (per context) and return the result. */
export async function updateGridPrefs(user: UserRef, patch: GridPrefsPatch): Promise<GridPrefs> {
  return db().transaction(async (tx) => {
    await tx.insert(userSettings).values({ userId: user.id }).onConflictDoNothing({ target: userSettings.userId });
    const [row] = await tx
      .select({ gridPrefs: userSettings.gridPrefs })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .for("update");
    const next = mergeGridPrefs(parseStoredGridPrefs(row?.gridPrefs), patch);
    await tx
      .update(userSettings)
      .set({ gridPrefs: next as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(userSettings.userId, user.id));
    return next;
  });
}

/** Admin-set limit overrides for a user (null = use the global default from env). */
export async function getUserLimitOverrides(
  userId: string,
  tx?: DbOrTx,
): Promise<{ maxResultsPerSearch: number | null; monthlyRequestLimit: number | null }> {
  const [row] = await (tx ?? db())
    .select({ maxResultsPerSearch: userSettings.maxResultsPerSearch, monthlyRequestLimit: userSettings.monthlyRequestLimit })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return { maxResultsPerSearch: row?.maxResultsPerSearch ?? null, monthlyRequestLimit: row?.monthlyRequestLimit ?? null };
}
