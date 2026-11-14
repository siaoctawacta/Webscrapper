import "server-only";
/**
 * Where export rows come from. The default source reads the same server-side, sorted and filtered
 * queries as the grids (search results / collection leads); tests inject a fake.
 */
import type { BusinessRow } from "@/lib/api-types";
import type { ListQuery } from "@/lib/list-query";
import type { AppUser } from "../auth/session";
import { getLeadsByIds, listLeads } from "../collections/leads";
import { getSearchResultsByIds, listSearchResults } from "../search/results";

export type ExportTargetRef = { target: "search"; jobId: string } | { target: "collection"; collectionId: string };

export type RowPage = {
  rows: BusinessRow[];
  /** Rows matching the query (all pages). */
  total: number;
  /** Page size the source actually applied (it may clamp the requested size). */
  pageSize: number;
};

export interface RowSource {
  /** One page of rows in the query's sort order. Ownership is enforced by the source. */
  list(user: AppUser, ref: ExportTargetRef, query: ListQuery): Promise<RowPage>;
  /** Rows by id in the query's sort order; unknown ids are skipped. */
  byIds(user: AppUser, ref: ExportTargetRef, ids: string[], query: Pick<ListQuery, "sort">): Promise<BusinessRow[]>;
}

/** Search results / collection leads. Leads are read without live provider hydration (exports never include restricted fields). */
export const defaultRowSource: RowSource = {
  async list(user, ref, query) {
    const res =
      ref.target === "search"
        ? await listSearchResults(user, ref.jobId, query)
        : await listLeads(user, ref.collectionId, query, { hydrate: false });
    return { rows: res.rows, total: res.total, pageSize: res.pageSize };
  },
  async byIds(user, ref, ids, query) {
    return ref.target === "search"
      ? getSearchResultsByIds(user, ref.jobId, ids, query)
      : getLeadsByIds(user, ref.collectionId, ids, query, { hydrate: false });
  },
};
