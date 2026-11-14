import "server-only";
import { z } from "zod";
import type { BusinessRow } from "@/lib/api-types";
import type { AppUser } from "./auth/session";
import { getLeadRow } from "./collections/leads";
import { getSearchResult } from "./search/results";

/** A pointer to a business the user can see: a search result or a saved lead. */
export const businessRefSchema = z.object({
  kind: z.enum(["result", "lead"]),
  id: z.string().uuid(),
});
export type BusinessRef = z.infer<typeof businessRefSchema>;

/** Load the business behind a ref (ownership enforced; leads hydrated so restricted fields are present for display). */
export async function loadBusinessRef(user: AppUser, ref: BusinessRef): Promise<BusinessRow> {
  return ref.kind === "result" ? getSearchResult(user, ref.id) : getLeadRow(user, ref.id, { hydrate: true });
}
