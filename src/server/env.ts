import "server-only";
import { z } from "zod";

/**
 * Server-side configuration. Never import this from client components.
 * Every value has a safe default so the app boots in "Sample data mode" with no secrets.
 */
const placeholder = (v: string | undefined) => (v && !v.startsWith("<") ? v : undefined);

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().finite().nonnegative());

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("postgres://leadfinder:leadfinder@localhost:5432/leadfinder"),
  BETTER_AUTH_SECRET: z.string().optional(),

  SIGNUP_MODE: z.enum(["approval", "invite", "closed"]).default("approval"),
  ADMIN_EMAILS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),

  GOOGLE_MAPS_API_KEY: z.string().optional().transform(placeholder),
  GOOGLE_TEXT_SEARCH_PRICE_PER_1000: num(35),
  GOOGLE_PLACE_DETAILS_PRICE_PER_1000: num(20),
  GOOGLE_RESULTS_RETENTION_HOURS: num(24),

  AI_GATEWAY_API_KEY: z.string().optional().transform(placeholder),
  AI_MODEL: z.string().default("anthropic/claude-sonnet-5.5"),
  AI_DAILY_LIMIT_PER_USER: num(50),

  MAX_RESULTS_PER_SEARCH: num(20000),
  MAX_SEARCH_JOBS_PER_USER_PER_DAY: num(50),
  MAX_CONCURRENT_JOBS_PER_USER: num(2),
  MAX_CONCURRENT_JOBS: num(4),
  COST_CONFIRM_THRESHOLD_USD: num(5),
  MONTHLY_PROVIDER_REQUEST_LIMIT_PER_USER: num(5000),

  CRAWL_CONCURRENCY: num(8),
  CRAWL_TIMEOUT_MS: num(10000),
  CRAWL_MAX_PAGES_PER_SITE: num(3),

  EXPORT_STORAGE_DIR: z.string().default("./storage/exports"),
  EXPORT_LINK_TTL_MINUTES: num(15),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
    }
    if (parsed.data.APP_ENV === "production" && !parsed.data.BETTER_AUTH_SECRET) {
      throw new Error("BETTER_AUTH_SECRET must be set in production");
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test helper: forget cached config so tests can change process.env. */
export function resetEnvCache() {
  cached = undefined;
}

export const isSampleMode = () => !env().GOOGLE_MAPS_API_KEY;
export const isAiConfigured = () => Boolean(env().AI_GATEWAY_API_KEY);
