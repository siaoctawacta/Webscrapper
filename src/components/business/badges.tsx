"use client";
/**
 * Status badges and provenance markers for business data.
 * Wording comes from ./labels so the grid, sheet and filters say the same thing.
 */
import * as React from "react";
import { Bot, Database, Globe, Loader2, Lock, MapPin, Radio, User, FlaskConical } from "lucide-react";
import type { SourcePolicyInfo } from "@/lib/api-types";
import { LEAD_STATUS_LABELS, type LeadStatus, type QualityStatus, type SourceId, type VerificationStatus, type WebsiteStatus } from "@/lib/domain";
import { cn, formatDate, formatRelative } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  EMAIL_STATUS_HELP,
  PHONE_STATUS_HELP,
  QUALITY_HELP,
  QUALITY_LABELS,
  VERIFICATION_LABELS,
  WEBSITE_STATUS_HELP,
  WEBSITE_STATUS_LABELS,
} from "./labels";
import { liveMessage, restrictedMessage, safeHttpUrl, shortUrl, sourceLabel } from "./row-utils";

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

/** "No website" is the sales opportunity, so it gets the accent colour. */
export function WebsiteStatusBadge({ status, checking, className }: { status: WebsiteStatus; checking?: boolean; className?: string }) {
  const variant: BadgeVariant = { none: "accent", present: "default", unreachable: "warning", unknown: "outline" }[status] as BadgeVariant;
  const label = status === "unknown" && checking ? "Checking…" : WEBSITE_STATUS_LABELS[status];
  const help = status === "unknown" && checking ? "We're visiting this website now." : WEBSITE_STATUS_HELP[status];
  return (
    <Tooltip content={help}>
      <Badge variant={variant} className={className} aria-label={`${label}. ${help}`}>
        {status === "unknown" && checking && <Loader2 className="animate-spin" aria-hidden />}
        {label}
      </Badge>
    </Tooltip>
  );
}

const VERIFICATION_VARIANT: Record<VerificationStatus, BadgeVariant> = {
  unknown: "outline",
  source_provided: "default",
  verified: "success",
  invalid: "danger",
  needs_review: "warning",
};

/** Email or phone verification state. Shows "—" when there is no value at all. */
export function VerificationBadge({
  status,
  kind,
  hasValue = true,
  className,
}: {
  status: VerificationStatus;
  kind: "email" | "phone";
  hasValue?: boolean;
  className?: string;
}) {
  if (!hasValue && status === "unknown") return <span className="text-muted-foreground/70">—</span>;
  const help = (kind === "email" ? EMAIL_STATUS_HELP : PHONE_STATUS_HELP)[status];
  const label = VERIFICATION_LABELS[status];
  return (
    <Tooltip content={help}>
      <Badge variant={VERIFICATION_VARIANT[status]} className={className} aria-label={`${label}. ${help}`}>
        {label}
      </Badge>
    </Tooltip>
  );
}

export function EmailStatusBadge(props: { status: VerificationStatus; hasValue?: boolean; className?: string }) {
  return <VerificationBadge kind="email" {...props} />;
}

export function PhoneStatusBadge(props: { status: VerificationStatus; hasValue?: boolean; className?: string }) {
  return <VerificationBadge kind="phone" {...props} />;
}

const QUALITY_VARIANT: Record<QualityStatus, BadgeVariant> = {
  complete: "success",
  incomplete: "default",
  needs_review: "warning",
  duplicate_candidate: "warning",
};

export function QualityBadge({ status, className }: { status: QualityStatus; className?: string }) {
  return (
    <Tooltip content={QUALITY_HELP[status]}>
      <Badge variant={QUALITY_VARIANT[status]} className={className} aria-label={`${QUALITY_LABELS[status]}. ${QUALITY_HELP[status]}`}>
        {QUALITY_LABELS[status]}
      </Badge>
    </Tooltip>
  );
}

const LEAD_DOT: Record<LeadStatus, string> = {
  new: "bg-muted-foreground/60",
  contacted: "bg-accent/60",
  proposal_sent: "bg-accent",
  replied: "bg-warning",
  qualified: "bg-success/70",
  won: "bg-success",
  not_a_fit: "bg-destructive/70",
};

export function LeadStatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium leading-4",
        status === "not_a_fit" && "text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", LEAD_DOT[status])} aria-hidden />
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}

