/**
 * JSON shapes returned by /api/v1. Isomorphic. Dates are ISO strings.
 */
import type {
  ExportFormat,
  ExportScope,
  ExportStatus,
  FoundEmail,
  JobProgress,
  JobStatus,
  Language,
  LeadStatus,
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
} from "./domain";
import type { FieldKey } from "./fields";
import type { ListQuery } from "./list-query";

export type ApiError = {
  error: {
    code:
      | "bad_request"
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "conflict"
      | "validation_failed"
      | "rate_limited"
      | "quota_exceeded"
      | "confirmation_required"
      | "provider_error"
      | "internal";
    message: string;
    details?: unknown;
  };
};

/** One business as shown in a grid (search results or collection leads). */
export type BusinessRow = {
  /** search_results.id in the results grid; leads.id in a collection grid. */
  id: string;
  /** businesses.id (collection grid only). */
  businessId?: string;
  source: SourceId;
  sourceRecordId: string;
  name: string | null;
  category: string | null;
  categories: string[];
  /** Display phone (international format when parseable, else as provided). */
  phone: string | null;
  phoneE164: string | null;
  phoneStatus: VerificationStatus;
  website: string | null;
  websiteHost: string | null;
  websiteStatus: WebsiteStatus;
  websiteCheck: WebsiteCheck | null;
  email: string | null;
  emails: FoundEmail[];
  emailOrigin: "provider" | "website_crawl" | null;
  emailStatus: VerificationStatus;
  socials: Socials;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string | null;
  businessStatus: string | null;
  qualityStatus: QualityStatus;
  qualityIssues: string[];
  duplicateOfId: string | null;
  aiCategory: string | null;
  retrievedAt: string;
  enrichedAt: string | null;
  lastVerifiedAt: string | null;
  /** Provider fields withheld because the source policy forbids storing them. */
  restrictedFields: FieldKey[];
  /** Provider fields loaded live from the provider for this view only (not stored). */
  liveFields: FieldKey[];
  lead?: {
    collectionId: string;
    status: LeadStatus;
    tags: string[];
    notes: string;
    lastContactedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

export type SourcePolicyInfo = {
  source: SourceId;
  label: string;
  attribution: string | null;
  isSample: boolean;
  /** Fields that cannot be exported for this source. */
  nonExportableFields: FieldKey[];
  /** Fields that are not kept when saving to a collection. */
  nonPersistableFields: FieldKey[];
  resultsRetentionHours: number;
};

export type Facet = { value: string; count: number };

export type ListResponse<Row = BusinessRow> = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  query: ListQuery;
  facets: { categories: Facet[]; cities: Facet[]; websiteStatus: Facet[]; tags?: Facet[]; leadStatus?: Facet[] };
  policies: SourcePolicyInfo[];
  /** Collections: some restricted details weren't loaded live because the monthly request limit is reached. */
  liveDetailsLimited?: boolean;
};

export type CostEstimate = {
  provider: SourceId;
  isSample: boolean;
  estimatedRequests: number;
  maxRequests: number;
  estimatedCostUsd: number;
  freeMonthlyRequests: number | null;
  requiresConfirmation: boolean;
  notes: string[];
};

export type SearchJobDto = {
  id: string;
  kind: SearchKind;
  query: string;
  location: SearchLocation;
  sourceUrl: string | null;
  provider: SourceId;
  targetCount: number;
  enrich: boolean;
  status: JobStatus;
  progress: JobProgress;
  estimatedRequests: number;
  estimatedCostUsd: number;
  actualRequests: number;
  stopReason: string | null;
  error: string | null;
  resultsExpireAt: string | null;
  resultsPurged: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  counts?: { total: number; withWebsite: number; withoutWebsite: number; withEmail: number; withPhone: number };
};

export type ParsedMapsLinkDto =
  | {
      kind: "search";
      query: string;
      location: SearchLocation;
      resolvedUrl: string;
    }
  | {
      kind: "place";
      name: string;
      location: SearchLocation;
      resolvedUrl: string;
    }
  | {
      kind: "map_view";
      location: SearchLocation;
      resolvedUrl: string;
    };

export type CollectionDto = {
  id: string;
  name: string;
  description: string | null;
  leadCount: number;
  statusCounts: Partial<Record<LeadStatus, number>>;
  createdAt: string;
  updatedAt: string;
};

export type ExportDto = {
  id: string;
  target: "search" | "collection";
  jobId: string | null;
  collectionId: string | null;
  format: ExportFormat;
  scope: ExportScope;
  columns: FieldKey[];
  status: ExportStatus;
  rowCount: number | null;
  excludedRowCount: number | null;
  /** Columns withheld for some rows by source policy; `rows` = how many rows had that cell left empty. */
  excludedFields: { field: string; reason: string; rows?: number }[];
  fileName: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  /** Present when status = ready: a short-lived, single-user download URL. */
  downloadUrl?: string;
};

export type SenderProfile = {
  senderName: string | null;
  senderCompany: string | null;
  senderEmail: string | null;
  senderPhone: string | null;
  senderWebsite: string | null;
  senderPortfolioUrl: string | null;
  signature: string | null;
  defaultLanguage: Language;
};

export type ProposalDraft = {
  subject: string;
  body: string;
  topic: ProposalTopic;
  language: Language;
  generatedBy: "template" | "ai";
  /** Facts about the business the draft used (so the user can check nothing was invented). */
  factsUsed: Record<string, string | number | null>;
  /** Contact options available for this business. */
  channels: { email: string | null; whatsappNumber: string | null };
  warnings: string[];
};

export type MeDto = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
};

/** GET /api/v1/me — the signed-in user plus their limits and what this server offers. */
export type MeResponse = MeDto & {
  limits: {
    maxResultsPerSearch: number;
    /** Billable provider requests per calendar month (UTC). 0 = unlimited. */
    monthlyRequestLimit: number;
    /** Billable provider requests used since the 1st of this month (UTC). */
    usedThisMonth: number;
    /** Searches that may run at the same time. 0 = unlimited. */
    maxConcurrentJobs: number;
  };
  /** No Google key configured: searches use generated sample data. */
  sampleMode: boolean;
  aiAvailable: boolean;
  providers: { id: SourceId; label: string; isSample: boolean }[];
};
