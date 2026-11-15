import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { defaultListQuery } from "@/lib/list-query";
import { buildExportDocument, EMAIL_NOT_VERIFIED_LINE, type BuildInput } from "./build";
import { columnLetter, fitColumnWidths, buildXlsx, SHEET_NAMES } from "./xlsx";
import { exportColumn } from "./columns";
import { businessRow, googleRow } from "./test-fixtures";

const generatedAt = new Date(Date.UTC(2026, 10, 14, 10, 0));

function doc(o: Partial<BuildInput> = {}) {
  return buildExportDocument({
    rows: [
      businessRow(1, { name: "Hôtel Le Bénin", phone: "+228 90 12 34 56", postalCode: "00123" }),
      businessRow(2, { name: "=HYPERLINK(\"http://evil.example\",\"x\")", website: "javascript:alert(1)", email: "not-an-email" }),
      googleRow(3),
    ],
    columns: ["business_name", "phone", "postal_code", "website", "email", "maps_url", "rating", "retrieved_at", "source_record_id"],
    context: "results",
    scope: "filtered",
    query: { ...defaultListQuery(), filters: { has_website: true } },
    meta: { target: "search", query: "hôtel", locationLabel: "Lomé, Togo", kind: "maps_search_link", sourceUrl: "https://www.google.com/maps/search/h%C3%B4tel/@6.14,1.17,12z", provider: "sample" },
    generatedAt,
    rowsMatching: 3,
    rowsRequested: null,
    excludedRowCount: 0,
    rowLimit: 20000,
    fileExpiresAt: new Date(generatedAt.getTime() + 24 * 3600_000),
    linkTtlMinutes: 15,
    ...o,
  });
}

