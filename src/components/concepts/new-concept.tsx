"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Globe, LayoutTemplate, SearchX, Wand2 } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import type { ConceptGenerateResponse, ConceptPrefillDto, ConceptRef, CreateConceptBody } from "@/server/concepts/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, Notice, PageHeader, Skeleton } from "@/components/ui/misc";
import { AiToggle, ConceptForm, errorsFromApi, formStateFromPrefill, formStateToBody, hasErrors, useAiPreference, validateForm, type ConceptFormState, type FormErrors } from "./concept-form";
import { useAiAvailable } from "./hooks";

function StartHint() {
  return (
    <EmptyState
      className="rounded-xl border border-dashed border-border"
      icon={<LayoutTemplate />}
      title="Start from a business"
      description="Homepage concepts are made for a business from your results or collections. Open a search, go to the “No website” tab and choose “Draft a homepage concept”."
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
  );
}

function WhatYouGet() {
  return (
    <Card className="bg-subtle shadow-none">
      <CardContent className="grid gap-3 text-[13px] leading-relaxed">
        <p className="font-medium">What you’ll get</p>
        <ul className="grid list-disc gap-2 pl-4 text-muted-foreground marker:text-border">
          <li>A one-page homepage in the business’s colours: hero, services, about, photo ideas and contact.</li>
          <li>Copy built only from the details you confirm here — no invented prices, years, awards or reviews.</li>
          <li>A live preview you can edit, download as a single HTML file, or share with a private link.</li>
        </ul>
      </CardContent>
    </Card>
  );
}

function NewConceptForm({ prefill, conceptRef, aiAvailable }: { prefill: ConceptPrefillDto; conceptRef: ConceptRef; aiAvailable: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const ai = useAiPreference(aiAvailable);
  const [form, setForm] = React.useState<ConceptFormState>(() => formStateFromPrefill(prefill));
  const [errors, setErrors] = React.useState<FormErrors>({});

  const create = useMutation({
    mutationFn: (body: CreateConceptBody) => api<ConceptGenerateResponse>("/api/v1/concepts", { method: "POST", json: body }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["concepts"] });
      qc.setQueryData(["concept", c.id], c);
      toast.success(c.generatedBy === "ai" ? "Concept created with AI" : "Concept created");
      for (const w of c.warnings) toast.warning(w);
      router.push(`/concepts/${c.id}`);
    },
    onError: (e) => {
      const fieldErrors = errorsFromApi(e);
      if (fieldErrors) setErrors(fieldErrors);
      toast.error(fieldErrors ? "Please check the highlighted fields." : e instanceof Error ? e.message : "Could not create the concept");
    },
  });
  // Keep the button disabled while navigating to the new concept.
  const busy = create.isPending || create.isSuccess;

  return (
    <form
      noValidate
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
      onSubmit={(e) => {
        e.preventDefault();
        const v = validateForm(form);
        setErrors(v);
        if (hasErrors(v)) {
          toast.error("Please check the highlighted fields.");
          return;
        }
        create.mutate({ ...formStateToBody(form), ref: conceptRef, useAi: ai.useAi });
      }}
    >
      <Card>
        <CardContent className="grid gap-6">
          {prefill.hasWebsite && (
            <Notice tone="warning" icon={<Globe />}>
              This business already lists a website{prefill.website ? ` (${prefill.website})` : ""}. You can still draft a concept, e.g. for a redesign.
            </Notice>
          )}
          <ConceptForm value={form} onChange={setForm} errors={errors} disabled={busy} attribution={prefill.attribution} idPrefix="new" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:sticky lg:top-6">
        <WhatYouGet />
        <AiToggle available={aiAvailable} checked={ai.checked} onCheckedChange={ai.setUseAi} disabled={busy} />
        <Button type="submit" size="lg" loading={busy} className="w-full">
          {!busy && <Wand2 />}
          {busy ? "Generating…" : "Generate concept"}
        </Button>
      </div>
    </form>
  );
}

/** /concepts/new?ref_kind=result|lead&ref_id=… — pre-fills the form from the business, then creates the concept. */
export function NewConcept({ refKind, refId }: { refKind: ConceptRef["kind"] | null; refId: string | null }) {
  const ref: ConceptRef | null = refKind && refId ? { kind: refKind, id: refId } : null;
  const { aiAvailable } = useAiAvailable();

  const prefill = useQuery({
    queryKey: ["concept-prefill", ref?.kind, ref?.id],
    queryFn: () => api<ConceptPrefillDto>(`/api/v1/concepts/prefill?ref_kind=${encodeURIComponent(ref?.kind ?? "")}&ref_id=${encodeURIComponent(ref?.id ?? "")}`),
    enabled: ref !== null,
    retry: (n, e) => !(e instanceof ApiClientError && e.status === 404) && n < 1,
    staleTime: Infinity,
  });

  if (!ref) {
    return (
      <div className="grid gap-6">
        <PageHeader title="New homepage concept" />
        <StartHint />
      </div>
    );
  }

  const notFound = prefill.error instanceof ApiClientError && prefill.error.status === 404;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Link href="/concepts" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Homepage concepts
        </Link>
        <PageHeader
          title="New homepage concept"
          description={prefill.data?.contact.businessName ? `For ${prefill.data.contact.businessName} — check the details, choose a style and generate.` : "Describe the business and choose a style."}
        />
      </div>

      {prefill.isLoading && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-[640px]" />
          <Skeleton className="h-48" />
        </div>
      )}

      {notFound && (
        <EmptyState
          className="rounded-xl border border-dashed border-border"
          icon={<SearchX />}
          title="We couldn’t find this business"
          description="It may have been removed, or the search results have expired. Open a recent search or a collection and try again."
          action={
            <Button variant="outline" asChild>
              <Link href="/searches">Go to my searches</Link>
            </Button>
          }
        />
      )}
      {prefill.error && !notFound && <Notice tone="danger">{prefill.error.message}</Notice>}

      {prefill.data && <NewConceptForm prefill={prefill.data} conceptRef={ref} aiAvailable={aiAvailable} />}
    </div>
  );
}
