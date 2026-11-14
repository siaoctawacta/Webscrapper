import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { LeadStatus } from "@/lib/domain";
import { MAX_BULK_ROWS, validateListQuery, type ListQuery } from "@/lib/list-query";
import { audit } from "../audit";
import type { AppUser } from "../auth/session";
import { db } from "../db";
import { buildFilterConditions, buildOrderBy, COLLECTION_GRID } from "../db/list-sql";
import { businesses, leads } from "../db/schema";
import { HttpError } from "../errors";
import { isUuid } from "../http";
import { CONTACT_STATUSES, tagsOrThrow } from "./leads";
import { deleteOrphanBusinesses } from "./persist";
import type { BulkAction, BulkBody } from "./schemas";
import { getOwnedCollection, touchCollection } from "./service";
import { cleanTag, MAX_TAGS } from "./tags";

/** Which leads a bulk action applies to: explicit ids (others are ignored) or every lead matching a collection-grid query. */
export type BulkSelector = { leadIds: string[] } | { query: ListQuery | Record<string, unknown> };

export type BulkActionInput =
  | { action: "set_status"; status: LeadStatus }
  | { action: "add_tags" | "remove_tags" | "replace_tags"; tags: string[] }
  | { action: "copy_to" | "move_to"; targetCollectionId: string }
  | { action: "remove" };

export type BulkResult = {
  /** Leads changed (status/tags), copied (copy_to), moved out of this collection (move_to) or removed. */
  affected: number;
  /** copy_to / move_to: leads that were already in the target collection. */
  skipped?: number;
};

/** Split the flat API body into selector + action (the body schema guarantees the required fields). */
export function bulkInputFromBody(body: BulkBody): { selector: BulkSelector; action: BulkActionInput } {
  const selector: BulkSelector = body.leadIds ? { leadIds: body.leadIds } : { query: body.query ?? {} };
  const a: BulkAction = body.action;
  switch (a) {
    case "set_status":
      return { selector, action: { action: a, status: body.status! } };
    case "add_tags":
    case "remove_tags":
    case "replace_tags":
      return { selector, action: { action: a, tags: body.tags ?? [] } };
    case "copy_to":
    case "move_to":
      return { selector, action: { action: a, targetCollectionId: body.targetCollectionId! } };
    case "remove":
      return { selector, action: { action: a } };
  }
}

/** `select leads.id …` for the selector, always scoped to this collection and user. */
function selectorSql(user: AppUser, collectionId: string, selector: BulkSelector): SQL {
  const scope = and(eq(leads.collectionId, collectionId), eq(leads.userId, user.id))!;
  if ("leadIds" in selector) {
    // Malformed ids can never match a lead; dropping them keeps the uuid[] cast from failing.
    const ids = [...new Set(selector.leadIds.filter(isUuid))];
    return sql`select ${leads.id} from ${leads} where ${scope} and ${leads.id} = any(${sql.param(ids)}::uuid[])`;
  }
  const q = validateListQuery(selector.query, "collection");
  const where = and(scope, eq(businesses.userId, user.id), ...buildFilterConditions(q.filters, q.search, COLLECTION_GRID));
  return sql`select ${leads.id} from ${leads} inner join ${businesses} on ${businesses.id} = ${leads.businessId}
    where ${where} order by ${sql.join(buildOrderBy(q, COLLECTION_GRID), sql`, `)} limit ${MAX_BULK_ROWS}`;
}

/** Tags array expression: existing tags plus `add` (case-insensitive de-dupe, first spelling and order kept, ≤ MAX_TAGS). */
const addTagsExpr = (add: string[]) => sql`array(
  select d.t from (
    select distinct on (lower(u.t)) u.t, u.ord
    from unnest(${leads.tags} || ${sql.param(add)}::text[]) with ordinality as u(t, ord)
    order by lower(u.t), u.ord
  ) d
  order by d.ord
  limit ${MAX_TAGS}
)`;

/**
 * Tags array expression without any of `remove`, compared case-insensitively. Both sides are lowered
 * by Postgres so the comparison matches how add_tags de-duplicates, whatever the server's locale.
 */
const removeTagsExpr = (remove: string[]) => sql`array(
  select u.t from unnest(${leads.tags}) with ordinality as u(t, ord)
  where lower(u.t) <> all(array(select lower(r.t) from unnest(${sql.param(remove)}::text[]) as r(t)))
  order by u.ord
)`;

type Counts = { selected: number; inserted: number; moved: number };

/**
 * Apply one bulk action to many leads of a collection owned by the user: one set-based SQL statement
 * per action, inside a transaction. Audited as "collection.bulk".
 */
