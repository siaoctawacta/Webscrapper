import "server-only";
import { and, eq, isNotNull, isNull, ne, not, or, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { LEAD_STATUSES, QUALITY_STATUSES, VERIFICATION_STATUSES, WEBSITE_STATUSES } from "@/lib/domain";
import type { FieldContext, FieldKey } from "@/lib/fields";
import type { Filters, ListQuery } from "@/lib/list-query";
import { businesses, leads, searchResults } from "./schema";

/**
 * Translates a validated ListQuery into SQL for one of the two grids.
 * Only allowlisted fields/filters reach this point (see src/lib/list-query.ts); every value is
 * bound as a parameter — no user text is ever interpolated into SQL.
 */

type BusinessColumnSet = {
  id: AnyColumn;
  name: AnyColumn;
  category: AnyColumn;
  phoneRaw: AnyColumn;
  phoneE164: AnyColumn;
  phoneDigits: AnyColumn;
  websiteUrl: AnyColumn;
  websiteHost: AnyColumn;
  websiteStatus: AnyColumn;
  primaryEmail: AnyColumn;
  emailStatus: AnyColumn;
  phoneStatus: AnyColumn;
  address: AnyColumn;
  city: AnyColumn;
  region: AnyColumn;
  country: AnyColumn;
  postalCode: AnyColumn;
  lat: AnyColumn;
  lng: AnyColumn;
  rating: AnyColumn;
  reviewCount: AnyColumn;
  businessStatus: AnyColumn;
  qualityStatus: AnyColumn;
  source: AnyColumn;
  retrievedAt: AnyColumn;
  lastVerifiedAt: AnyColumn;
};

type LeadColumnSet = {
  id: AnyColumn;
  status: AnyColumn;
  tags: AnyColumn;
  notes: AnyColumn;
  lastContactedAt: AnyColumn;
  createdAt: AnyColumn;
};

export type GridColumns = {
  ctx: FieldContext;
  b: BusinessColumnSet;
  lead?: LeadColumnSet;
  /** Final deterministic tie-breakers. */
  tieBreakers: SQL[];
};

export const RESULTS_GRID: GridColumns = {
  ctx: "results",
  b: searchResults,
  tieBreakers: [sql`${searchResults.position} asc`, sql`${searchResults.id} asc`],
};

export const COLLECTION_GRID: GridColumns = {
  ctx: "collection",
  b: businesses,
  lead: leads,
  tieBreakers: [sql`${leads.createdAt} desc`, sql`${leads.id} asc`],
};

const caseOrder = (col: AnyColumn, values: readonly string[]) =>
  sql`(case ${col} ${sql.join(
    values.map((v, i) => sql`when ${v} then ${i}`),
    sql` `,
  )} else ${values.length} end)`;

/** Escape LIKE wildcards in user text. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const contains = (s: string) => `%${likeEscape(s)}%`;

function sortExpression(field: FieldKey, g: GridColumns): SQL | null {
  const b = g.b;
  switch (field) {
    case "business_name":
      return sql`lower(${b.name})`;
    case "category":
      return sql`lower(${b.category})`;
    case "phone":
      return sql`${b.phoneDigits}`;
    case "website":
      return sql`${b.websiteHost}`;
    case "website_status":
      return caseOrder(b.websiteStatus, WEBSITE_STATUSES);
    case "email":
      return sql`lower(${b.primaryEmail})`;
    case "email_status":
      return caseOrder(b.emailStatus, VERIFICATION_STATUSES);
    case "phone_status":
      return caseOrder(b.phoneStatus, VERIFICATION_STATUSES);
    case "address":
      return sql`lower(${b.address})`;
    case "city":
      return sql`lower(${b.city})`;
    case "region":
      return sql`lower(${b.region})`;
    case "country":
      return sql`lower(${b.country})`;
    case "postal_code":
      return sql`${b.postalCode}`;
    case "rating":
      return sql`${b.rating}`;
    case "review_count":
      return sql`${b.reviewCount}`;
    case "latitude":
      return sql`${b.lat}`;
    case "longitude":
      return sql`${b.lng}`;
    case "business_status":
      return sql`${b.businessStatus}`;
    case "quality_status":
      return caseOrder(b.qualityStatus, QUALITY_STATUSES);
    case "source":
      return sql`${b.source}`;
    case "retrieved_at":
      return sql`${b.retrievedAt}`;
    case "last_verified":
      return sql`${b.lastVerifiedAt}`;
    case "lead_status":
      return g.lead ? caseOrder(g.lead.status, LEAD_STATUSES) : null;
    case "last_contacted":
      return g.lead ? sql`${g.lead.lastContactedAt}` : null;
    case "added_at":
      return g.lead ? sql`${g.lead.createdAt}` : null;
    default:
      return null;
  }
}

/** ORDER BY list: requested keys (nulls always last), implicit name secondary for status sorts, then tie-breakers. */
export function buildOrderBy(query: Pick<ListQuery, "sort">, g: GridColumns): SQL[] {
  const out: SQL[] = [];
  for (const s of query.sort) {
    const expr = sortExpression(s.field, g);
    if (!expr) continue;
    out.push(s.direction === "desc" ? sql`${expr} desc nulls last` : sql`${expr} asc nulls last`);
  }
  const statusSort = query.sort.some((s) => s.field === "quality_status" || s.field === "lead_status");
  if (statusSort && !query.sort.some((s) => s.field === "business_name")) {
    out.push(sql`lower(${g.b.name}) asc nulls last`);
  }
  return [...out, ...g.tieBreakers];
}

const lowerAll = (vals: string[]) => vals.map((v) => v.toLowerCase());
/** Bind a JS array as ONE text[] parameter (a bare array in sql`` would expand to a list). */
const textArray = (vals: string[]) => sql`${sql.param(vals)}::text[]`;

export function buildFilterConditions(filters: Filters, search: string | undefined, g: GridColumns): SQL[] {
  const b = g.b;
  const c: SQL[] = [];
  const f = filters;

  if (f.has_phone !== undefined) {
    c.push(f.has_phone ? or(isNotNull(b.phoneE164), isNotNull(b.phoneRaw))! : and(isNull(b.phoneE164), isNull(b.phoneRaw))!);
  }
  if (f.has_website !== undefined) {
    c.push(f.has_website ? ne(b.websiteStatus, "none") : eq(b.websiteStatus, "none"));
  }
  if (f.has_email !== undefined) c.push(f.has_email ? isNotNull(b.primaryEmail) : isNull(b.primaryEmail));
  if (f.has_address !== undefined) c.push(f.has_address ? isNotNull(b.address) : isNull(b.address));
  if (f.category?.length) c.push(sql`${b.category} = any(${textArray(f.category)})`);
  if (f.exclude_category?.length)
    c.push(or(isNull(b.category), not(sql`${b.category} = any(${textArray(f.exclude_category)})`))!);
  if (f.city?.length) c.push(sql`lower(${b.city}) = any(${textArray(lowerAll(f.city))})`);
  if (f.country?.length) c.push(sql`lower(${b.country}) = any(${textArray(lowerAll(f.country))})`);
  if (f.min_rating !== undefined) c.push(sql`${b.rating} >= ${f.min_rating}`);
  if (f.max_rating !== undefined) c.push(sql`${b.rating} <= ${f.max_rating}`);
  if (f.min_reviews !== undefined) c.push(sql`${b.reviewCount} >= ${f.min_reviews}`);
  if (f.max_reviews !== undefined) c.push(sql`${b.reviewCount} <= ${f.max_reviews}`);
  if (f.quality?.length) c.push(sql`${b.qualityStatus} = any(${textArray(f.quality)})`);
  if (f.website_status?.length) c.push(sql`${b.websiteStatus} = any(${textArray(f.website_status)})`);
  if (f.email_status?.length) c.push(sql`${b.emailStatus} = any(${textArray(f.email_status)})`);
  if (f.source?.length) c.push(sql`${b.source} = any(${textArray(f.source)})`);
  if (f.name_contains) c.push(sql`${b.name} ilike ${contains(f.name_contains)}`);
  if (f.name_starts_with) c.push(sql`${b.name} ilike ${likeEscape(f.name_starts_with) + "%"}`);
  if (f.domain_contains) {
    const p = contains(f.domain_contains);
    c.push(or(sql`${b.websiteHost} ilike ${p}`, sql`split_part(${b.primaryEmail}, '@', 2) ilike ${p}`)!);
  }
  if (f.address_contains) c.push(sql`${b.address} ilike ${contains(f.address_contains)}`);
  if (f.hide_duplicates) c.push(ne(b.qualityStatus, "duplicate_candidate"));

  if (g.lead) {
    if (f.lead_status?.length) c.push(sql`${g.lead.status} = any(${textArray(f.lead_status)})`);
    if (f.tag?.length) c.push(sql`${g.lead.tags} && ${textArray(f.tag)}`);
    if (f.untagged) c.push(sql`cardinality(${g.lead.tags}) = 0`);
  }

  if (search) {
    const p = contains(search);
    const digits = search.replace(/\D/g, "");
    const parts: SQL[] = [
      sql`${b.name} ilike ${p}`,
      sql`${b.category} ilike ${p}`,
      sql`${b.address} ilike ${p}`,
      sql`${b.city} ilike ${p}`,
      sql`${b.primaryEmail} ilike ${p}`,
      sql`${b.websiteHost} ilike ${p}`,
      sql`${b.phoneRaw} ilike ${p}`,
    ];
    if (digits.length >= 4) parts.push(sql`${b.phoneDigits} like ${"%" + digits + "%"}`);
    if (g.lead) {
      parts.push(sql`${g.lead.notes} ilike ${p}`);
      parts.push(sql`array_to_string(${g.lead.tags}, ' ') ilike ${p}`);
    }
    c.push(or(...parts)!);
  }
  return c;
}
