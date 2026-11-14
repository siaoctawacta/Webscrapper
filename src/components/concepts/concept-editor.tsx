"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Copy, Download, ExternalLink, Globe, RefreshCw, Save, SearchX, Sparkles, Trash2 } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { formatRelative } from "@/lib/utils";
import type { ConceptContent, ConceptDto, ConceptGenerateResponse, RegenerateConceptBody, UpdateConceptBody } from "@/server/concepts/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import {
  AiToggle,
  ConceptForm,
  emptyFormState,
  errorsFromApi,
  formStateFromInput,
  formStateToBody,
  hasErrors,
  useAiPreference,
  validateForm,
  type ConceptFormState,
  type FormErrors,
} from "./concept-form";
import { ConceptPreview } from "./concept-preview";
import { useAiAvailable, useOrigin } from "./hooks";
import { STYLE_OPTIONS } from "./options";

const conceptKey = (id: string) => ["concept", id] as const;

function useConcept(id: string) {
  return useQuery({
    queryKey: conceptKey(id),
    queryFn: () => api<ConceptDto>(`/api/v1/concepts/${id}`),
    retry: (n, e) => !(e instanceof ApiClientError && e.status === 404) && n < 1,
  });
}

/** Keep the concept cache, the list and the preview in sync after a change. */
function useApplyConcept(id: string) {
  const qc = useQueryClient();
  return React.useCallback(
    (c: ConceptDto) => {
      qc.setQueryData(conceptKey(id), c);
      qc.invalidateQueries({ queryKey: ["concepts"] });
    },
    [qc, id],
  );
}

