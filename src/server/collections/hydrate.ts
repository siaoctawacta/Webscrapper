// CONTRACT STUB — implemented by the "collections" module agent. Keep this export signature.
import "server-only";
import type { BusinessRow } from "@/lib/api-types";
import type { AppUser } from "../auth/session";

/**
 * Fill provider fields that the source policy forbids storing (restrictedFields) by fetching them
 * live from the provider, for display only. Records usage. Never throws: on failure rows are returned
 * unchanged (restricted fields stay null).
 */
export async function hydrateRows(_user: AppUser, rows: BusinessRow[]): Promise<BusinessRow[]> {
  return rows;
}
