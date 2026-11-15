import "server-only";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { AppUser } from "../auth/session";
import { db } from "../db";
import { concepts } from "../db/schema";
import { env } from "../env";
import { isUuid } from "../http";
import type { ProposalRef } from "./types";

/** Public URL of a shared concept page. */
export const conceptShareUrl = (token: string) => `${env().APP_URL.replace(/\/+$/, "")}/c/${encodeURIComponent(token)}`;

/**
 * The user's most recent *shared* homepage concept for this business, if any:
 * linked by lead_id (lead refs) or by the ref stored in concepts.input ({ ref: { kind, id } }).
 */
export async function findSharedConceptUrl(user: Pick<AppUser, "id">, ref: ProposalRef): Promise<string | null> {
  if (!isUuid(ref.id)) return null;
  const id = ref.id.toLowerCase();
  const byInputRef = sql`(${concepts.input} -> 'ref' ->> 'kind' = ${ref.kind} and lower(${concepts.input} -> 'ref' ->> 'id') = ${id})`;
  const [row] = await db()
    .select({ token: concepts.shareToken })
    .from(concepts)
    .where(
      and(
        eq(concepts.userId, user.id),
        eq(concepts.shareEnabled, true),
        isNotNull(concepts.shareToken),
        ref.kind === "lead" ? or(eq(concepts.leadId, id), byInputRef) : byInputRef,
      ),
    )
    .orderBy(desc(concepts.updatedAt))
    .limit(1);
  return row?.token ? conceptShareUrl(row.token) : null;
}