function ShareCard({ concept }: { concept: ConceptDto }) {
  const origin = useOrigin();
  const apply = useApplyConcept(concept.id);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const url = concept.sharePath ? `${origin}${concept.sharePath}` : "";
  const share = useMutation({
    mutationFn: (shareEnabled: boolean) => api<ConceptDto>(`/api/v1/concepts/${concept.id}`, { method: "PATCH", json: { shareEnabled } satisfies UpdateConceptBody }),
    onSuccess: (c) => {
      apply(c);
      toast.success(c.shareEnabled ? "Share link is on" : "Share link turned off — the page is no longer public");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not change sharing"),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      inputRef.current?.select();
      toast.error("Couldn’t copy automatically — the link is selected, copy it with Ctrl+C / ⌘C.");
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="concept-share">Share link</Label>
            <p className="text-xs leading-relaxed text-muted-foreground">Anyone with the link can view this concept. It isn’t listed by search engines and you can turn it off anytime.</p>
          </div>
          <Switch id="concept-share" checked={concept.shareEnabled} disabled={share.isPending} onCheckedChange={(v) => share.mutate(v)} />
        </div>
        {concept.shareEnabled && url && (
          <div className="flex items-center gap-2">
            <Input ref={inputRef} readOnly value={url} aria-label="Public link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Copy link">
              <Copy />
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open the shared page in a new tab">
                <ExternalLink />
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CopyCard({ concept }: { concept: ConceptDto }) {
  const apply = useApplyConcept(concept.id);
  const initial = React.useMemo(
    () => ({ tagline: concept.content.tagline, headline: concept.content.hero.headline, subheadline: concept.content.hero.subheadline }),
    [concept.content],
  );
  // The parent re-mounts this card (key) when the saved copy changes, e.g. after a regenerate.
  const [copyFields, setCopyFields] = React.useState(initial);
  const [errors, setErrors] = React.useState<Partial<Record<keyof typeof initial, string>>>({});
  const dirty = copyFields.tagline !== initial.tagline || copyFields.headline !== initial.headline || copyFields.subheadline !== initial.subheadline;

  const save = useMutation({
    mutationFn: () => {
      const content: ConceptContent = {
        ...concept.content,
        tagline: copyFields.tagline,
        hero: { ...concept.content.hero, headline: copyFields.headline, subheadline: copyFields.subheadline },
      };
      return api<ConceptDto>(`/api/v1/concepts/${concept.id}`, { method: "PATCH", json: { content } satisfies UpdateConceptBody });
    },
    onSuccess: (c) => {
      apply(c);
      toast.success("Copy saved");
    },
    onError: (e) => {
      const details = e instanceof ApiClientError && Array.isArray(e.details) ? (e.details as { path?: string; message?: string }[]) : [];
      const next: typeof errors = {};
      for (const d of details) {
        if (d.path === "content.tagline") next.tagline = d.message;
        if (d.path === "content.hero.headline") next.headline = d.message;
        if (d.path === "content.hero.subheadline") next.subheadline = d.message;
      }
      setErrors(next);
      toast.error(Object.keys(next).length ? "Please check the highlighted fields." : e instanceof Error ? e.message : "Could not save");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Headline and tagline</CardTitle>
        <CardDescription>Fine-tune the first words visitors read.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!copyFields.headline.trim()) {
              setErrors({ headline: "The headline can’t be empty." });
              return;
            }
            save.mutate();
          }}
        >
          <Field label="Tagline" htmlFor="copy-tagline" hint={`${copyFields.tagline.length}/140`} error={errors.tagline}>
            <Input id="copy-tagline" maxLength={140} value={copyFields.tagline} onChange={(e) => setCopyFields({ ...copyFields, tagline: e.target.value })} aria-invalid={Boolean(errors.tagline) || undefined} />
          </Field>
          <Field label="Headline" htmlFor="copy-headline" hint={`${copyFields.headline.length}/120`} error={errors.headline}>
            <Input id="copy-headline" maxLength={120} value={copyFields.headline} onChange={(e) => setCopyFields({ ...copyFields, headline: e.target.value })} aria-invalid={Boolean(errors.headline) || undefined} />
          </Field>
          <Field label="Subheadline" htmlFor="copy-subheadline" hint={`${copyFields.subheadline.length}/280`} error={errors.subheadline}>
            <Textarea id="copy-subheadline" rows={3} maxLength={280} value={copyFields.subheadline} onChange={(e) => setCopyFields({ ...copyFields, subheadline: e.target.value })} aria-invalid={Boolean(errors.subheadline) || undefined} />
          </Field>
          <div className="flex justify-end gap-2">
            {dirty && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setCopyFields(initial)} disabled={save.isPending}>
                Reset
              </Button>
            )}
            <Button type="submit" size="sm" variant="secondary" disabled={!dirty} loading={save.isPending}>
              {!save.isPending && <Save />} Save copy
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DetailsCard({ concept }: { concept: ConceptDto }) {
  const apply = useApplyConcept(concept.id);
  const { aiAvailable } = useAiAvailable();
  const ai = useAiPreference(aiAvailable);
  const initial = React.useMemo<ConceptFormState>(
    () => (concept.input ? formStateFromInput(concept.input) : { ...emptyFormState(concept.language), businessName: concept.businessName }),
    [concept.input, concept.language, concept.businessName],
  );
  // The parent re-mounts this card (key) when the saved input changes.
  const [form, setForm] = React.useState(initial);
  const [errors, setErrors] = React.useState<FormErrors>({});

  const check = () => {
    const v = validateForm(form);
    setErrors(v);
    if (hasErrors(v)) toast.error("Please check the highlighted fields.");
    return !hasErrors(v);
  };
  const onApiError = (e: unknown, fallback: string) => {
    const fieldErrors = errorsFromApi(e);
    if (fieldErrors) setErrors(fieldErrors);
    toast.error(fieldErrors ? "Please check the highlighted fields." : e instanceof Error ? e.message : fallback);
  };

  const regenerate = useMutation({
    mutationFn: () =>
      api<ConceptGenerateResponse>(`/api/v1/concepts/${concept.id}/regenerate`, {
        method: "POST",
        json: { input: formStateToBody(form), useAi: ai.useAi } satisfies RegenerateConceptBody,
      }),
    onSuccess: (c) => {
      apply(c);
      toast.success(c.generatedBy === "ai" ? "Concept regenerated with AI" : "Concept regenerated");
      for (const w of c.warnings) toast.warning(w);
    },
    onError: (e) => onApiError(e, "Could not regenerate"),
  });
  const saveDetails = useMutation({
    mutationFn: () => api<ConceptDto>(`/api/v1/concepts/${concept.id}`, { method: "PATCH", json: { input: formStateToBody(form) } satisfies UpdateConceptBody }),
    onSuccess: (c) => {
      apply(c);
      toast.success("Details saved");
    },
    onError: (e) => onApiError(e, "Could not save"),
  });
  const busy = regenerate.isPending || saveDetails.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business and style</CardTitle>
        <CardDescription>Change the details, then regenerate the copy.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <form
          noValidate
          className="grid gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (check()) regenerate.mutate();
          }}
        >
          <ConceptForm value={form} onChange={setForm} errors={errors} disabled={busy} idPrefix="edit" />
          <div className="grid gap-3 border-t border-border pt-5">
            <AiToggle available={aiAvailable} checked={ai.checked} onCheckedChange={ai.setUseAi} disabled={busy} />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Regenerate</span> rewrites all the copy, including your headline edits.{" "}
              <span className="font-medium text-foreground">Save details</span> keeps the copy and updates contact details on the page.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={busy} loading={saveDetails.isPending} onClick={() => check() && saveDetails.mutate()}>
                Save details
              </Button>
              <Button type="submit" disabled={busy} loading={regenerate.isPending}>
                {!regenerate.isPending && (ai.useAi ? <Sparkles /> : <RefreshCw />)}
                {regenerate.isPending ? "Regenerating…" : "Regenerate"}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DeleteDialog({ concept, open, onOpenChange }: { concept: ConceptDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api<void>(`/api/v1/concepts/${concept.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: conceptKey(concept.id) });
      qc.invalidateQueries({ queryKey: ["concepts"] });
      toast.success("Concept deleted");
      router.push("/concepts");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete this concept?</DialogTitle>
          <DialogDescription>
            The concept for {concept.businessName} will be deleted{concept.shareEnabled ? " and its share link will stop working" : ""}. This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={del.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => del.mutate()} loading={del.isPending}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConceptEditor({ conceptId }: { conceptId: string }) {
  const q = useConcept(conceptId);
  const [deleting, setDeleting] = React.useState(false);

  if (q.isLoading) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[560px]" />
        </div>
      </div>
    );
  }
  if (q.error || !q.data) {
    const missing = q.error instanceof ApiClientError && q.error.status === 404;
    return (
      <EmptyState
        className="rounded-xl border border-dashed border-border"
        icon={<SearchX />}
        title={missing ? "Concept not found" : "Couldn’t load this concept"}
        description={missing ? "It may have been deleted." : q.error?.message}
        action={
          <Button variant="outline" asChild>
            <Link href="/concepts">Back to concepts</Link>
          </Button>
        }
      />
    );
  }

  const c = q.data;
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Link href="/concepts" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Homepage concepts
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid min-w-0 gap-1.5">
            <h1 className="truncate text-xl font-semibold tracking-tight">{c.businessName}</h1>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {c.generatedBy === "ai" ? (
                <Badge variant="accent">
                  <Sparkles /> AI
                </Badge>
              ) : (
                <Badge variant="outline">Template</Badge>
              )}
              {c.style && <Badge variant="default">{STYLE_OPTIONS[c.style].label}</Badge>}
              {c.shareEnabled && (
                <Badge variant="success">
                  <Globe /> Shared
                </Badge>
              )}
              <span>Updated {formatRelative(c.updatedAt)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/v1/concepts/${c.id}/html?download=1`} download>
                <Download /> Download HTML
              </a>
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleting(true)}>
              <Trash2 /> Delete
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <div className="min-w-0 lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <div className="lg:sticky lg:top-6">
            <ConceptPreview conceptId={c.id} version={c.updatedAt} title={c.businessName} />
          </div>
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <ShareCard concept={c} />
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <CopyCard key={`${c.content.tagline}\u0000${c.content.hero.headline}\u0000${c.content.hero.subheadline}`} concept={c} />
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-3">
          <DetailsCard key={JSON.stringify(c.input)} concept={c} />
        </div>
      </div>

      <DeleteDialog concept={c} open={deleting} onOpenChange={setDeleting} />
    </div>
  );
}
