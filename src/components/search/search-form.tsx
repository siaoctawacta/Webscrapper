"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Info, Link2, Loader2, MapPin, MapPinned, Search, TriangleAlert } from "lucide-react";
import type { CostEstimate, ParsedMapsLinkDto, SearchJobDto } from "@/lib/api-types";
import { TARGET_COUNT_PRESETS } from "@/lib/domain";
import { api, ApiClientError } from "@/lib/api-client";
import { cn, formatNumber, formatUsd } from "@/lib/utils";
import { useDebounced as useDebouncedValue } from "./use-debounced";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Notice } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Mode = "link" | "keyword";
type MeLite = { limits?: { maxResultsPerSearch?: number }; sampleMode?: boolean };

type CreateBody = {
  mapsUrl?: string;
  query?: string;
  location?: string;
  targetCount: number;
  enrich: boolean;
  confirm?: boolean;
};

const looksLikeUrl = (s: string) => /^(https?:\/\/)?([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl)\//i.test(s.trim());

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

function ParsedPreview({ parsed }: { parsed: ParsedMapsLinkDto }) {
  const Icon = parsed.kind === "place" ? MapPinned : parsed.kind === "search" ? Search : MapPin;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-subtle px-3 py-2.5 text-[13px]">
      <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0">
        {parsed.kind === "search" && (
          <p>
            Search for <span className="font-medium">“{parsed.query}”</span>
          </p>
        )}
        {parsed.kind === "place" && (
          <p>
            One business: <span className="font-medium">{parsed.name}</span>
          </p>
        )}
        {parsed.kind === "map_view" && <p className="font-medium">A map area with no search term</p>}
        <p className="truncate text-muted-foreground">{parsed.location.label}</p>
      </div>
    </div>
  );
}