async function readBack(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe("buildXlsx", () => {
  it("writes the three sheets with workbook metadata", async () => {
    const wb = await readBack(await buildXlsx(doc(), { generatedAt, title: "leads-hôtel-lomé-2026-11-14.xlsx" }));
    expect(wb.worksheets.map((w) => w.name)).toEqual([SHEET_NAMES.data, SHEET_NAMES.summary, SHEET_NAMES.quality]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Business Data", "Search Summary", "Data Quality"]);
    expect(wb.creator).toBe("LeadFinder");
  });

  it("freezes the header, adds an autofilter, bold header and fitted widths", async () => {
    const wb = await readBack(await buildXlsx(doc(), { generatedAt }));
    const ws = wb.getWorksheet("Business Data")!;
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    const af = ws.autoFilter as unknown;
    const ref = typeof af === "string" ? af : `${(af as { from: string }).from}:${(af as { to: string }).to}`;
    expect(ref).toBe("A1:I4");
    expect(ws.getRow(1).values).toEqual([
      undefined,
      "Business name",
      "Phone",
      "Postal code",
      "Website",
      "Email",
      "Maps link",
      "Rating",
      "Retrieved",
      "Provider ID",
    ]);
    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getCell("A1").fill).toMatchObject({ type: "pattern", pattern: "solid" });
    for (let c = 1; c <= 9; c++) {
      const w = ws.getColumn(c).width!;
      expect(w).toBeGreaterThanOrEqual(10);
      expect(w).toBeLessThanOrEqual(60);
    }
  });

  it("keeps phones, postal codes and IDs as text and neutralises formulas", async () => {
    const wb = await readBack(await buildXlsx(doc(), { generatedAt }));
    const ws = wb.getWorksheet("Business Data")!;
    expect(ws.getCell("A2").value).toBe("Hôtel Le Bénin");
    expect(ws.getCell("B2").value).toBe("+228 90 12 34 56");
    expect(ws.getCell("B2").type).toBe(ExcelJS.ValueType.String);
    expect(ws.getCell("B2").numFmt).toBe("@");
    expect(ws.getCell("C2").value).toBe("00123");
    expect(ws.getCell("C2").numFmt).toBe("@");
    expect(ws.getCell("I2").value).toBe("sample-1");
    expect(ws.getCell("I2").numFmt).toBe("@");
    expect(ws.getCell("A3").value).toBe("'=HYPERLINK(\"http://evil.example\",\"x\")");
    expect(ws.getCell("A3").type).toBe(ExcelJS.ValueType.String);
    for (const row of [2, 3, 4]) for (let c = 1; c <= 9; c++) expect(ws.getRow(row).getCell(c).formula).toBeUndefined();
    expect(ws.getCell("G2").value).toBe(4.5);
    expect(ws.getCell("H2").value).toEqual(new Date("2026-11-14T09:30:00.000Z"));
    expect(ws.getCell("A4").value).toBeNull(); // Google row: name withheld
    expect(ws.getCell("I4").value).toBe("ChIJplace3");
  });

  it("writes hyperlinks only for valid http(s) and mailto targets", async () => {
    const wb = await readBack(await buildXlsx(doc(), { generatedAt }));
    const ws = wb.getWorksheet("Business Data")!;
    expect(ws.getCell("D2").value).toEqual({ text: "https://biz1.example/", hyperlink: "https://biz1.example/" });
    expect(ws.getCell("E2").value).toEqual({ text: "contact@biz1.example", hyperlink: "mailto:contact@biz1.example" });
    expect(ws.getCell("F2").value).toEqual({ text: "https://maps.google.com/?cid=1", hyperlink: "https://maps.google.com/?cid=1" });
    expect(ws.getCell("D3").value).toBe("javascript:alert(1)");
    expect(ws.getCell("E3").value).toBe("not-an-email");
    expect(ws.getCell("F4").value).toEqual({ text: "https://maps.google.com/?cid=3", hyperlink: "https://maps.google.com/?cid=3" });
  });

  it("fills the Search Summary and Data Quality sheets", async () => {
    const wb = await readBack(await buildXlsx(doc(), { generatedAt }));
    const summary = wb.getWorksheet("Search Summary")!;
    const kv = new Map<string, unknown>();
    summary.eachRow((r) => kv.set(String(r.getCell(1).value), r.getCell(2).value));
    expect(kv.get("Search")).toBe("hôtel");
    expect(kv.get("Location")).toBe("Lomé, Togo");
    expect(kv.get("Search type")).toBe("Google Maps search link");
    expect(kv.get("Data provider")).toBe("Sample data, Google Maps");
    expect(String(kv.get("Attribution"))).toContain("Data from Google Maps");
    expect(kv.get("Rows found")).toBe(3);
    expect(kv.get("Rows exported")).toBe(3);
    expect(kv.get("Filters")).toBe("Has a website");
    expect(kv.get("Emails")).toBe(EMAIL_NOT_VERIFIED_LINE);
    expect(summary.getCell("A1").font?.bold).toBe(true);

    const quality = wb.getWorksheet("Data Quality")!;
    const lines: unknown[][] = [];
    quality.eachRow((r) => lines.push((r.values as unknown[]).slice(1)));
    const flat = lines.map((l) => l.join(" | "));
    expect(flat).toContain("Missing values per column");
    expect(flat).toContain("Business name | 2 | 0 | 1");
    expect(flat).toContain("Probable duplicates | 0");
    expect(flat).toContain("Email verification status");
    expect(flat).toContain("Phone verification status");
    expect(flat).toContain("Phone | 2 | 0 | 1");
    expect(flat).toContain("Website | 2 | 0 | 1");
    expect(flat).toContain("Selected rows no longer available | 0");
  });

  it("sanitises formulas in the summary too (user-typed search text)", async () => {
    const d = doc({ meta: { target: "search", query: "=1+1", locationLabel: "@evil", kind: "keyword", sourceUrl: null, provider: "sample" } });
    const wb = await readBack(await buildXlsx(d, { generatedAt }));
    const summary = wb.getWorksheet("Search Summary")!;
    const kv = new Map<string, unknown>();
    summary.eachRow((r) => kv.set(String(r.getCell(1).value), r.getCell(2).value));
    expect(kv.get("Search")).toBe("'=1+1");
    expect(kv.get("Location")).toBe("'@evil");
  });

  it("writes a valid workbook with no data rows", async () => {
    const wb = await readBack(await buildXlsx(doc({ rows: [], rowsMatching: 0 }), { generatedAt }));
    const ws = wb.getWorksheet("Business Data")!;
    expect(ws.rowCount).toBe(1);
  });
});

describe("helpers", () => {
  it("fits widths between 10 and 60", () => {
    const cols = [exportColumn("business_name"), exportColumn("notes"), exportColumn("rating")];
    expect(fitColumnWidths(cols, [["Hi", "x".repeat(500), 4.5]])).toEqual([15, 60, 10]);
  });
  it("names columns like a spreadsheet", () => {
    expect([1, 9, 26, 27, 52, 703].map(columnLetter)).toEqual(["A", "I", "Z", "AA", "AZ", "AAA"]);
  });
});
