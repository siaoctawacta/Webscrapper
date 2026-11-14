// CONTRACT STUB — implemented by the "collections" module agent. Keep these export signatures.
import "server-only";
import type { BusinessRow, ListResponse } from "@/lib/api-types";
import type { ListQuery } from "@/lib/list-query";
import type { AppUser } from "../auth/session";

/** One page of leads in a collection owned by the user. hydrate (default true) loads restricted fields live. */
export async function listLeads(_user: AppUser, _collectionId: string, _query: ListQuery, _opts?: { hydrate?: boolean }): Promise<ListResponse> {
  throw new Error("Not implemented yet");
}

export async function listLeadIds(_user: AppUser, _collectionId: string, _query: ListQuery): Promise<{ ids: string[]; total: number; truncated: boolean }> {
  throw new Error("Not implemented yet");
}

/** Leads by id (owned by user, in the collection), in the query's sort order. */
export async function getLeadsByIds(_user: AppUser, _collectionId: string, _ids: string[], _query?: Pick<ListQuery, "sort">, _opts?: { hydrate?: boolean }): Promise<BusinessRow[]> {
  throw new Error("Not implemented yet");
}

/** A single lead (owned by user) as a row, hydrated by default. */
export async function getLeadRow(_user: AppUser, _leadId: string, _opts?: { hydrate?: boolean }): Promise<BusinessRow> {
  throw new Error("Not implemented yet");
}
