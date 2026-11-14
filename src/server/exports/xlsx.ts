/**
 * XLSX serializer (no secrets, no DB) using exceljs' streaming writer, so large exports do not
 * build a full object model in memory. Sheets, in order: "Business Data", "Search Summary",
 * "Data Quality". Every text cell is sanitised and written as a plain string cell (shared string),
 * never as a formula.
 */
import { Writable } from "node:stream";
import ExcelJS from "exceljs";
import type { ExportDocument } from "./build";
import { cellDisplayText, hyperlinkFor, type ExportCellValue, type ExportColumn } from "./columns";
import { sanitizeCellText } from "./sanitize";

export const SHEET_NAMES = { data: "Business Data", summary: "Search Summary", quality: "Data Quality" } as const;
export const XLSX_CREATOR = "LeadFinder";

const MIN_WIDTH = 10;
const MAX_WIDTH = 60;
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
const HEADER_BORDER: Partial<ExcelJS.Borders> = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true };
const LINK_FONT: Partial<ExcelJS.Font> = { color: { argb: "FF1D4ED8" }, underline: true };
const NOTE_FONT: Partial<ExcelJS.Font> = { italic: true, color: { argb: "FF6B7280" } };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 12 };

const longestLine = (s: string) => s.split("\n").reduce((m, l) => Math.max(m, l.length), 0);

/** Column widths fitted to the header and content, within 10..60 characters. */
export function fitColumnWidths(columns: readonly ExportColumn[], rows: readonly (readonly ExportCellValue[])[]): number[] {
  return columns.map((c, i) => {
    let w = c.header.length;
    for (const row of rows) {
      const v = row[i] ?? null;
      const len = v instanceof Date ? 16 : longestLine(cellDisplayText(v));
      if (len > w) w = len;
      if (w >= MAX_WIDTH) break;
    }
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + 2));
  });
}

/** Spreadsheet column letters for 1-based index (1 → A, 27 → AA). */
export function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

type CellInput = string | number | Date | null | ExcelJS.CellHyperlinkValue;

function cellFor(col: ExportColumn, v: ExportCellValue): CellInput {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  const text = sanitizeCellText(v);
  const href = hyperlinkFor(col.link, v);
  return href ? { text, hyperlink: href } : text;
}

const safe = (v: string | number) => (typeof v === "string" ? sanitizeCellText(v) : v);

function writeBusinessData(wb: ExcelJS.stream.xlsx.WorkbookWriter, doc: ExportDocument) {
  const ws = wb.addWorksheet(SHEET_NAMES.data, {
    views: [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2", activeCell: "A2" }],
  });
  const widths = fitColumnWidths(doc.columns, doc.rows);
  ws.columns = doc.columns.map((c, i) => ({
    key: c.key,
    width: widths[i],
    style: c.forceText ? { numFmt: "@" } : c.numFmt ? { numFmt: c.numFmt } : {},
  }));

  const header = ws.addRow(doc.columns.map((c) => sanitizeCellText(c.header)));
  header.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = HEADER_BORDER;
    cell.alignment = { vertical: "middle" };
  });
  header.commit();

  for (const values of doc.rows) {
    const row = ws.addRow(doc.columns.map((c, i) => cellFor(c, values[i] ?? null)));
    doc.columns.forEach((c, i) => {
      const v = values[i] ?? null;
      if (v == null) return;
      const cell = row.getCell(i + 1);
      if (c.forceText) cell.numFmt = "@";
      else if (c.numFmt) cell.numFmt = c.numFmt;
      if (cell.type === ExcelJS.ValueType.Hyperlink) cell.font = LINK_FONT;
    });
    row.commit();
  }

  if (doc.columns.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: doc.rows.length + 1, column: doc.columns.length } };
  }
  ws.commit();
}

function writeSummary(wb: ExcelJS.stream.xlsx.WorkbookWriter, doc: ExportDocument) {
  const ws = wb.addWorksheet(SHEET_NAMES.summary);
  ws.columns = [
    { key: "item", width: 22 },
    { key: "value", width: 100 },
  ];
  for (const [label, value] of doc.summary) {
    const row = ws.addRow([sanitizeCellText(label), safe(value)]);
    row.getCell(1).font = HEADER_FONT;
    row.getCell(1).alignment = { vertical: "top" };
    row.getCell(2).alignment = { vertical: "top", wrapText: true, horizontal: "left" };
    row.commit();
  }
  ws.commit();
}

function writeQuality(wb: ExcelJS.stream.xlsx.WorkbookWriter, doc: ExportDocument) {
  const ws = wb.addWorksheet(SHEET_NAMES.quality);
  ws.columns = [
    { key: "a", width: 36 },
    { key: "b", width: 16 },
    { key: "c", width: 16 },
    { key: "d", width: 26 },
  ];
  doc.quality.forEach((section, idx) => {
    if (idx > 0) ws.addRow([]).commit();
    const title = ws.addRow([sanitizeCellText(section.title)]);
    title.getCell(1).font = TITLE_FONT;
    title.commit();
    if (section.note) {
      const note = ws.addRow([sanitizeCellText(section.note)]);
      note.getCell(1).font = NOTE_FONT;
      note.commit();
    }
    if (section.header) {
      const h = ws.addRow(section.header.map(sanitizeCellText));
      h.eachCell((cell) => {
        cell.font = HEADER_FONT;
        cell.fill = HEADER_FILL;
        cell.border = HEADER_BORDER;
      });
      h.commit();
    }
    for (const values of section.rows) ws.addRow(values.map(safe)).commit();
  });
  ws.commit();
}

/** Serialize an export document to an .xlsx file in memory. */
export async function buildXlsx(doc: ExportDocument, opts: { generatedAt: Date; title?: string }): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      cb();
    },
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useStyles: true, useSharedStrings: true });
  wb.creator = XLSX_CREATOR;
  wb.lastModifiedBy = XLSX_CREATOR;
  wb.created = opts.generatedAt;
  wb.modified = opts.generatedAt;
  if (opts.title) wb.title = sanitizeCellText(opts.title);

  writeBusinessData(wb, doc);
  writeSummary(wb, doc);
  writeQuality(wb, doc);
  await wb.commit();
  return Buffer.concat(chunks);
}
