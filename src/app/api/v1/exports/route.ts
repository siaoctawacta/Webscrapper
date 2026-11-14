import { z } from "zod";
import { json, readJson, withUser } from "@/server/http";
import { createExport, listExports } from "@/server/exports";

/** GET /api/v1/exports → { exports: ExportDto[] } (50 most recent; open one to get a download link) */
export const GET = withUser(async (_req, { user }) => {
  return json({ exports: await listExports(user) });
});

/**
 * POST /api/v1/exports { target, jobId?, collectionId?, format, scope, columns, includeAnnotations?, query, rowIds? }
 * → 201 ExportDto (generated right away: status "ready" with downloadUrl, or "failed" with error)
 * → 202 ExportDto (large export queued: poll GET /api/v1/exports/{id})
 * Honours the Idempotency-Key header. Validation errors → 422.
 */
export const POST = withUser(async (req, { user, ip }) => {
  const body = await readJson(req, z.unknown());
  const dto = await createExport(user, body, { idempotencyKey: req.headers.get("idempotency-key"), ip });
  return json(dto, dto.status === "queued" || dto.status === "running" ? 202 : 201);
});
