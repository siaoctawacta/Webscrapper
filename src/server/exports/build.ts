import "server-only";
/**
 * Turns business rows into an export document: source policy applied per row, human-readable
 * values, plus the "Search Summary" and "Data Quality" content. No I/O — serializers (csv.ts,
 * xlsx.ts) write the document; every text cell is sanitised there.
 */
import type { BusinessRow } from "@/lib/api-types";
import { VERIFICATION_STATUSES, type ExportScope, type SearchKind, type SourceId, type VerificationStatus } from "@/lib/domain";
import { FIELDS, type FieldContext, type FieldKey } from "@/lib/fields";
import type { ListQuery } from "@/lib/list-query";
import { canExport, getPolicy } from "../providers/policy";
import { exportColumn, formatCell, SOURCE_LABELS, VERIFICATION_STATUS_LABELS, type ExportCellValue, type ExportColumn } from "./columns";
import { describeFilters, describeSort } from "./describe";

export type ExcludedFieldReport = { field: FieldKey; reason: string; rows: number; sources: SourceId[] };

export type SummaryMeta =
  | {
      target: "search";
      query: string;
      locationLabel: string | null;
      kind: SearchKind;
      sourceUrl: string | null;
      provider: SourceId;
    }
  | { target: "collection"; collectionName: string; description: string | null };

export type BuildInput = {
  rows: readonly BusinessRow[];
  /** Resolved columns, in file order. */
  columns: readonly FieldKey[];
  context: FieldContext;
  scope: ExportScope;
  query: ListQuery;
  meta: SummaryMeta;
  generatedAt: Date;
  /** Rows matching the filters (page / filtered scopes), when known. */
  rowsMatching: number | null;
  /** Ids the user selected (selected scope). */
  rowsRequested: number | null;
  /** Requested ids that no longer exist. */
  excludedRowCount: number;
  /** Set when a filtered export stopped at the row limit. */
  rowLimit: number | null;
  fileExpiresAt: Date;
  linkTtlMinutes: number;
};

export type SummaryEntry = [label: string, value: string | number];
export type QualitySection = { title: string; note?: string; header?: string[]; rows: (string | number)[][] };

export type ExportDocument = {
  columns: ExportColumn[];
  rows: ExportCellValue[][];
  summary: SummaryEntry[];
  quality: QualitySection[];
  excludedFields: ExcludedFieldReport[];
  rowCount: number;
};

export const EMAIL_NOT_VERIFIED_LINE = "Emails were found on the businesses' own websites and are not verified.";

const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  keyword: "Keyword + location",
  maps_search_link: "Google Maps search link",
  maps_place_link: "Google Maps place link",
};

const SCOPE_LABELS: Record<ExportScope, string> = {
  selected: "Selected rows",
  page: "Current page",
  filtered: "All filtered rows",
};

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const isEmpty = (v: ExportCellValue) => v == null || (typeof v === "string" && v.trim() === "");

const POLICY_FALLBACK_REASON = "The data source's terms do not allow exporting this field";

/** Apply the source policy and format every cell. Withheld cells are empty and counted per field. */
function buildCells(rows: readonly BusinessRow[], columns: readonly FieldKey[]) {
  const allowed = new Map<string, boolean>();
  const can = (source: SourceId, key: FieldKey) => {
    const k = `${source}:${key}`;
    let v = allowed.get(k);
    if (v === undefined) allowed.set(k, (v = canExport(source, key)));
    return v;
  };
  const withheld = new Map<FieldKey, { rows: number; reasons: Set<string>; sources: Set<SourceId> }>();
  const withheldPerColumn = columns.map(() => 0);
  const cells = rows.map((row) =>
    columns.map((key, i) => {
      if (can(row.source, key)) return formatCell(row, key);
      const w = withheld.get(key) ?? { rows: 0, reasons: new Set<string>(), sources: new Set<SourceId>() };
      w.rows += 1;
      w.reasons.add(getPolicy(row.source).restrictionReason || POLICY_FALLBACK_REASON);
      w.sources.add(row.source);
      withheld.set(key, w);
      withheldPerColumn[i]! += 1;
      return null;
    }),
  );
  const excludedFields: ExcludedFieldReport[] = columns
    .filter((k) => withheld.has(k))
    .map((k) => {
      const w = withheld.get(k)!;
      return { field: k, reason: [...w.reasons].join(" / "), rows: w.rows, sources: [...w.sources] };
    });
  return { cells, excludedFields, withheldPerColumn };
}

function statusCounts(rows: readonly BusinessRow[], pick: (r: BusinessRow) => VerificationStatus): (string | number)[][] {
  const counts = new Map<VerificationStatus, number>();
  for (const r of rows) counts.set(pick(r), (counts.get(pick(r)) ?? 0) + 1);
  return VERIFICATION_STATUSES.map((s) => [s === "unknown" ? "Unknown / none found" : VERIFICATION_STATUS_LABELS[s], counts.get(s) ?? 0]);
}

