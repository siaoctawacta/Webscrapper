"use client";
/**
 * Grid cell renderers per field. `renderBusinessCell(key, row, ctx)` returns the content for one
 * cell; restricted values ("Not stored") and live-loaded markers are handled here for every field.
 */
import * as React from "react";
import { Ban, Copy, ExternalLink, MapPin, Star } from "lucide-react";
import type { BusinessRow, SourcePolicyInfo } from "@/lib/api-types";
import type { FieldContext, FieldKey } from "@/lib/fields";
import { cn, formatDate, formatNumber, formatRelative } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  EmailStatusBadge,
  LeadStatusBadge,
  LiveIndicator,
  PhoneStatusBadge,
  ProvenanceTag,
  QualityBadge,
  RestrictedValue,
  SourceBadge,
  WebsiteStatusBadge,
} from "./badges";
import { CopyButton } from "./copy-button";
import { businessStatusLabel } from "./labels";
import { SocialLinks } from "./socials";
import { displayHost, isLive, isPlausibleEmail, isRestricted, primaryEmailSource, safeHttpUrl, sourceLabel } from "./row-utils";

export type CellRenderContext = {
  context: FieldContext;
  policies?: SourcePolicyInfo[];
  /** True while the search job is still visiting websites (unknown website status → "Checking…"). */
  enrichmentInProgress?: boolean;
  /** When set, the business name renders as a button that opens the details. */
  onOpen?: (row: BusinessRow) => void;
};

/** Default column widths in px (the grid uses a fixed table layout). */
export const COLUMN_WIDTHS: Record<FieldKey, number> = {
  business_name: 260,
  category: 160,
  phone: 170,
  website: 190,
  website_status: 130,
  email: 240,
  email_status: 130,
  address: 260,
  city: 130,
  region: 140,
  country: 120,
  postal_code: 110,
  rating: 100,
  review_count: 104,
  maps_url: 96,
  latitude: 110,
  longitude: 110,
  socials: 150,
  business_status: 150,
  quality_status: 140,
  phone_status: 130,
  source: 130,
  source_record_id: 200,
  retrieved_at: 120,
  last_verified: 120,
  lead_status: 150,
  tags: 210,
  notes: 260,
  last_contacted: 130,
  added_at: 120,
};

export const NUMERIC_COLUMNS: ReadonlySet<FieldKey> = new Set<FieldKey>(["rating", "review_count", "latitude", "longitude"]);

const Muted = ({ children = "—" }: { children?: React.ReactNode }) => <span className="text-muted-foreground/70">{children}</span>;

function TextValue({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value?.trim()) return <Muted />;
  return (
    <span className={cn("block truncate", className)} title={value}>
      {value}
    </span>
  );
}

function DateValue({ iso, emptyLabel = "—" }: { iso: string | null | undefined; emptyLabel?: string }) {
  if (!iso) return <Muted>{emptyLabel}</Muted>;
  return (
    <time dateTime={iso} title={formatDate(iso, { dateStyle: "medium", timeStyle: "short" })} className="tabular whitespace-nowrap">
      {formatRelative(iso)}
    </time>
  );
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export function NameCell({ row, ctx }: { row: BusinessRow; ctx: CellRenderContext }) {
  const closed = row.businessStatus === "CLOSED_PERMANENTLY" || row.businessStatus === "CLOSED_TEMPORARILY";
  const duplicate = row.qualityStatus === "duplicate_candidate";
  const live = isLive(row, "business_name");
  const name = row.name?.trim() || null;
  // The name keeps priority; markers get the rest of the cell and, in narrow name columns, collapse
  // to their icons (container query on the cell).
  const markers = Number(duplicate) + Number(closed) + Number(live);
  const nameClass = cn("min-w-0 truncate font-medium", markers > 0 && "shrink-0 max-w-[72%]");
  const marker = "min-w-6 shrink px-1.5 text-[10px] [&_svg]:shrink-0";
  // With several markers, show icons only (tooltips/aria-labels carry the words).
  const markerText = cn("truncate @max-[11rem]/name:hidden", markers > 1 && "hidden");
  return (
    <span className="@container/name flex w-full min-w-0 items-center gap-1.5">
      {name ? (
        ctx.onOpen ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ctx.onOpen?.(row);
            }}
            title={name}
            className={cn(nameClass, "rounded-sm text-left outline-none underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40")}
          >
            {name}
          </button>
        ) : (
          <span className={nameClass} title={name}>
            {name}
          </span>
        )
      ) : isRestricted(row, "business_name") ? (
        <RestrictedValue source={row.source} policies={ctx.policies} />
      ) : (
        <Muted>Unnamed business</Muted>
      )}
      {live && <LiveIndicator source={row.source} policies={ctx.policies} />}
      {duplicate && (
        <Tooltip content="Possible duplicate: looks like another result (same phone, website, or a very similar name nearby). Nothing was merged.">
          <Badge variant="warning" className={marker} aria-label="Possible duplicate">
            <Copy aria-hidden />
            <span className={markerText}>Duplicate?</span>
          </Badge>
        </Tooltip>
      )}
      {closed && (
        <Tooltip content={`${businessStatusLabel(row.businessStatus)} (as listed by ${sourceLabel(row.source, ctx.policies)}).`}>
          <Badge variant="danger" className={marker} aria-label={businessStatusLabel(row.businessStatus) ?? "Closed"}>
            <Ban aria-hidden />
            <span className={markerText}>Closed</span>
          </Badge>
        </Tooltip>
      )}
    </span>
  );
}

