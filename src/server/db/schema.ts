import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ExportFormat,
  ExportScope,
  ExportStatus,
  FoundEmail,
  JobProgress,
  JobStatus,
  Language,
  LeadStatus,
  ProposalChannel,
  ProposalTopic,
  QualityStatus,
  SearchKind,
  SearchLocation,
  Socials,
  SourceId,
  UserRole,
  UserStatus,
  VerificationStatus,
  WebsiteCheck,
  WebsiteStatus,
} from "@/lib/domain";
import type { ListQuery } from "@/lib/list-query";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ────────────────────────────── Auth (Better Auth core tables) ────────────────────────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // App-specific (declared as Better Auth additionalFields with input: false).
  role: text("role").$type<UserRole>().notNull().default("member"),
  status: text("status").$type<UserStatus>().notNull().default("pending"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Admin-issued invitations. An invited email becomes active immediately on sign-up. */
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: text("role").$type<UserRole>().notNull().default("member"),
  invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
});

/** Per-user preferences, sender profile for proposals, and limit overrides set by admins. */
export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  senderName: text("sender_name"),
  senderCompany: text("sender_company"),
  senderEmail: text("sender_email"),
  senderPhone: text("sender_phone"),
  senderWebsite: text("sender_website"),
  senderPortfolioUrl: text("sender_portfolio_url"),
  signature: text("signature"),
  defaultLanguage: text("default_language").$type<Language>().notNull().default("en"),
  /** Saved results-grid preferences per context: { results?: GridPrefs, collection?: GridPrefs }. */
  gridPrefs: jsonb("grid_prefs").$type<Record<string, unknown>>().notNull().default({}),
  /** Admin overrides (null = use the global default from env). */
  maxResultsPerSearch: integer("max_results_per_search"),
  monthlyRequestLimit: integer("monthly_request_limit"),
  updatedAt: updatedAt(),
});

/* ─────────────────────────── Business data columns (shared shape) ─────────────────────────── */

/**
 * Columns describing one business. Used by both the transient `search_results` working set and the
 * persisted `businesses` table. Provider fields may be NULL in `businesses` when the source policy
 * forbids storing them (see src/server/providers/policy.ts).
 */
const businessColumns = () => ({
  source: text("source").$type<SourceId>().notNull(),
  sourceRecordId: text("source_record_id").notNull(),

  // ── Provider fields (subject to source policy) ──
  name: text("name"),
  category: text("category"),
  categories: text("categories").array().notNull().default(sql`'{}'::text[]`),
  phoneRaw: text("phone_raw"),
  phoneE164: text("phone_e164"),
  /** Digits only, used for sorting. */
  phoneDigits: text("phone_digits"),
  websiteUrl: text("website_url"),
  /** Lower-case hostname without "www.", used for sorting and domain filters. */
  websiteHost: text("website_host"),
  /** Email supplied directly by the provider (rare). Crawled emails live in `emails`. */
  providerEmail: text("provider_email"),
  address: text("address"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  postalCode: text("postal_code"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  rating: doublePrecision("rating"),
  reviewCount: integer("review_count"),
  mapsUrl: text("maps_url"),
  businessStatus: text("business_status"),
  retrievedAt: ts("retrieved_at").notNull().defaultNow(),

  // ── App-owned enrichment (our own website visit) — always storable ──
  websiteStatus: text("website_status").$type<WebsiteStatus>().notNull().default("unknown"),
  websiteCheck: jsonb("website_check").$type<WebsiteCheck>(),
  emails: jsonb("emails").$type<FoundEmail[]>().notNull().default([]),
  /** Best email: provider email if any, else best crawled email. Lower-cased. */
  primaryEmail: text("primary_email"),
  emailOrigin: text("email_origin").$type<"provider" | "website_crawl">(),
  emailStatus: text("email_status").$type<VerificationStatus>().notNull().default("unknown"),
  phoneStatus: text("phone_status").$type<VerificationStatus>().notNull().default("unknown"),
  socials: jsonb("socials").$type<Socials>().notNull().default({}),
  enrichedAt: ts("enriched_at"),
  lastVerifiedAt: ts("last_verified_at"),

  // ── Derived data quality ──
  qualityStatus: text("quality_status").$type<QualityStatus>().notNull().default("incomplete"),
  qualityIssues: text("quality_issues").array().notNull().default(sql`'{}'::text[]`),

  /** AI-suggested category, always labelled as AI-generated, never overwrites `category`. */
  aiCategory: text("ai_category"),
  aiCategoryConfidence: doublePrecision("ai_category_confidence"),
});

/* ───────────────────────────────────────── Searches ───────────────────────────────────────── */

export const searchJobs = pgTable(
  "search_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<SearchKind>().notNull(),
    query: text("query").notNull(),
    location: jsonb("location").$type<SearchLocation>().notNull(),
    /** Original Google Maps link the user pasted, if any. */
    sourceUrl: text("source_url"),
    provider: text("provider").$type<SourceId>().notNull(),
    targetCount: integer("target_count").notNull(),
    enrich: boolean("enrich").notNull().default(true),
    filters: jsonb("filters").$type<ListQuery["filters"]>().notNull().default({}),
    sort: jsonb("sort").$type<ListQuery["sort"]>().notNull().default([]),
    fields: jsonb("fields").$type<string[]>().notNull().default([]),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    progress: jsonb("progress").$type<JobProgress>().notNull(),
    estimatedRequests: integer("estimated_requests").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    actualRequests: integer("actual_requests").notNull().default(0),
    /** Why the job stopped short of the target, or the failure message. */
    stopReason: text("stop_reason"),
    error: text("error"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    idempotencyKey: text("idempotency_key"),
    queueJobId: text("queue_job_id"),
    /** When the transient result rows are purged (source policy). */
    resultsExpireAt: ts("results_expire_at"),
    resultsPurgedAt: ts("results_purged_at"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("search_jobs_user_created_idx").on(t.userId, t.createdAt),
    uniqueIndex("search_jobs_user_idem_idx").on(t.userId, t.idempotencyKey),
    index("search_jobs_status_updated_idx").on(t.status, t.updatedAt),
    index("search_jobs_results_expiry_idx").on(t.resultsExpireAt).where(sql`${t.resultsPurgedAt} is null`),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => searchJobs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.id)],
);

/**
 * Transient working set: everything a search returned, kept only for the source policy's
 * retention window so the user can sort, filter, review and save leads. Purged automatically.
 */
export const searchResults = pgTable(
  "search_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => searchJobs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Order in which the provider returned it (stable tie-breaker). */
    position: integer("position").notNull(),
    ...businessColumns(),
    duplicateOfId: uuid("duplicate_of_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("search_results_job_source_idx").on(t.jobId, t.source, t.sourceRecordId),
    index("search_results_job_pos_idx").on(t.jobId, t.position),
    index("search_results_job_website_idx").on(t.jobId, t.websiteStatus),
  ],
);

/* ───────────────────────────────────── Collections & leads ───────────────────────────────────── */

/** Persisted business record, holding only what the source policy allows to be stored. */
export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Owner. Records are not shared between users. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...businessColumns(),
    /** Provider fields deliberately not stored because of the source policy. */
    restrictedFields: text("restricted_fields").array().notNull().default(sql`'{}'::text[]`),
    /** Temporary-cache expiry for coordinates (Google allows 30 days). */
    coordsExpireAt: ts("coords_expire_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("businesses_user_source_idx").on(t.userId, t.source, t.sourceRecordId)],
);

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("collections_user_name_idx").on(t.userId, sql`lower(${t.name})`)],
);