export function SourceBadge({ source, policies, className }: { source: SourceId; policies?: SourcePolicyInfo[]; className?: string }) {
  const sample = source === "sample";
  return (
    <Tooltip content={sample ? "Generated sample data — not a real business." : `Listing data from ${sourceLabel(source, policies)}.`}>
      <Badge variant={sample ? "warning" : "outline"} className={className}>
        {sample ? <FlaskConical aria-hidden /> : <MapPin aria-hidden />}
        {sample ? "Sample" : sourceLabel(source, policies)}
      </Badge>
    </Tooltip>
  );
}

/** Muted "Not stored" pill for a value the source policy doesn't allow us to keep. */
export function RestrictedValue({
  source,
  policies,
  compact,
  className,
}: {
  source: SourceId;
  policies?: SourcePolicyInfo[];
  /** Without the lock icon, for narrow columns. */
  compact?: boolean;
  className?: string;
}) {
  const msg = restrictedMessage(source, policies);
  return (
    <Tooltip content={msg}>
      <span
        aria-label={`Not stored. ${msg}`}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-muted py-0.5 text-[11px] font-medium text-muted-foreground",
          compact ? "px-1.5" : "px-2",
          className,
        )}
      >
        {!compact && <Lock className="size-3" aria-hidden />}
        Not stored
      </span>
    </Tooltip>
  );
}

/** Tiny marker for a value loaded live from the provider for this view only. */
export function LiveIndicator({ source, policies, className }: { source: SourceId; policies?: SourcePolicyInfo[]; className?: string }) {
  const msg = liveMessage(source, policies);
  return (
    <Tooltip content={msg}>
      <span aria-label={msg} className={cn("inline-flex shrink-0 items-center gap-0.5 rounded bg-accent-soft px-1 text-[10px] font-medium leading-4 text-accent-soft-foreground", className)}>
        <Radio className="size-2.5" aria-hidden />
        live
      </span>
    </Tooltip>
  );
}

export type ProvenanceOrigin = "provider" | "website" | "derived" | "user" | "live" | "ai";

const PROVENANCE_ICON: Record<ProvenanceOrigin, React.ComponentType<{ className?: string }>> = {
  provider: Database,
  website: Globe,
  derived: Database,
  user: User,
  live: Radio,
  ai: Bot,
};

function provenanceText(origin: ProvenanceOrigin, sourceLabelText: string, url?: string | null): string {
  switch (origin) {
    case "provider":
      return `From ${sourceLabelText}`;
    case "website":
      return url && url !== "provider" ? `Found on ${shortUrl(url)}` : "Found on the business's website";
    case "derived":
      return "Worked out by LeadFinder";
    case "user":
      return "Added by you";
    case "live":
      return `Loaded live from ${sourceLabelText} — not stored`;
    case "ai":
      return "AI suggestion — may be wrong";
  }
}

/**
 * Where a value came from, e.g. "Found on hotel.example/contact · 2 days ago".
 * `compact` renders only the icon, with the text in a tooltip (for dense grid cells).
 */
export function ProvenanceTag({
  origin,
  sourceLabel: label = "the data provider",
  url,
  at,
  compact,
  className,
}: {
  origin: ProvenanceOrigin;
  sourceLabel?: string;
  url?: string | null;
  at?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const Icon = PROVENANCE_ICON[origin];
  const text = provenanceText(origin, label, url);
  const when = at ? formatRelative(at) : null;
  const full = when ? `${text} · ${when}` : text;
  const href = origin === "website" ? safeHttpUrl(url) : null;
  if (compact) {
    return (
      <Tooltip content={full}>
        <span aria-label={full} className={cn("inline-flex shrink-0 text-muted-foreground/80", className)}>
          <Icon className="size-3.5" aria-hidden />
        </span>
      </Tooltip>
    );
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground", className)}>
      <Icon className="size-3 shrink-0" aria-hidden />
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="truncate underline-offset-2 hover:text-foreground hover:underline">
          {text}
        </a>
      ) : (
        <span className="truncate">{text}</span>
      )}
      {when && (
        <span className="shrink-0" title={at ? formatDate(at, { dateStyle: "medium", timeStyle: "short" }) : undefined}>
          · {when}
        </span>
      )}
    </span>
  );
}
