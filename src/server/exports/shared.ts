import "server-only";
import type { ExportDto } from "@/lib/api-types";
import { isFieldKey, type FieldKey } from "@/lib/fields";
import type { ExportRecord } from "../db/schema";
import type { RowSource } from "./row-source";

/** Generated files are deleted this long after they are created. */
export const FILE_RETENTION_HOURS = 24;

export const RESULTS_EXPIRED_MESSAGE =
  "These search results have expired and can no longer be exported. Run the search again, or export a collection you saved them to.";
export const LINK_EXPIRED_MESSAGE = "This download link has expired. Open the export again to get a new link.";
export const FILE_EXPIRED_MESSAGE = "This export has expired. Create a new export to download the data again.";
export const GENERIC_FAILURE_MESSAGE = "The export could not be created because of an unexpected error. Please try again.";

/** Injectable dependencies (tests pass fakes; production uses the defaults). */
export type ExportDeps = {
  rowSource?: RowSource;
  now?: () => Date;
  /** Queue a background export; defaults to pg-boss "export.run". */
  enqueue?: (exportId: string) => Promise<unknown>;
  /** Exports up to this many rows are generated during the request. */
  inlineRowLimit?: number;
};

/** A failure whose message is safe and useful to show to the user. */
export class ExportFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportFailure";
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** A ready export whose file is past its expiry is reported as expired, even before cleanup runs. */
export function effectiveStatus(rec: Pick<ExportRecord, "status" | "expiresAt">, now: Date): ExportRecord["status"] {
  return rec.status === "ready" && rec.expiresAt && rec.expiresAt.getTime() <= now.getTime() ? "expired" : rec.status;
}

export function toExportDto(rec: ExportRecord, now: Date, downloadUrl?: string): ExportDto {
  const status = effectiveStatus(rec, now);
  return {
    id: rec.id,
    target: rec.target,
    jobId: rec.jobId,
    collectionId: rec.collectionId,
    format: rec.format,
    scope: rec.scope,
    columns: rec.columns.filter(isFieldKey) as FieldKey[],
    status,
    rowCount: rec.rowCount,
    excludedRowCount: rec.excludedRowCount,
    excludedFields: (rec.excludedFields ?? []).map((e) => {
      const rows = (e as { rows?: unknown }).rows;
      return typeof rows === "number" ? { field: e.field, reason: e.reason, rows } : { field: e.field, reason: e.reason };
    }),
    fileName: rec.fileName,
    error: rec.error,
    createdAt: rec.createdAt.toISOString(),
    finishedAt: iso(rec.finishedAt),
    expiresAt: iso(rec.expiresAt),
    ...(status === "ready" && downloadUrl ? { downloadUrl } : {}),
  };
}
