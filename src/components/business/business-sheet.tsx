"use client";
/**
 * Right-hand detail panel for one business (search result or saved lead).
 *
 *   <BusinessSheet row={openRow} open={!!openRow} onOpenChange={(o) => !o && setOpenRow(null)}
 *     policies={data.policies} actions={<Button size="sm">Write proposal</Button>} />
 */
import * as React from "react";
import { Dialog as D } from "radix-ui";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copyright,
  ExternalLink,
  Globe,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Smartphone,
  Star,
  XCircle,
} from "lucide-react";
import type { BusinessRow, SourcePolicyInfo } from "@/lib/api-types";
import type { FieldKey } from "@/lib/fields";
import { cn, formatDate, formatNumber, formatRelative } from "@/lib/utils";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Notice, Separator } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
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
import { businessStatusLabel, qualityIssueLabel } from "./labels";
import { SocialLinks } from "./socials";
import {
  attributionFor,
  copyrightAge,
  displayHost,
  isLikelyOutdated,
  isLive,
  isPlausibleEmail,
  isRestricted,
  safeHttpUrl,
  shortUrl,
  sourceLabel,
  telHref,
  whatsappDigits,
} from "./row-utils";

export type BusinessSheetProps = {
  row: BusinessRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policies?: SourcePolicyInfo[];
  /** Quick actions shown under the header (e.g. Write proposal, Create concept, Save). */
  actions?: React.ReactNode;
  /** True while the search job is still visiting websites. */
  enrichmentInProgress?: boolean;
  /**
   * Extra content shown first in the body, e.g. the collection's editable lead panel. When given,
   * the read-only "Lead" section is left out (the editor already shows status, tags and notes).
   */
  children?: React.ReactNode;
};

