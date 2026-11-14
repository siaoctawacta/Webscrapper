import { describe, expect, it } from "vitest";
import { defaultListQuery, type ListQuery } from "@/lib/list-query";
import { FIELD_KEYS, FIELDS, fieldsFor, type FieldKey } from "@/lib/fields";
import { getPolicy } from "../providers/policy";
import { buildExportDocument, EMAIL_NOT_VERIFIED_LINE, type BuildInput } from "./build";
import { formatCell, formatSocials, hyperlinkFor, resolveColumns } from "./columns";
import { describeFilters, describeSort } from "./describe";
import { businessRow, googleRow, withLead } from "./test-fixtures";

const ALL_RESULTS = fieldsFor("results");

function input(o: Partial<BuildInput> = {}): BuildInput {
  return {
    rows: [businessRow(1)],
    columns: ["business_name", "phone", "email"],
    context: "results",
    scope: "filtered",
    query: defaultListQuery(),
    meta: { target: "search", query: "hôtel", locationLabel: "Lomé, Togo", kind: "keyword", sourceUrl: null, provider: "sample" },
    generatedAt: new Date(Date.UTC(2026, 10, 14, 10, 0)),
    rowsMatching: 1,
    rowsRequested: null,
    excludedRowCount: 0,
    rowLimit: 20000,
    fileExpiresAt: new Date(Date.UTC(2026, 10, 15, 10, 0)),
    linkTtlMinutes: 15,
    ...o,
  };
}

const summaryMap = (doc: ReturnType<typeof buildExportDocument>) => new Map(doc.summary.map(([k, v]) => [k, v]));

describe("source policy", () => {
  it("exports only the Maps link, place ID and app-owned columns for Google rows", () => {
    const doc = buildExportDocument(input({ rows: [googleRow(1), googleRow(2)], columns: ALL_RESULTS }));
    const allowed = new Set<FieldKey>(["maps_url", "source_record_id", ...FIELD_KEYS.filter((k) => FIELDS[k].origin !== "provider")]);
    doc.columns.forEach((c, i) => {
      for (const row of doc.rows) {
        if (allowed.has(c.key)) continue;
        expect(row[i], `${c.key} must be empty for Google rows`).toBeNull();
      }
    });
    const col = (k: FieldKey) => doc.columns.findIndex((c) => c.key === k);
    expect(doc.rows[0]![col("maps_url")]).toBe("https://maps.google.com/?cid=1");
    expect(doc.rows[0]![col("source_record_id")]).toBe("ChIJplace1");
    expect(doc.rows[0]![col("email")]).toBe("contact@biz1.example");
    expect(doc.rows[0]![col("website_status")]).toBe("Has website");

    const reason = getPolicy("google_places").restrictionReason;
    const restricted = ALL_RESULTS.filter((k) => !allowed.has(k));
    expect(doc.excludedFields.map((e) => e.field)).toEqual(restricted);
    for (const e of doc.excludedFields) expect(e).toMatchObject({ reason, rows: 2, sources: ["google_places"] });
    expect(String(summaryMap(doc).get("Attribution"))).toContain("Data from Google Maps");
    expect(String(summaryMap(doc).get("Withheld columns"))).toContain("Business name");
  });

  it("exports every column for sample rows and reports nothing excluded", () => {
    const doc = buildExportDocument(input({ rows: [businessRow(1)], columns: ALL_RESULTS }));
    expect(doc.excludedFields).toEqual([]);
    const name = doc.columns.findIndex((c) => c.key === "business_name");
    expect(doc.rows[0]![name]).toBe("Business 001");
    expect(doc.rows[0]!.filter((v) => v === null).length).toBe(1); // last_verified is never set without real verification
  });

  it("handles mixed sources row by row", () => {
    const doc = buildExportDocument(input({ rows: [businessRow(1), googleRow(2)], columns: ["business_name", "maps_url"] }));
    expect(doc.rows).toEqual([
      ["Business 001", "https://maps.google.com/?cid=1"],
      [null, "https://maps.google.com/?cid=2"],
    ]);
    expect(doc.excludedFields).toEqual([{ field: "business_name", reason: getPolicy("google_places").restrictionReason, rows: 1, sources: ["google_places"] }]);
    const excludedSection = doc.quality.find((s) => s.title === "Excluded fields")!;
    expect(excludedSection.rows).toEqual([["Business name", 1, getPolicy("google_places").restrictionReason]]);
  });
});

