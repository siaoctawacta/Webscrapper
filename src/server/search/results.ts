// CONTRACT STUB — implemented by the "search" module agent. Keep these export signatures.
import "server-only";
import type { BusinessRow, ListResponse } from "@/lib/api-types";
import type { ListQuery } from "@/lib/list-query";
import type { AppUser } from "../auth/session";
import type { SearchJob } from "../db/schema";

/** Load a job owned by the user or throw HttpError not_found. */
export async function getOwnedJob(_user: AppUser, _jobId: string): Promise<SearchJob> {
  throw new Error("Not implemented yet");
}

/** One page of results (sorted/filtered server-side) with facets and source policies. */
export async function listSearchResults(_user: AppUser, _jobId: string, _query: ListQuery): Promise<ListResponse> {
  throw new Error("Not implemented yet");
}

/** All ids matching the query (for "select all filtered"), capped at MAX_BULK_ROWS, in sort order. */
export async function listSearchResultIds(_user: AppUser, _jobId: string, _query: ListQuery): Promise<{ ids: string[]; total: number; truncated: boolean }> {
  throw new Error("Not implemented yet");
}

/** Rows by id (owned by user, in the given job), in the query's sort order. */
export async function getSearchResultsByIds(_user: AppUser, _jobId: string, _ids: string[], _query?: Pick<ListQuery, "sort">): Promise<BusinessRow[]> {
  throw new Error("Not implemented yet");
}

export async function getSearchResult(_user: AppUser, _resultId: string): Promise<BusinessRow> {
  throw new Error("Not implemented yet");
}