export function BusinessSheet({ row, open, onOpenChange, policies, actions, enrichmentInProgress, children }: BusinessSheetProps) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open && !!row} onOpenChange={onOpenChange}>
      <SheetContent
        ref={contentRef}
        className="max-w-lg"
        aria-describedby={undefined}
        // Land on the title (read first by screen readers) instead of the first action button.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const active = document.activeElement;
          returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
          contentRef.current?.querySelector<HTMLElement>("[data-sheet-title]")?.focus();
        }}
        // The sheet is opened programmatically (no Dialog.Trigger), so put focus back where it was
        // (usually the grid row) ourselves.
        onCloseAutoFocus={(e) => {
          const el = returnFocus.current;
          returnFocus.current = null;
          if (el?.isConnected) {
            e.preventDefault();
            el.focus({ preventScroll: true });
          }
        }}
      >
        {row && (
          <SheetBody row={row} policies={policies} actions={actions} enrichmentInProgress={enrichmentInProgress}>
            {children}
          </SheetBody>
        )}
      </SheetContent>
    </Dialog>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-3", className)} aria-label={title}>
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Item({ label, children, icon: Icon }: { label: string; children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 text-[13px] max-[420px]:grid-cols-1 max-[420px]:gap-1">
      <dt className="flex items-center gap-1.5 pt-0.5 text-muted-foreground">
        {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const Missing = ({ children = "Not available" }: { children?: React.ReactNode }) => <span className="text-muted-foreground">{children}</span>;

function Check({ ok, yes, no }: { ok: boolean | undefined; yes: string; no: string }) {
  if (ok === undefined) return <Missing>Unknown</Missing>;
  return (
    <span className={cn("inline-flex items-center gap-1.5", ok ? "text-success-soft-foreground" : "text-warning-soft-foreground")}>
      {ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />}
      {ok ? yes : no}
    </span>
  );
}

function SheetBody({ row, policies, actions, enrichmentInProgress, children }: Omit<BusinessSheetProps, "open" | "onOpenChange" | "row"> & { row: BusinessRow }) {
  const restricted = (k: FieldKey) => isRestricted(row, k);
  const live = (k: FieldKey) => (isLive(row, k) ? <LiveIndicator source={row.source} policies={policies} className="ml-1.5 align-middle" /> : null);
  const notStored = <RestrictedValue source={row.source} policies={policies} />;
  const value = (k: FieldKey, v: string | null | undefined, empty?: React.ReactNode) =>
    restricted(k) ? notStored : v?.trim() ? (
      <>
        {v}
        {live(k)}
      </>
    ) : (
      <Missing>{empty}</Missing>
    );

  const label = sourceLabel(row.source, policies);
  const attribution = attributionFor(row.source, policies);
  const tel = telHref(row);
  const wa = whatsappDigits(row.phoneE164);
  const website = safeHttpUrl(row.website);
  const maps = safeHttpUrl(row.mapsUrl);
  const check = row.websiteCheck;
  const age = copyrightAge(check?.copyrightYear);
  const closed = businessStatusLabel(row.businessStatus);
  const hasRestrictions = row.restrictedFields.length > 0;

  return (
    <>
      <header className="grid gap-3 border-b border-border px-6 pb-5 pt-6 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={row.source} policies={policies} />
          {row.websiteStatus === "none" && <WebsiteStatusBadge status="none" />}
          {row.qualityStatus === "duplicate_candidate" && <QualityBadge status="duplicate_candidate" />}
          {closed && row.businessStatus !== "OPERATIONAL" && <Badge variant="danger">{closed}</Badge>}
        </div>
        <div className="grid gap-1">
          <D.Title data-sheet-title tabIndex={-1} className="text-lg font-semibold leading-snug tracking-tight outline-none">
            {row.name?.trim() ? row.name : restricted("business_name") ? "Name not stored" : "Unnamed business"}
            {live("business_name")}
          </D.Title>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
            {restricted("category") ? <span>Category not stored</span> : row.category ? <span>{row.category}</span> : <span>No category listed</span>}
            {row.rating != null && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 tabular text-foreground">
                  <Star className="size-3.5 fill-warning text-warning" aria-hidden />
                  {row.rating.toFixed(1)}
                  {row.reviewCount != null && <span className="text-muted-foreground">({formatNumber(row.reviewCount)} reviews)</span>}
                </span>
              </>
            )}
            {row.city && (
              <>
                <span aria-hidden>·</span>
                <span>{row.city}</span>
              </>
            )}
          </p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="grid gap-7">
          {children && (
            <>
              <div className="grid gap-3">{children}</div>
              <Separator />
            </>
          )}
          <Section title="Contact">
            <dl className="grid gap-2.5">
              <Item label="Phone" icon={Phone}>
                {restricted("phone") ? (
                  notStored
                ) : row.phone ? (
                  <span className="grid gap-1.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="tabular">{row.phone}</span>
                      {live("phone")}
                      <CopyButton value={row.phoneE164 ?? row.phone} label="Phone number" />
                      <PhoneStatusBadge status={row.phoneStatus} hasValue />
                    </span>
                    <span className="flex flex-wrap gap-3 text-[12px]">
                      {tel && (
                        <a href={tel} className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">
                          <Phone className="size-3" aria-hidden /> Call
                        </a>
                      )}
                      {wa && (
                        <a
                          href={`https://wa.me/${wa}`}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
                        >
                          <MessageCircle className="size-3" aria-hidden /> WhatsApp
                        </a>
                      )}
                    </span>
                  </span>
                ) : (
                  <Missing>No phone listed</Missing>
                )}
              </Item>
              <Item label="Email" icon={Mail}>
                {row.emails.length === 0 && !row.email ? (
                  <Missing>No email found</Missing>
                ) : (
                  <ul className="grid gap-2">
                    {(row.emails.length ? row.emails : [{ email: row.email!, sourceUrl: "provider", sameDomain: false }]).map((e) => {
                      const fromProvider = e.sourceUrl === "provider";
                      return (
                        <li key={e.email} className="grid gap-0.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            {isPlausibleEmail(e.email) ? (
                              <a href={`mailto:${e.email}`} className="break-all underline-offset-2 hover:underline">
                                {e.email}
                              </a>
                            ) : (
                              <span className="break-all">{e.email}</span>
                            )}
                            <CopyButton value={e.email} label="Email" />
                            {e.email === row.email && <EmailStatusBadge status={row.emailStatus} hasValue />}
                          </span>
                          <ProvenanceTag origin={fromProvider ? "provider" : "website"} url={fromProvider ? undefined : e.sourceUrl} sourceLabel={label} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Item>
              <Item label="Website" icon={Globe}>
                {restricted("website") ? (
                  notStored
                ) : row.website ? (
                  website ? (
                    <a href={website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all underline-offset-2 hover:underline">
                      {displayHost(row.website, row.websiteHost)}
                      <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="break-all">{row.website}</span>
                  )
                ) : (
                  <Missing>No website listed</Missing>
                )}
                {live("website")}
              </Item>
            </dl>
          </Section>

          <Separator />

          <Section title="Online presence">
            {row.websiteStatus === "none" ? (
              <Notice tone="info">No website is listed for this business — a good prospect for a new site.</Notice>
            ) : (
              <dl className="grid gap-2.5">
                <Item label="Status">
                  <WebsiteStatusBadge status={row.websiteStatus} checking={!!enrichmentInProgress && !row.enrichedAt} />
                </Item>
                {check && check.status !== "skipped" ? (
                  <>
                    <Item label="HTTPS" icon={Lock}>
                      <Check ok={check.https} yes="Secure (HTTPS)" no="Not secure (no HTTPS)" />
                    </Item>
                    <Item label="Mobile" icon={Smartphone}>
                      <Check ok={check.mobileViewport} yes="Mobile-friendly layout" no="No mobile layout detected" />
                    </Item>
                    <Item label="Copyright" icon={Copyright}>
                      {check.copyrightYear ? (
                        <span className={cn(isLikelyOutdated(check.copyrightYear) && "text-warning-soft-foreground")}>
                          © {check.copyrightYear}
                          {isLikelyOutdated(check.copyrightYear) && ` — may be outdated (${age} years old)`}
                        </span>
                      ) : (
                        <Missing>No copyright year found</Missing>
                      )}
                    </Item>
                    <Item label="Page title">{check.title ? <span>{check.title}</span> : <Missing>No title</Missing>}</Item>
                    {check.loadMs != null && (
                      <Item label="Load time" icon={Clock}>
                        <span className="tabular">{(check.loadMs / 1000).toFixed(1)} s</span>
                      </Item>
                    )}
                    {check.status !== "ok" && (
                      <Item label="Visit result" icon={AlertTriangle}>
                        <span className="text-warning-soft-foreground">
                          {check.status === "blocked_by_robots"
                            ? "The site asks crawlers not to visit, so we didn't."
                            : check.error || "The site couldn't be reached."}
                        </span>
                      </Item>
                    )}
                    <Item label="Checked">
                      <span title={formatDate(check.checkedAt, { dateStyle: "medium", timeStyle: "short" })}>{formatRelative(check.checkedAt)}</span>
                      {check.finalUrl && safeHttpUrl(check.finalUrl) && <span className="text-muted-foreground"> · {shortUrl(check.finalUrl)}</span>}
                    </Item>
                  </>
                ) : (
                  <Item label="Website check">
                    <Missing>{enrichmentInProgress ? "Checking now…" : "Not checked"}</Missing>
                  </Item>
                )}
                <Item label="Social">
                  <SocialLinks socials={row.socials} size="md" />
                </Item>
              </dl>
            )}
            {row.websiteStatus === "none" && Object.keys(row.socials).length > 0 && (
              <dl>
                <Item label="Social">
                  <SocialLinks socials={row.socials} size="md" />
                </Item>
              </dl>
            )}
          </Section>

          <Separator />

          <Section title="Location">
            <dl className="grid gap-2.5">
              <Item label="Address" icon={MapPin}>
                {value("address", row.address, "No address listed")}
              </Item>
              <Item label="City">{value("city", row.city)}</Item>
              <Item label="Region">{value("region", row.region)}</Item>
              <Item label="Country">{value("country", row.country)}</Item>
              {(row.postalCode || restricted("postal_code")) && <Item label="Postal code">{value("postal_code", row.postalCode)}</Item>}
              <Item label="Coordinates">
                {row.lat != null && row.lng != null ? (
                  <span className="tabular">
                    {row.lat.toFixed(5)}, {row.lng.toFixed(5)}
                  </span>
                ) : restricted("latitude") ? (
                  notStored
                ) : (
                  <Missing />
                )}
              </Item>
              {maps && (
                <Item label="Map">
                  <a href={maps} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">
                    Open in Google Maps <ExternalLink className="size-3" aria-hidden />
                  </a>
                </Item>
              )}
            </dl>
          </Section>

          <Separator />

          <Section title="Data quality">
            <div className="flex items-center gap-2">
              <QualityBadge status={row.qualityStatus} />
            </div>
            {row.qualityIssues.length > 0 ? (
              <ul className="grid gap-1 text-[13px]">
                {row.qualityIssues.map((i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                    {qualityIssueLabel(i)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">No issues found.</p>
            )}
            {(row.qualityStatus === "duplicate_candidate" || row.duplicateOfId) && (
              <Notice tone="warning">
                This looks like a possible duplicate of another result (same phone, website, or a very similar name nearby). Nothing was merged — check
                before contacting.
              </Notice>
            )}
            {row.aiCategory && !row.category && (
              <p className="text-[12px] text-muted-foreground">
                Suggested category: <span className="text-foreground">{row.aiCategory}</span> (AI suggestion — may be wrong)
              </p>
            )}
          </Section>

          <Separator />

          <Section title="Provenance">
            <dl className="grid gap-2.5">
              <Item label="Data source">
                <span className="flex flex-wrap items-center gap-2">
                  <SourceBadge source={row.source} policies={policies} />
                  <span className="text-muted-foreground" title={formatDate(row.retrievedAt, { dateStyle: "medium", timeStyle: "short" })}>
                    retrieved {formatRelative(row.retrievedAt)}
                  </span>
                </span>
              </Item>
              <Item label="Website visit">
                {row.enrichedAt ? (
                  <span title={formatDate(row.enrichedAt, { dateStyle: "medium", timeStyle: "short" })}>{formatRelative(row.enrichedAt)}</span>
                ) : (
                  <Missing>Not visited</Missing>
                )}
              </Item>
              <Item label="Last verified">
                {row.lastVerifiedAt ? (
                  <span title={formatDate(row.lastVerifiedAt, { dateStyle: "medium", timeStyle: "short" })}>{formatRelative(row.lastVerifiedAt)}</span>
                ) : (
                  <Missing>Never</Missing>
                )}
              </Item>
              <Item label="Provider ID">
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate font-mono text-[11px] text-muted-foreground" title={row.sourceRecordId}>
                    {row.sourceRecordId}
                  </span>
                  <CopyButton value={row.sourceRecordId} label="Provider ID" />
                </span>
              </Item>
            </dl>
            {hasRestrictions && (
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Some details aren&apos;t stored because {label} terms don&apos;t allow it; they&apos;re loaded live when available.
              </p>
            )}
            {attribution && <p className="text-[12px] text-muted-foreground">{attribution}</p>}
          </Section>

          {row.lead && !children && (
            <>
              <Separator />
              <Section title="Lead">
                <dl className="grid gap-2.5">
                  <Item label="Status">
                    <LeadStatusBadge status={row.lead.status} />
                  </Item>
                  <Item label="Tags">
                    {row.lead.tags.length ? (
                      <span className="flex flex-wrap gap-1">
                        {row.lead.tags.map((t) => (
                          <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">
                            {t}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <Missing>No tags</Missing>
                    )}
                  </Item>
                  <Item label="Notes">
                    {row.lead.notes.trim() ? <p className="whitespace-pre-wrap leading-relaxed">{row.lead.notes}</p> : <Missing>No notes</Missing>}
                  </Item>
                  <Item label="Last contacted">
                    {row.lead.lastContactedAt ? (
                      <span title={formatDate(row.lead.lastContactedAt, { dateStyle: "medium", timeStyle: "short" })}>{formatRelative(row.lead.lastContactedAt)}</span>
                    ) : (
                      <Missing>Not yet</Missing>
                    )}
                  </Item>
                  <Item label="Added">
                    <span title={formatDate(row.lead.createdAt, { dateStyle: "medium", timeStyle: "short" })}>{formatRelative(row.lead.createdAt)}</span>
                  </Item>
                </dl>
              </Section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