describe("value formatting", () => {
  it("formats socials, tags, enums, dates and numbers", () => {
    const row = withLead(
      businessRow(7, {
        socials: { instagram: "https://instagram.com/x", facebook: "https://facebook.com/x", whatsapp: "https://wa.me/22890123456" },
        websiteStatus: "none",
        emailStatus: "source_provided",
        qualityStatus: "duplicate_candidate",
        businessStatus: "CLOSED_TEMPORARILY",
      }),
      { status: "proposal_sent", tags: ["VIP", "Hôtel"], notes: "Rappeler lundi", lastContactedAt: "2026-11-10T15:00:00.000Z" },
    );
    expect(formatCell(row, "socials")).toBe("facebook: https://facebook.com/x; instagram: https://instagram.com/x; whatsapp: https://wa.me/22890123456");
    expect(formatCell(row, "tags")).toBe("VIP, Hôtel");
    expect(formatCell(row, "website_status")).toBe("No website");
    expect(formatCell(row, "email_status")).toBe("Source-provided (not verified)");
    expect(formatCell(row, "quality_status")).toBe("Probable duplicate");
    expect(formatCell(row, "business_status")).toBe("Temporarily closed");
    expect(formatCell(row, "lead_status")).toBe("Proposal sent");
    expect(formatCell(row, "source")).toBe("Sample data");
    expect(formatCell(row, "last_contacted")).toEqual(new Date("2026-11-10T15:00:00.000Z"));
    expect(formatCell(row, "retrieved_at")).toEqual(new Date("2026-11-14T09:30:00.000Z"));
    expect(formatCell(row, "rating")).toBe(4.5);
    expect(formatCell(row, "review_count")).toBe(17);
    expect(formatCell(row, "latitude")).toBe(6.1319);
    expect(formatCell(row, "postal_code")).toBe("00123");
    expect(formatCell(businessRow(1, { name: "  " }), "business_name")).toBeNull();
    expect(formatSocials({})).toBeNull();
  });

  it("adds lead annotations when asked, without duplicating chosen columns", () => {
    expect(resolveColumns(["business_name", "notes", "business_name"], { includeAnnotations: true })).toEqual([
      "business_name",
      "notes",
      "lead_status",
      "tags",
      "last_contacted",
    ]);
    expect(resolveColumns(["business_name"], {})).toEqual(["business_name"]);
  });

  it("only links valid http(s) URLs and email addresses", () => {
    expect(hyperlinkFor("url", "https://hotel.example/contact")).toBe("https://hotel.example/contact");
    expect(hyperlinkFor("url", "javascript:alert(1)")).toBeNull();
    expect(hyperlinkFor("url", "ftp://hotel.example")).toBeNull();
    expect(hyperlinkFor("url", "https://user:pw@hotel.example")).toBeNull();
    expect(hyperlinkFor("url", "not a url")).toBeNull();
    expect(hyperlinkFor("email", "contact@hotel.example")).toBe("mailto:contact@hotel.example");
    expect(hyperlinkFor("email", "=cmd@x.example")).toBeNull();
    expect(hyperlinkFor(null, "https://x.example")).toBeNull();
  });
});

describe("summary and data quality", () => {
  it("describes the search, filters, sort, counts and limitations", () => {
    const query: ListQuery = {
      ...defaultListQuery(),
      sort: [
        { field: "rating", direction: "desc" },
        { field: "business_name", direction: "asc" },
      ],
      filters: { has_website: false, category: ["Hotel", "Lodging"], min_rating: 4 },
      search: "plage",
    };
    const doc = buildExportDocument(input({ query, rowsMatching: 25000, rows: [businessRow(1)] }));
    const s = summaryMap(doc);
    expect(s.get("Search")).toBe("hôtel");
    expect(s.get("Location")).toBe("Lomé, Togo");
    expect(s.get("Data provider")).toBe("Sample data");
    expect(s.get("Generated at")).toBe("2026-11-14 10:00 UTC");
    expect(s.get("Rows found")).toBe(25000);
    expect(s.get("Rows exported")).toBe(1);
    expect(s.get("Export limit")).toContain("20,000");
    expect(s.get("Rows included")).toBe("All filtered rows");
    expect(s.get("Filters")).toBe("No website; Category: Hotel, Lodging; Rating at least 4; Quick search: “plage”");
    expect(s.get("Sort order")).toBe("Rating (highest first), then Business name (A to Z)");
    expect(s.get("Emails")).toBe(EMAIL_NOT_VERIFIED_LINE);
    expect(String(s.get("Retention"))).toContain("2026-11-15 10:00 UTC");
  });

  it("omits the email line when the email column is not exported", () => {
    const doc = buildExportDocument(input({ columns: ["business_name"] }));
    expect(summaryMap(doc).has("Emails")).toBe(false);
  });

  it("counts missing values, duplicates, statuses and excluded rows", () => {
    const rows = [
      businessRow(1),
      businessRow(2, { phone: null, phoneStatus: "unknown", email: null, emailStatus: "unknown" }),
      businessRow(3, { qualityStatus: "duplicate_candidate", emailStatus: "needs_review" }),
      googleRow(4),
    ];
    const doc = buildExportDocument(input({ rows, scope: "selected", rowsRequested: 6, rowsMatching: null, excludedRowCount: 2 }));
    const section = (t: string) => doc.quality.find((q) => q.title === t)!;
    expect(section("Missing values per column").rows).toEqual([
      ["Business name", 3, 0, 1],
      ["Phone", 2, 1, 1],
      ["Email", 3, 1, 0],
    ]);
    expect(section("Probable duplicates").rows).toEqual([["Probable duplicates", 1]]);
    expect(section("Email verification status").rows).toEqual([
      ["Unknown / none found", 1],
      ["Source-provided (not verified)", 2],
      ["Verified", 0],
      ["Invalid", 0],
      ["Needs review", 1],
    ]);
    expect(section("Excluded rows").rows[0]).toEqual(["Selected rows no longer available", 2]);
    const s = summaryMap(doc);
    expect(s.get("Rows selected")).toBe(6);
    expect(s.get("Rows skipped")).toBe("2 selected rows no longer exist");
  });

  it("describes collection exports and default sort orders", () => {
    const doc = buildExportDocument(
      input({ context: "collection", meta: { target: "collection", collectionName: "Salons Accra", description: null }, rows: [withLead(businessRow(1))] }),
    );
    const s = summaryMap(doc);
    expect(s.get("Collection")).toBe("Salons Accra");
    expect(s.get("Leads found")).toBe(1);
    expect(s.get("Sort order")).toBe("Most recently added first");
    expect(describeSort([], "results")).toBe("Order returned by the data provider");
    expect(describeFilters({ lead_status: ["won"], tag: ["vip"], untagged: true, hide_duplicates: true })).toEqual([
      "Probable duplicates hidden",
      "Lead status: Won",
      "Tagged: vip",
      "Untagged leads only",
    ]);
  });
});