/** A business saved into a collection, plus the user's own annotations. */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").$type<LeadStatus>().notNull().default("new"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes").notNull().default(""),
    lastContactedAt: ts("last_contacted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("leads_collection_business_idx").on(t.collectionId, t.businessId),
    index("leads_user_idx").on(t.userId),
    index("leads_tags_idx").using("gin", t.tags),
  ],
);

/* ───────────────────────────────────── Proposals & concepts ───────────────────────────────────── */

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    /** Business name at the time of writing (user-authored message content). */
    businessName: text("business_name"),
    topic: text("topic").$type<ProposalTopic>().notNull(),
    language: text("language").$type<Language>().notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    channel: text("channel").$type<ProposalChannel>(),
    generatedBy: text("generated_by").$type<"template" | "ai">().notNull(),
    sentAt: ts("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [index("proposals_user_idx").on(t.userId, t.createdAt)],
);

export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    /** Snapshot used in the concept copy (user-authored content). */
    businessName: text("business_name").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    generatedBy: text("generated_by").$type<"template" | "ai">().notNull(),
    model: text("model"),
    shareToken: text("share_token").unique(),
    shareEnabled: boolean("share_enabled").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("concepts_user_idx").on(t.userId, t.createdAt)],
);

/* ───────────────────────────────────────── Exports ───────────────────────────────────────── */

export const exportsTable = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    target: text("target").$type<"search" | "collection">().notNull(),
    jobId: uuid("job_id").references(() => searchJobs.id, { onDelete: "set null" }),
    collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "set null" }),
    format: text("format").$type<ExportFormat>().notNull(),
    scope: text("scope").$type<ExportScope>().notNull(),
    columns: jsonb("columns").$type<string[]>().notNull(),
    includeAnnotations: boolean("include_annotations").notNull().default(true),
    /** Filters, sort, search and page used — a snapshot so the export is reproducible. */
    query: jsonb("query").$type<ListQuery>().notNull(),
    rowIds: jsonb("row_ids").$type<string[]>(),
    status: text("status").$type<ExportStatus>().notNull().default("queued"),
    rowCount: integer("row_count"),
    excludedRowCount: integer("excluded_row_count"),
    /** [{ field, reason }] columns withheld because of source policy. */
    excludedFields: jsonb("excluded_fields").$type<{ field: string; reason: string }[]>().notNull().default([]),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    /** SHA-256 of the current short-lived download token. */
    downloadTokenHash: text("download_token_hash"),
    downloadTokenExpiresAt: ts("download_token_expires_at"),
    /** When the generated file is deleted. */
    expiresAt: ts("expires_at"),
    idempotencyKey: text("idempotency_key"),
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("exports_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("exports_user_idem_idx").on(t.userId, t.idempotencyKey),
  ],
);

/* ───────────────────────────────────── Usage, audit, limits ───────────────────────────────────── */

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    /** e.g. text_search, place_details, geocode, website_crawl, ai_proposal, ai_concept */
    operation: text("operation").notNull(),
    requestCount: integer("request_count").notNull().default(1),
    /** Billable to the provider account (sample mode and our own crawler are not). */
    billable: boolean("billable").notNull().default(false),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    jobId: uuid("job_id"),
    createdAt: createdAt(),
  },
  (t) => [index("usage_logs_user_created_idx").on(t.userId, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    outcome: text("outcome").$type<"success" | "denied" | "error">().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_action_created_idx").on(t.action, t.createdAt),
  ],
);

/** Fixed-window request counters for API rate limiting. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull().default(0),
});

export type User = typeof user.$inferSelect;
export type SearchJob = typeof searchJobs.$inferSelect;
export type SearchResult = typeof searchResults.$inferSelect;
export type NewSearchResult = typeof searchResults.$inferInsert;
export type Business = typeof businesses.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type Concept = typeof concepts.$inferSelect;
export type ExportRecord = typeof exportsTable.$inferSelect;