export async function bulkLeads(
  user: AppUser,
  collectionId: string,
  selector: BulkSelector,
  action: BulkActionInput,
  opts: { ip?: string | null } = {},
): Promise<BulkResult> {
  // Validate inputs before opening the transaction.
  let tags: string[] = [];
  if (action.action === "add_tags" || action.action === "replace_tags") tags = tagsOrThrow(action.tags);
  if (action.action === "remove_tags") tags = [...new Set(action.tags.map(cleanTag).filter(Boolean))];
  if ((action.action === "add_tags" || action.action === "remove_tags") && !tags.length) {
    throw new HttpError("validation_failed", "Enter at least one tag", [{ path: "tags", message: "Enter at least one tag" }]);
  }

  const result = await db().transaction(async (tx): Promise<BulkResult> => {
    const source = await getOwnedCollection(user, collectionId, tx);
    const sel = selectorSql(user, source.id, selector);
    const inSelection = sql`${leads.id} in (${sel})`;
    const now = new Date();

    switch (action.action) {
      case "set_status": {
        const contacted = CONTACT_STATUSES.includes(action.status);
        const rows = await tx
          .update(leads)
          .set({ status: action.status, updatedAt: now, ...(contacted ? { lastContactedAt: now } : {}) })
          .where(inSelection)
          .returning({ id: leads.id });
        if (rows.length) await touchCollection(tx, [source.id]);
        return { affected: rows.length };
      }
      case "add_tags":
      case "remove_tags":
      case "replace_tags": {
        const expr =
          action.action === "add_tags" ? addTagsExpr(tags) : action.action === "remove_tags" ? removeTagsExpr(tags) : sql`${sql.param(tags)}::text[]`;
        const rows = await tx.update(leads).set({ tags: expr, updatedAt: now }).where(inSelection).returning({ id: leads.id });
        if (rows.length) await touchCollection(tx, [source.id]);
        return { affected: rows.length };
      }
      case "copy_to":
      case "move_to": {
        if (action.targetCollectionId === source.id) {
          throw new HttpError("validation_failed", "Choose a different collection to copy or move these leads to.", [
            { path: "targetCollectionId", message: "Same collection" },
          ]);
        }
        const target = await getOwnedCollection(user, action.targetCollectionId, tx);
        // Copies keep status, tags, notes and last-contacted date. Leads already in the target are skipped;
        // a move removes from this collection exactly the leads now present in the target.
        const res = await tx.execute<Counts>(sql`
          with sel as (${sel}),
          ins as (
            insert into ${leads} (collection_id, business_id, user_id, status, tags, notes, last_contacted_at)
            select ${target.id}::uuid, src.business_id, src.user_id, src.status, src.tags, src.notes, src.last_contacted_at
            from ${leads} src join sel on sel.id = src.id
            on conflict (collection_id, business_id) do nothing
            returning business_id
          ),
          del as (
            delete from ${leads} d using sel
            where ${action.action === "move_to"} and d.id = sel.id
              and (
                d.business_id in (select business_id from ins)
                or exists (select 1 from ${leads} t where t.collection_id = ${target.id}::uuid and t.business_id = d.business_id)
              )
            returning d.id
          )
          select (select count(*) from sel)::int as selected,
                 (select count(*) from ins)::int as inserted,
                 (select count(*) from del)::int as moved
        `);
        const c = res.rows[0] ?? { selected: 0, inserted: 0, moved: 0 };
        const inserted = Number(c.inserted);
        const touched = [...(inserted ? [target.id] : []), ...(Number(c.moved) ? [source.id] : [])];
        await touchCollection(tx, touched);
        if (action.action === "copy_to") return { affected: inserted, skipped: Number(c.selected) - inserted };
        const moved = Number(c.moved);
        return { affected: moved, skipped: moved - inserted };
      }
      case "remove": {
        const res = await tx.execute<{ business_id: string }>(sql`
          with sel as (${sel})
          delete from ${leads} d using sel where d.id = sel.id
          returning d.business_id
        `);
        await deleteOrphanBusinesses(
          tx,
          user.id,
          res.rows.map((r) => r.business_id),
        );
        if (res.rows.length) await touchCollection(tx, [source.id]);
        return { affected: res.rows.length };
      }
    }
  });

  await audit({
    actorId: user.id,
    action: "collection.bulk",
    resourceType: "collection",
    resourceId: collectionId,
    metadata: {
      action: action.action,
      selector: "leadIds" in selector ? "ids" : "query",
      ...("leadIds" in selector ? { requested: selector.leadIds.length } : {}),
      affected: result.affected,
      ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
      ...(action.action === "set_status" ? { status: action.status } : {}),
      ...(tags.length ? { tags: tags.length } : {}),
      ...("targetCollectionId" in action ? { targetCollectionId: action.targetCollectionId } : {}),
    },
    ip: opts.ip,
  });
  return result;
}
