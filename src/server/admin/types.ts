/**
 * JSON shapes returned by /api/v1/admin/*. Types only (no runtime code), so client components can
 * `import type` them. Dates are ISO strings.
 */
import type { UserRole, UserStatus } from "@/lib/domain";

export type AdminUserDto = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  /** Latest session activity (null when the user has no session, e.g. never signed in or signed out everywhere). */
  lastActiveAt: string | null;
  /** Billable provider requests since the start of the current UTC month. */
  requestsThisMonth: number;
  /** Admin overrides; null = the global default applies. */
  maxResultsPerSearch: number | null;
  monthlyRequestLimit: number | null;
};

export type AdminLimitDefaults = { maxResultsPerSearch: number; monthlyRequestLimit: number };

export type AdminUsersResponse = {
  users: AdminUserDto[];
  pendingCount: number;
  defaults: AdminLimitDefaults;
};

export type SignupMode = "approval" | "invite" | "closed";

export type InvitationDto = {
  id: string;
  email: string;
  role: UserRole;
  status: "pending" | "accepted";
  invitedBy: { id: string; name: string; email: string } | null;
  createdAt: string;
  acceptedAt: string | null;
};

export type InvitationsResponse = { invitations: InvitationDto[]; signupMode: SignupMode };

export type UsageCell = { requests: number; costUsd: number };

export type UsageRowDto = {
  /** null when the usage belongs to a deleted account. */
  userId: string | null;
  name: string | null;
  email: string | null;
  /** Aligned with `UsageResponse.months`. */
  months: UsageCell[];
  total: UsageCell;
};

export type UsageResponse = {
  /** "YYYY-MM", oldest first, current month last. */
  months: string[];
  rows: UsageRowDto[];
  totals: { months: UsageCell[]; total: UsageCell };
  pricing: { textSearchPer1000: number; placeDetailsPer1000: number };
  sampleMode: boolean;
};

export type AuditEntryDto = {
  id: number;
  createdAt: string;
  actorId: string | null;
  actor: { name: string; email: string } | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: "success" | "denied" | "error";
  metadata: Record<string, unknown>;
  ip: string | null;
};

export type AuditLogResponse = {
  entries: AuditEntryDto[];
  total: number;
  page: number;
  pageSize: number;
  /** Action prefixes that can be used as the `action` filter. */
  prefixes: string[];
};
