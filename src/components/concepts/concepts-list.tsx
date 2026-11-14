"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Globe, LayoutTemplate, Search, Sparkles } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatRelative } from "@/lib/utils";
import type { ConceptListResponse, ConceptSummaryDto } from "@/server/concepts/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { LANGUAGE_OPTIONS, STYLE_OPTIONS, TONE_OPTIONS } from "./options";

export function useConcepts() {
  return useQuery({ queryKey: ["concepts"], queryFn: () => api<ConceptListResponse>("/api/v1/concepts") });
}

function Swatches({ colors }: { colors: string[] }) {
  if (!colors.length) return null;
  return (
    <div className="flex -space-x-1" aria-hidden>
      {colors.map((c, i) => (
        // Concept palette colours are data (validated #rrggbb), not UI colours.
        <span key={`${c}-${i}`} className="size-4 rounded-full border border-border shadow-xs" style={{ backgroundColor: c }} />
      ))}
    </div>
  );
}

function ConceptCard({ c }: { c: ConceptSummaryDto }) {
  const meta = [c.style ? STYLE_OPTIONS[c.style].label : null, c.tone ? TONE_OPTIONS[c.tone].label : null, LANGUAGE_OPTIONS[c.language]].filter(Boolean).join(" · ");
  return (
    <div className="group relative flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-xs transition-shadow hover:shadow-sm">
      <Link
        href={`/concepts/${c.id}`}
        className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-label={`Open the homepage concept for ${c.businessName}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{c.businessName}</h3>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{meta}</p>
        </div>
        <Swatches colors={c.swatches} />
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        {c.generatedBy === "ai" ? (
          <Badge variant="accent">
            <Sparkles /> AI
          </Badge>
        ) : (
          <Badge variant="outline">Template</Badge>
        )}
        {c.shareEnabled && (
          <Badge variant="success">
            <Globe /> Shared
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">Created {formatRelative(c.createdAt)}</span>
      </div>
    </div>
  );
}

export function ConceptsList() {
  const q = useConcepts();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Homepage concepts"
        description="Free homepage drafts to show businesses that don't have a website yet."
        actions={
          <Button variant="outline" asChild>
            <Link href="/searches">
              <Search /> Find businesses
            </Link>
          </Button>
        }
      />

      {q.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}
      {q.error && <p className="text-sm text-destructive">{q.error.message}</p>}
      {q.data && q.data.concepts.length === 0 && (
        <EmptyState
          className="rounded-xl border border-dashed border-border"
          icon={<LayoutTemplate />}
          title="No homepage concepts yet"
          description={
            <>
              Open a search, switch to the <span className="font-medium text-foreground">No website</span> tab and choose{" "}
              <span className="font-medium text-foreground">Draft a homepage concept</span> on a business. You can also start from a lead in one of your
              collections.
            </>
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/searches">Go to my searches</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/collections">Open collections</Link>
              </Button>
            </div>
          }
        />
      )}
      {q.data && q.data.concepts.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.concepts.map((c) => (
            <ConceptCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}