export function SearchForm() {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("link");
  const [link, setLink] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [target, setTarget] = React.useState<number>(100);
  const [enrich, setEnrich] = React.useState(true);
  const [confirmEstimate, setConfirmEstimate] = React.useState<CostEstimate | null>(null);
  const idemKey = React.useRef(newKey());

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeLite>("/api/v1/me"), staleTime: 60_000 });
  const maxTarget = me.data?.limits?.maxResultsPerSearch ?? 20000;

  const debouncedLink = useDebouncedValue(link.trim(), 450);
  const parsed = useQuery({
    queryKey: ["maps-link", debouncedLink],
    queryFn: () => api<ParsedMapsLinkDto>("/api/v1/maps-links/parse", { method: "POST", json: { url: debouncedLink } }),
    enabled: mode === "link" && debouncedLink.length > 10,
    retry: false,
    staleTime: Infinity,
  });

  const isPlace = mode === "link" && parsed.data?.kind === "place";
  const needsQuery = mode === "link" && parsed.data?.kind === "map_view";

  const body: CreateBody | null = React.useMemo(() => {
    if (mode === "link") {
      if (!parsed.data) return null;
      if (needsQuery && !query.trim()) return null;
      return {
        mapsUrl: debouncedLink,
        query: needsQuery ? query.trim() : undefined,
        targetCount: isPlace ? 1 : target,
        enrich,
      };
    }
    if (!query.trim() || !location.trim()) return null;
    return { query: query.trim(), location: location.trim(), targetCount: target, enrich };
  }, [mode, parsed.data, needsQuery, query, location, debouncedLink, isPlace, target, enrich]);

  const debouncedBody = useDebouncedValue(body, 400);
  const estimate = useQuery({
    queryKey: ["estimate", debouncedBody],
    queryFn: () => api<CostEstimate & { locationLabel?: string }>("/api/v1/search-jobs/estimate", { method: "POST", json: debouncedBody }),
    enabled: debouncedBody !== null,
    retry: false,
  });

  const create = useMutation({
    mutationFn: (b: CreateBody) =>
      api<SearchJobDto>("/api/v1/search-jobs", { method: "POST", json: b, headers: { "Idempotency-Key": idemKey.current } }),
    onSuccess: (job) => {
      router.push(`/searches/${job.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === "confirmation_required") {
        const est = (e.details as { estimate?: CostEstimate } | undefined)?.estimate ?? estimate.data ?? null;
        setConfirmEstimate(est);
        return;
      }
      idemKey.current = newKey();
      toast.error(e instanceof Error ? e.message : "Could not start the search");
    },
  });

  const submit = (confirm = false) => {
    if (!body) return;
    create.mutate({ ...body, confirm: confirm || undefined });
  };

  const linkError = parsed.error instanceof ApiClientError ? parsed.error.message : parsed.error ? "We couldn't read that link." : null;

  return (
    <div className="grid gap-6">
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="link">
            <Link2 /> Google Maps link
          </TabsTrigger>
          <TabsTrigger value="keyword">
            <Search /> Keyword + place
          </TabsTrigger>
        </TabsList>

        <TabsContent value="link" className="mt-5 grid gap-3">
          <Label htmlFor="maps-link">Paste a Google Maps link</Label>
          <Input
            id="maps-link"
            autoFocus
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.google.com/maps/search/hotel/@6.1433,1.1657,12z/…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (text) {
                e.preventDefault();
                setLink(text.trim());
              }
            }}
            aria-invalid={Boolean(linkError) || undefined}
            className="h-11 text-[15px]"
          />
          {link.trim() && !looksLikeUrl(link) && !parsed.isFetching && !parsed.data && (
            <p className="text-xs text-muted-foreground">Copy the link from your browser’s address bar while viewing a Google Maps search.</p>
          )}
          {parsed.isFetching && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Reading the link…
            </p>
          )}
          {linkError && !parsed.isFetching && (
            <Notice tone="danger" icon={<TriangleAlert />}>
              {linkError}
            </Notice>
          )}
          {parsed.data && !parsed.isFetching && <ParsedPreview parsed={parsed.data} />}
          {needsQuery && (
            <Field label="What are you looking for in this area?" htmlFor="map-query">
              <Input id="map-query" placeholder="e.g. hotel, restaurant, hair salon" value={query} onChange={(e) => setQuery(e.target.value)} />
            </Field>
          )}
        </TabsContent>

        <TabsContent value="keyword" className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="What" htmlFor="kw-query" hint="A business type or keyword">
            <Input id="kw-query" placeholder="hotel, restaurant, hair salon…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          <Field label="Where" htmlFor="kw-location" hint="City and country work best">
            <Input id="kw-location" placeholder="Lomé, Togo" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </TabsContent>
      </Tabs>

      {!isPlace && (
        <div className="grid gap-2.5">
          <Label>How many businesses?</Label>
          <div role="radiogroup" aria-label="Number of results" className="flex flex-wrap gap-1.5">
            {TARGET_COUNT_PRESETS.map((n) => {
              const disabled = n > maxTarget;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={target === n}
                  disabled={disabled}
                  onClick={() => setTarget(n)}
                  className={cn(
                    "tabular h-8 rounded-md border border-border px-3 text-[13px] font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
                    target === n && "border-primary bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  {formatNumber(n)}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            A target, not a promise — you get as many as exist in the area. Large searches run in the background; you can leave the page.
          </p>
        </div>
      )}

      <label className="flex items-start gap-3 rounded-lg border border-border px-3.5 py-3">
        <Switch checked={enrich} onCheckedChange={setEnrich} className="mt-0.5" aria-label="Find emails and social links" />
        <span className="grid gap-0.5">
          <span className="text-[13px] font-medium">Find emails and social links on their websites</span>
          <span className="text-xs text-muted-foreground">
            We visit each business’s own website (respecting robots.txt) and keep only contact details they publish. Emails are never guessed.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-[13px] text-muted-foreground tabular">
          {estimate.isFetching && <span className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> Estimating…</span>}
          {!estimate.isFetching && estimate.data && (
            estimate.data.isSample ? (
              <span>Sample data mode — free, generated businesses.</span>
            ) : (
              <span>
                About {formatNumber(estimate.data.estimatedRequests)} Google requests · ≈ {formatUsd(estimate.data.estimatedCostUsd)}
                {estimate.data.freeMonthlyRequests ? ` · first ${formatNumber(estimate.data.freeMonthlyRequests)}/month are free on Google` : ""}
              </span>
            )
          )}
          {!estimate.isFetching && estimate.error instanceof ApiClientError && <span className="text-destructive">{estimate.error.message}</span>}
        </div>
        <Button size="lg" onClick={() => submit(false)} disabled={!body} loading={create.isPending}>
          {isPlace ? "Get business details" : "Start search"} <ArrowRight />
        </Button>
      </div>

      <Dialog open={confirmEstimate !== null} onOpenChange={(o) => !o && setConfirmEstimate(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Confirm a larger search</DialogTitle>
            <DialogDescription>
              {confirmEstimate
                ? `This search needs about ${formatNumber(confirmEstimate.estimatedRequests)} Google requests (up to ${formatNumber(confirmEstimate.maxRequests)}), roughly ${formatUsd(confirmEstimate.estimatedCostUsd)} on your Google Cloud bill.`
                : "This search may cost more than your confirmation threshold."}
            </DialogDescription>
          </DialogHeader>
          {confirmEstimate?.notes?.length ? (
            <Notice icon={<Info />}>
              <ul className="grid gap-1">
                {confirmEstimate.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEstimate(null)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              onClick={() => {
                setConfirmEstimate(null);
                submit(true);
              }}
            >
              Start search
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
