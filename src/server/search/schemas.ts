/**
 * Request schemas for search jobs. Pure (no secrets, no DB) so it can be unit tested directly.
 */
import { z } from "zod";
import { MAX_TARGET_COUNT, SOURCE_IDS } from "@/lib/domain";
import { FIELD_KEYS } from "@/lib/fields";
import { HttpError } from "../errors";

export const MAX_MAPS_URL_LENGTH = 4096;
export const MAX_QUERY_LENGTH = 120;
export const MAX_LOCATION_LENGTH = 160;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

/** "" / whitespace / null are treated as "not given" so optional text fields behave intuitively. */
const blankToUndefined = (v: unknown) => (v === null || (typeof v === "string" && v.trim() === "") ? undefined : v);

const optionalText = (max: number, tooLong: string) =>
  z.preprocess(blankToUndefined, z.string({ error: "Must be text." }).trim().max(max, tooLong).optional());

export const createSearchSchema = z
  .object({
    mapsUrl: optionalText(MAX_MAPS_URL_LENGTH, "That link is too long to be a Google Maps link. Copy it again from the address bar."),
    query: optionalText(MAX_QUERY_LENGTH, `Keep the search term under ${MAX_QUERY_LENGTH} characters.`),
    location: optionalText(MAX_LOCATION_LENGTH, `Keep the location under ${MAX_LOCATION_LENGTH} characters.`),
    targetCount: z
      .number({ error: "Choose how many results you want." })
      .int("The number of results must be a whole number.")
      .min(1, "Ask for at least 1 result.")
      .max(MAX_TARGET_COUNT, `You can ask for at most ${MAX_TARGET_COUNT.toLocaleString("en-US")} results per search.`),
    enrich: z.boolean({ error: "enrich must be true or false." }).default(true),
    /** Validated with validateFilters("results") after parsing. */
    filters: z.unknown().optional(),
    /** Validated with validateSort("results") after parsing. */
    sort: z.unknown().optional(),
    fields: z.array(z.enum(FIELD_KEYS, { error: "Unknown field." })).max(FIELD_KEYS.length).optional(),
    provider: z.enum(SOURCE_IDS, { error: "Unknown data source." }).optional(),
    confirm: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mapsUrl) return;
    if (!v.query && !v.location) {
      ctx.addIssue({ code: "custom", path: ["mapsUrl"], message: "Paste a Google Maps link, or type what you are looking for and where." });
    } else if (!v.query) {
      ctx.addIssue({ code: "custom", path: ["query"], message: "Type what you are looking for, for example “hotel” or “salon de coiffure”." });
    } else if (!v.location) {
      ctx.addIssue({ code: "custom", path: ["location"], message: "Type where to search, for example “Lomé, Togo”." });
    }
  });

export type CreateSearchInput = z.output<typeof createSearchSchema>;

/**
 * Parse a create/estimate body. Throws HttpError("validation_failed") whose message is the first
 * problem in plain language (details lists every issue).
 */
export function parseCreateSearchInput(raw: unknown): CreateSearchInput {
  const parsed = createSearchSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  throw new HttpError("validation_failed", issues[0]?.message ?? "Invalid search request.", issues);
}

/** Read and validate the optional Idempotency-Key header. */
export function idempotencyKeyFrom(headers: Headers): string | null {
  const raw = headers.get("idempotency-key");
  if (raw === null) return null;
  const key = raw.trim();
  if (!key) return null;
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new HttpError("validation_failed", `The Idempotency-Key header must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`);
  }
  return key;
}