function PhoneCell({ row }: { row: BusinessRow }) {
  if (!row.phone) return <Muted />;
  return (
    <span className="group flex min-w-0 items-center gap-1">
      <span className="tabular truncate" title={row.phone}>
        {row.phone}
      </span>
      <CopyButton value={row.phoneE164 ?? row.phone} label="Phone number" reveal />
    </span>
  );
}

function WebsiteCell({ row }: { row: BusinessRow }) {
  if (!row.website) return <Muted />;
  const href = safeHttpUrl(row.website);
  const host = displayHost(row.website, row.websiteHost) ?? row.website;
  const unreachable = row.websiteStatus === "unreachable";
  const content = (
    <>
      {unreachable && (
        <Tooltip content="Our visit couldn't reach this website.">
          <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="Website unreachable" role="img" />
        </Tooltip>
      )}
      <span className="truncate">{host}</span>
    </>
  );
  if (!href) return <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">{content}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={stop}
        title={row.website}
        className="flex min-w-0 items-center gap-1.5 rounded-sm text-foreground outline-none underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {content}
        <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </span>
  );
}

function EmailCell({ row, ctx }: { row: BusinessRow; ctx: CellRenderContext }) {
  if (!row.email) return <Muted />;
  const found = primaryEmailSource(row);
  const fromWebsite = row.emailOrigin === "website_crawl";
  const extra = Math.max(0, row.emails.length - 1);
  return (
    <span className="group flex min-w-0 items-center gap-1.5">
      {isPlausibleEmail(row.email) ? (
        <a
          href={`mailto:${row.email}`}
          onClick={stop}
          title={row.email}
          className="min-w-0 truncate rounded-sm outline-none underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {row.email}
        </a>
      ) : (
        <span className="min-w-0 truncate" title={row.email}>
          {row.email}
        </span>
      )}
      {row.emailOrigin && (
        <ProvenanceTag
          compact
          origin={fromWebsite ? "website" : "provider"}
          url={fromWebsite ? found?.sourceUrl : undefined}
          sourceLabel={sourceLabel(row.source, ctx.policies)}
        />
      )}
      {extra > 0 && (
        <Tooltip content={row.emails.slice(1).map((e) => e.email).join(", ")}>
          <span className="shrink-0 text-[11px] text-muted-foreground">+{extra}</span>
        </Tooltip>
      )}
      <CopyButton value={row.email} label="Email" reveal />
    </span>
  );
}

function RatingCell({ row }: { row: BusinessRow }) {
  if (row.rating == null) return <Muted />;
  return (
    <span className="inline-flex items-center justify-end gap-1 tabular" aria-label={`Rated ${row.rating.toFixed(1)} out of 5`}>
      {row.rating.toFixed(1)}
      <Star className="size-3 fill-warning text-warning" aria-hidden />
    </span>
  );
}

function TagsCell({ tags }: { tags: string[] }) {
  if (!tags.length) return <Muted />;
  const shown = tags.slice(0, 3);
  const rest = tags.length - shown.length;
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {shown.map((t) => (
        <span key={t} className="max-w-24 truncate rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80" title={t}>
          {t}
        </span>
      ))}
      {rest > 0 && (
        <Tooltip content={tags.slice(3).join(", ")}>
          <span className="shrink-0 text-[11px] text-muted-foreground">+{rest}</span>
        </Tooltip>
      )}
    </span>
  );
}

