/**
 * Shared domain vocabulary (isomorphic: safe for client and server).
 * Changing a value here is a contract change — the DB schema, API and UI all rely on it.
 */

export const SOURCE_IDS = ["google_places", "sample"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/** Result-count presets offered in the search form ("capacity"). */
export const TARGET_COUNT_PRESETS = [20, 40, 60, 100, 500, 1000, 2000, 5000, 10000, 20000] as const;
export const MAX_TARGET_COUNT = 20000;

export const SEARCH_KINDS = ["keyword", "maps_search_link", "maps_place_link"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const JOB_STATUSES = ["queued", "searching", "enriching", "completed", "partial", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["queued", "searching", "enriching"];
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["completed", "partial", "failed", "cancelled"];

/** Website presence, determined by the provider listing plus our own reachability check. */
export const WEBSITE_STATUSES = ["none", "present", "unreachable", "unknown"] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

/**
 * Verification state for email / phone.
 * - unknown:          nothing known
 * - source_provided:  supplied by the data provider or found published on the business's own website — NOT verified
 * - verified:         only after a defined verification process actually completed (none is implemented yet)
 * - invalid:          a check proved it unusable (e.g. malformed)
 * - needs_review:     a check raised doubt (e.g. email domain has no mail server)
 */
export const VERIFICATION_STATUSES = ["unknown", "source_provided", "verified", "invalid", "needs_review"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const QUALITY_STATUSES = ["complete", "incomplete", "needs_review", "duplicate_candidate"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

/** Lead workflow, in order. "not_a_fit" is terminal and sorts last. */
export const LEAD_STATUSES = ["new", "contacted", "proposal_sent", "replied", "qualified", "won", "not_a_fit"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  proposal_sent: "Proposal sent",
  replied: "Replied",
  qualified: "Qualified",
  won: "Won",
  not_a_fit: "Not a fit",
};

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_STATUSES = ["pending", "active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const EXPORT_FORMATS = ["xlsx", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_SCOPES = ["selected", "page", "filtered"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];
export const EXPORT_STATUSES = ["queued", "running", "ready", "failed", "expired"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const PROPOSAL_TOPICS = ["new_website", "website_redesign", "local_seo", "social_media", "branding", "custom"] as const;
export type ProposalTopic = (typeof PROPOSAL_TOPICS)[number];
export const PROPOSAL_TOPIC_LABELS: Record<ProposalTopic, string> = {
  new_website: "New website",
  website_redesign: "Website redesign",
  local_seo: "Local Google ranking",
  social_media: "Social media",
  branding: "Branding",
  custom: "My own service",
};
export const LANGUAGES = ["en", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];
export const PROPOSAL_CHANNELS = ["email", "whatsapp", "copy"] as const;
export type ProposalChannel = (typeof PROPOSAL_CHANNELS)[number];

export type LatLng = { lat: number; lng: number };
/** Axis-aligned map rectangle: low = south-west corner, high = north-east corner. */
export type Rect = { low: LatLng; high: LatLng };

export type SearchLocation = {
  /** Human label, e.g. "Lomé, Togo" or "Map area around 6.1434, 1.1658". */
  label: string;
  city?: string;
  country?: string;
  center?: LatLng;
  /** Area to cover. Present for map links; resolved by geocoding for keyword searches. */
  viewport?: Rect;
};

export type FoundEmail = {
  email: string;
  /** Page the address was published on (website crawl) or "provider". */
  sourceUrl: string;
  sameDomain: boolean;
};

export type Socials = Partial<
  Record<"facebook" | "instagram" | "linkedin" | "x" | "tiktok" | "youtube" | "whatsapp", string>
>;

/** Result of our own visit to the business website (app-owned enrichment data). */
export type WebsiteCheck = {
  status: "ok" | "unreachable" | "blocked_by_robots" | "error" | "skipped";
  /** URL our crawler actually fetched after redirects. */
  finalUrl?: string;
  httpStatus?: number;
  https?: boolean;
  /** Has a responsive viewport meta tag (rough mobile-friendliness signal). */
  mobileViewport?: boolean;
  title?: string;
  /** Latest "© YEAR" found in the page, a rough freshness signal. */
  copyrightYear?: number;
  loadMs?: number;
  pagesVisited?: number;
  error?: string;
  checkedAt: string;
};

export type JobProgress = {
  phase: "queued" | "planning" | "searching" | "enriching" | "finalizing" | "done";
  found: number;
  unique: number;
  requests: number;
  tilesDone: number;
  tilesTotal: number;
  enriched: number;
  enrichTotal: number;
  message?: string;
};

export const emptyProgress = (): JobProgress => ({
  phase: "queued",
  found: 0,
  unique: 0,
  requests: 0,
  tilesDone: 0,
  tilesTotal: 0,
  enriched: 0,
  enrichTotal: 0,
});
