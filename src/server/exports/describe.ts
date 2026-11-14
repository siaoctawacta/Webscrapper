/**
 * Plain-language descriptions of a list query for the "Search Summary" sheet (pure).
 */
import { LEAD_STATUS_LABELS, type LeadStatus, type QualityStatus, type SourceId, type VerificationStatus, type WebsiteStatus } from "@/lib/domain";
import { FIELDS, type FieldContext } from "@/lib/fields";
import type { Filters, ListQuery, SortSpec } from "@/lib/list-query";
import { QUALITY_STATUS_LABELS, SOURCE_LABELS, VERIFICATION_STATUS_LABELS, WEBSITE_STATUS_LABELS } from "./columns";

const list = (vals: readonly string[]) => vals.join(", ");
const quoted = (s: string) => `“${s}”`;
const labels = <K extends string>(map: Record<K, string>, vals: readonly K[]) => list(vals.map((v) => map[v] ?? v));
const yesNo = (v: boolean, yes: string, no: string) => (v ? yes : no);

/** Every active filter (and the quick search) as short phrases, e.g. ["No website", "Category: Hotel"]. */
export function describeFilters(filters: Filters, search?: string): string[] {
  const f = filters;
  const out: string[] = [];
  if (f.has_phone !== undefined) out.push(yesNo(f.has_phone, "Has a phone number", "No phone number"));
  if (f.has_website !== undefined) out.push(yesNo(f.has_website, "Has a website", "No website"));
  if (f.has_email !== undefined) out.push(yesNo(f.has_email, "Has an email", "No email"));
  if (f.has_address !== undefined) out.push(yesNo(f.has_address, "Has an address", "No address"));
  if (f.category?.length) out.push(`Category: ${list(f.category)}`);
  if (f.exclude_category?.length) out.push(`Excluding categories: ${list(f.exclude_category)}`);
  if (f.city?.length) out.push(`City: ${list(f.city)}`);
  if (f.country?.length) out.push(`Country: ${list(f.country)}`);
  if (f.min_rating !== undefined) out.push(`Rating at least ${f.min_rating}`);
  if (f.max_rating !== undefined) out.push(`Rating at most ${f.max_rating}`);
  if (f.min_reviews !== undefined) out.push(`At least ${f.min_reviews} reviews`);
  if (f.max_reviews !== undefined) out.push(`At most ${f.max_reviews} reviews`);
  if (f.quality?.length) out.push(`Data quality: ${labels<QualityStatus>(QUALITY_STATUS_LABELS, f.quality)}`);
  if (f.website_status?.length) out.push(`Website status: ${labels<WebsiteStatus>(WEBSITE_STATUS_LABELS, f.website_status)}`);
  if (f.email_status?.length) out.push(`Email status: ${labels<VerificationStatus>(VERIFICATION_STATUS_LABELS, f.email_status)}`);
  if (f.source?.length) out.push(`Data source: ${labels<SourceId>(SOURCE_LABELS, f.source)}`);
  if (f.name_contains) out.push(`Name contains ${quoted(f.name_contains)}`);
  if (f.name_starts_with) out.push(`Name starts with ${quoted(f.name_starts_with)}`);
  if (f.domain_contains) out.push(`Website or email domain contains ${quoted(f.domain_contains)}`);
  if (f.address_contains) out.push(`Address contains ${quoted(f.address_contains)}`);
  if (f.hide_duplicates) out.push("Probable duplicates hidden");
  if (f.lead_status?.length) out.push(`Lead status: ${labels<LeadStatus>(LEAD_STATUS_LABELS, f.lead_status)}`);
  if (f.tag?.length) out.push(`Tagged: ${list(f.tag)}`);
  if (f.untagged) out.push("Untagged leads only");
  if (search) out.push(`Quick search: ${quoted(search)}`);
  return out;
}

function directionWords(spec: SortSpec): string {
  const asc = spec.direction === "asc";
  switch (FIELDS[spec.field].kind) {
    case "number":
      return asc ? "lowest first" : "highest first";
    case "date":
      return asc ? "oldest first" : "newest first";
    case "enum":
      return asc ? "in order" : "in reverse order";
    default:
      return asc ? "A to Z" : "Z to A";
  }
}

/** "Rating (highest first), then Business name (A to Z)" or the grid's default order. */
export function describeSort(sort: ListQuery["sort"], ctx: FieldContext): string {
  if (!sort.length) return ctx === "collection" ? "Most recently added first" : "Order returned by the data provider";
  return sort.map((s) => `${FIELDS[s.field].label} (${directionWords(s)})`).join(", then ");
}