function MapsCell({ row }: { row: BusinessRow }) {
  const href = safeHttpUrl(row.mapsUrl);
  if (!href) return <Muted />;
  return (
    <Tooltip content="Open in Google Maps">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={stop}
        aria-label="Open in Google Maps (opens in a new tab)"
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <MapPin className="size-4" aria-hidden />
      </a>
    </Tooltip>
  );
}

function renderValue(key: FieldKey, row: BusinessRow, ctx: CellRenderContext): React.ReactNode {
  switch (key) {
    case "business_name":
      return <NameCell row={row} ctx={ctx} />;
    case "category":
      // Provider category only — the AI category is never presented as the provider's.
      return <TextValue value={row.category} />;
    case "phone":
      return <PhoneCell row={row} />;
    case "website":
      return <WebsiteCell row={row} />;
    case "website_status":
      return (
        <WebsiteStatusBadge status={row.websiteStatus} checking={!!ctx.enrichmentInProgress && !!row.website && !row.enrichedAt} />
      );
    case "email":
      return <EmailCell row={row} ctx={ctx} />;
    case "email_status":
      return <EmailStatusBadge status={row.emailStatus} hasValue={!!row.email} />;
    case "phone_status":
      return <PhoneStatusBadge status={row.phoneStatus} hasValue={!!row.phone} />;
    case "address":
      return <TextValue value={row.address} />;
    case "city":
      return <TextValue value={row.city} />;
    case "region":
      return <TextValue value={row.region} />;
    case "country":
      return <TextValue value={row.country} />;
    case "postal_code":
      return <TextValue value={row.postalCode} className="tabular" />;
    case "rating":
      return <RatingCell row={row} />;
    case "review_count":
      return row.reviewCount == null ? <Muted /> : <span className="tabular">{formatNumber(row.reviewCount)}</span>;
    case "maps_url":
      return <MapsCell row={row} />;
    case "latitude":
      return row.lat == null ? <Muted /> : <span className="tabular">{row.lat.toFixed(5)}</span>;
    case "longitude":
      return row.lng == null ? <Muted /> : <span className="tabular">{row.lng.toFixed(5)}</span>;
    case "socials":
      return <SocialLinks socials={row.socials} />;
    case "business_status":
      return <TextValue value={businessStatusLabel(row.businessStatus)} />;
    case "quality_status":
      return <QualityBadge status={row.qualityStatus} />;
    case "source":
      return <SourceBadge source={row.source} policies={ctx.policies} />;
    case "source_record_id":
      return <TextValue value={row.sourceRecordId} className="font-mono text-[11px] text-muted-foreground" />;
    case "retrieved_at":
      return <DateValue iso={row.retrievedAt} />;
    case "last_verified":
      return <DateValue iso={row.lastVerifiedAt} emptyLabel="Never" />;
    case "lead_status":
      return row.lead ? <LeadStatusBadge status={row.lead.status} /> : <Muted />;
    case "tags":
      return <TagsCell tags={row.lead?.tags ?? []} />;
    case "notes":
      return <TextValue value={row.lead?.notes} className="text-muted-foreground" />;
    case "last_contacted":
      return <DateValue iso={row.lead?.lastContactedAt} emptyLabel="Not yet" />;
    case "added_at":
      return <DateValue iso={row.lead?.createdAt} />;
  }
}

/** Content for one grid cell (handles "Not stored" and "live" markers for every field). */
export function renderBusinessCell(key: FieldKey, row: BusinessRow, ctx: CellRenderContext): React.ReactNode {
  if (key !== "business_name" && isRestricted(row, key)) {
    return <RestrictedValue source={row.source} policies={ctx.policies} compact={COLUMN_WIDTHS[key] < 120} />;
  }
  const value = renderValue(key, row, ctx);
  if (key !== "business_name" && isLive(row, key)) {
    return (
      <span className={cn("flex min-w-0 items-center gap-1.5", NUMERIC_COLUMNS.has(key) && "justify-end")}>
        <span className="min-w-0 truncate">{value}</span>
        <LiveIndicator source={row.source} policies={ctx.policies} />
      </span>
    );
  }
  return value;
}