function buildQuality(input: BuildInput, cols: ExportColumn[], cells: ExportCellValue[][], withheldPerColumn: number[], excluded: ExcludedFieldReport[]): QualitySection[] {
  const { rows } = input;
  const total = rows.length;
  const missing: (string | number)[][] = cols.map((c, i) => {
    const withheld = withheldPerColumn[i] ?? 0;
    const filled = cells.reduce((n, r) => n + (isEmpty(r[i] ?? null) ? 0 : 1), 0);
    return [c.header, filled, total - filled - withheld, withheld];
  });
  const duplicates = rows.filter((r) => r.qualityStatus === "duplicate_candidate" || r.duplicateOfId).length;

  const sections: QualitySection[] = [
    { title: "Rows in this file", rows: [["Rows exported", total]] },
    {
      title: "Missing values per column",
      note: "Empty = no value known. Withheld = left empty because the data source's terms do not allow exporting it.",
      header: ["Column", "Filled", "Empty", "Withheld (source policy)"],
      rows: missing,
    },
    {
      title: "Probable duplicates",
      note: "Rows flagged because another row has the same phone number, website or a near-identical name and location. Nothing was merged.",
      rows: [["Probable duplicates", duplicates]],
    },
    {
      title: "Email verification status",
      note: "No email address has been verified by LeadFinder. “Source-provided” means it was published on the business's own website or supplied by the data provider.",
      header: ["Status", "Rows"],
      rows: statusCounts(rows, (r) => r.emailStatus),
    },
    {
      title: "Phone verification status",
      note: "Phone numbers come from the data provider and have not been verified.",
      header: ["Status", "Rows"],
      rows: statusCounts(rows, (r) => r.phoneStatus),
    },
    excluded.length
      ? {
          title: "Excluded fields",
          header: ["Column", "Rows affected", "Reason"],
          rows: excluded.map((e) => [FIELDS[e.field].label, e.rows, e.reason]),
        }
      : { title: "Excluded fields", rows: [["None", "Every chosen column was exported for every row."]] },
    {
      title: "Excluded rows",
      rows: [
        [
          "Selected rows no longer available",
          input.excludedRowCount,
        ],
        ...(input.excludedRowCount > 0 ? [["Why", "They were removed or have expired since you selected them."]] : []),
      ],
    },
  ];
  return sections;
}

function buildSummary(input: BuildInput, rowCount: number, excluded: ExcludedFieldReport[]): SummaryEntry[] {
  const { meta, query } = input;
  const sources = [...new Set<SourceId>([...(meta.target === "search" ? [meta.provider] : []), ...input.rows.map((r) => r.source)])];
  const entries: SummaryEntry[] = [];

  if (meta.target === "search") {
    entries.push(["Export of", "Search results"]);
    entries.push(["Search", meta.query || "—"]);
    entries.push(["Location", meta.locationLabel || "—"]);
    entries.push(["Search type", SEARCH_KIND_LABELS[meta.kind]]);
    if (meta.sourceUrl) entries.push(["Google Maps link", meta.sourceUrl]);
  } else {
    entries.push(["Export of", "Collection"]);
    entries.push(["Collection", meta.collectionName]);
    if (meta.description) entries.push(["Description", meta.description]);
  }
  entries.push(["Data provider", sources.length ? sources.map((s) => SOURCE_LABELS[s]).join(", ") : "—"]);
  const attributions = [...new Set(sources.map((s) => getPolicy(s).attribution).filter((a): a is string => Boolean(a)))];
  if (attributions.length) entries.push(["Attribution", attributions.join(" · ")]);
  entries.push(["Generated at", utc(input.generatedAt)]);

  if (input.scope === "selected") entries.push(["Rows selected", input.rowsRequested ?? rowCount]);
  else if (input.rowsMatching != null) entries.push([meta.target === "collection" ? "Leads found" : "Rows found", input.rowsMatching]);
  entries.push(["Rows exported", rowCount]);
  if (input.excludedRowCount > 0) entries.push(["Rows skipped", `${fmt(input.excludedRowCount)} selected rows no longer exist`]);
  if (input.rowLimit != null && input.rowsMatching != null && input.rowsMatching > input.rowLimit) {
    entries.push(["Export limit", `Only the first ${fmt(input.rowLimit)} rows in the current order were exported.`]);
  }
  entries.push([
    "Rows",
    input.scope === "page" ? `${SCOPE_LABELS.page} (page ${query.page}, ${query.pageSize} rows per page)` : SCOPE_LABELS[input.scope],
  ]);
  const filters = describeFilters(query.filters, query.search);
  entries.push(["Filters", filters.length ? filters.join("; ") : "None"]);
  entries.push(["Sort order", describeSort(query.sort, input.context)]);

  if (excluded.length) {
    entries.push([
      "Withheld columns",
      `${excluded.map((e) => FIELDS[e.field].label).join(", ")}: left empty for some rows because the data source's terms do not allow exporting them. See the Data Quality sheet.`,
    ]);
  }
  if (input.columns.includes("email")) entries.push(["Emails", EMAIL_NOT_VERIFIED_LINE]);
  entries.push([
    "Limitations",
    "Ratings and review counts reflect the moment the data was retrieved and change over time. Phone numbers come from the data provider and have not been verified. Missing values are left empty — nothing was guessed.",
  ]);
  const retention = sources
    .map((s) => getPolicy(s))
    .filter((p) => meta.target === "search" || p.source === "google_places")
    .map((p) =>
      meta.target === "search"
        ? `${p.label} search results are kept in LeadFinder for ${fmt(p.transientRetentionHours)} hours.`
        : `${p.label} details are not stored in collections; only the place ID and Maps link are kept.`,
    );
  entries.push([
    "Retention",
    [
      ...retention,
      `This file is deleted from LeadFinder on ${utc(input.fileExpiresAt)}. Download links expire ${fmt(input.linkTtlMinutes)} minutes after they are created.`,
    ].join(" "),
  ]);
  return entries;
}

export function buildExportDocument(input: BuildInput): ExportDocument {
  const columns = input.columns.map(exportColumn);
  const { cells, excludedFields, withheldPerColumn } = buildCells(input.rows, input.columns);
  return {
    columns,
    rows: cells,
    summary: buildSummary(input, cells.length, excludedFields),
    quality: buildQuality(input, columns, cells, withheldPerColumn, excludedFields),
    excludedFields,
    rowCount: cells.length,
  };
}
