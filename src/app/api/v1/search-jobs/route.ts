import { json, readJson, withUser } from "@/server/http";
import { createSearchJob, idempotencyKeyFrom, listSearchJobs, parseJobsPage } from "@/server/search";
import { z } from "zod";

const anyBody = z.unknown();

/**
 * POST /api/v1/search-jobs { mapsUrl?, query?, location?, targetCount, enrich?, filters?, sort?, fields?, provider?, confirm? }
 * → 201 SearchJobDto (200 with the existing job when the Idempotency-Key was already used)
 * · 409 confirmation_required (details.estimate) · 422 validation_failed · 429 quota_exceeded / rate_limited
 */
export const POST = withUser(async (req, { user, ip }) => {
  const idempotencyKey = idempotencyKeyFrom(req.headers);
  const body = await readJson(req, anyBody);
  const { job, created } = await createSearchJob(user, body, { idempotencyKey, ip });
  return json(job, created ? 201 : 200);
});

/** GET /api/v1/search-jobs?page → { jobs: SearchJobDto[] (with counts, newest first, 20 per page), total, page, pageSize } */
export const GET = withUser(async (req, { user }) => {
  const page = parseJobsPage(req.nextUrl.searchParams.get("page"));
  return json(await listSearchJobs(user, page));
});
