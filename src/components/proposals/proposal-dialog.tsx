"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, Copy, History, Mail, MessageCircle, RefreshCw, Send, Sparkles } from "lucide-react";
import type { BusinessRow, MeDto, ProposalDraft, SenderProfile } from "@/lib/api-types";
import {
  LANGUAGES,
  LEAD_STATUS_LABELS,
  PROPOSAL_TOPIC_LABELS,
  PROPOSAL_TOPICS,
  type Language,
  type ProposalChannel,
  type ProposalTopic,
} from "@/lib/domain";
import { api, ApiClientError } from "@/lib/api-client";
import { cn, formatRelative } from "@/lib/utils";
import type { ProposalListResponse, SaveProposalResponse } from "@/server/proposals/types";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Notice, Skeleton } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";

export type ProposalBusinessRef = { kind: "result" | "lead"; id: string };

export type ProposalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessRef: ProposalBusinessRef;
  business: BusinessRow;
  /** Called after the proposal is logged (marked as sent, or opened in email / WhatsApp). */
  onSent?: () => void;
};

const TOPIC_HINTS: Record<ProposalTopic, string> = {
  new_website: "A first website for a business without one",
  website_redesign: "Improve the website they already have",
  local_seo: "Show up higher on Google and Google Maps",
  social_media: "Regular posts and a stronger presence",
  branding: "Logo, colours and a consistent look",
  custom: "Describe your own service",
};

const LANGUAGE_NAMES: Record<Language, string> = { en: "English", fr: "French" };

const WEBSITE_LABEL: Record<BusinessRow["websiteStatus"], string> = {
  none: "No website",
  present: "Has a website",
  unreachable: "Website unreachable",
  unknown: "Website not checked",
};

const CHANNEL_LABEL: Record<ProposalChannel, string> = { email: "by email", whatsapp: "on WhatsApp", copy: "another way" };

const FACT_LABELS: Record<string, string> = {
  businessName: "Name",
  category: "Category",
  city: "City",
  rating: "Rating",
  reviewCount: "Reviews",
  ratingSource: "Rating from",
  websiteStatus: "Website",
  website: "Website",
  websiteIssues: "Site issues",
  socials: "Social media",
  conceptUrl: "Homepage concept",
  customService: "Your service",
};

export const AI_UNAVAILABLE_TOOLTIP = "AI isn't configured — add an AI Gateway key";
export const NO_EMAIL_TOOLTIP = "No email was found on their website";
export const NO_PHONE_TOOLTIP = "No phone number that WhatsApp can use";

const SIMPLE_EMAIL = /^[^\s@?&#<>"]+@[^\s@?&#<>"]+\.[^\s@?&#<>"]+$/;

/** mailto: link with encoded subject and body. */
export function mailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** wa.me link for an E.164 digits string. */
export function whatsappUrl(digits: string, text: string): string {
  return `https://wa.me/${digits.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

function factValue(key: string, value: string | number): string {
  if (key === "websiteStatus" && value === "none") return "none found";
  if (key === "conceptUrl") return "shared link";
  if (key === "rating" && typeof value === "number") return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} / 5`;
  return String(value);
}

function DisabledHint({ hint, children }: { hint: string | null; children: React.ReactElement }) {
  if (!hint) return children;
  return (
    <Tooltip content={hint}>
      {/* Disabled buttons don't receive pointer/focus events, so the wrapper carries the tooltip. */}
      <span tabIndex={0} aria-label={hint} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        {children}
      </span>
    </Tooltip>
  );
}

function LanguageToggle({ value, onChange, disabled }: { value: Language; onChange: (l: Language) => void; disabled?: boolean }) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const i = LANGUAGES.indexOf(value);
    const next = LANGUAGES[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + LANGUAGES.length) % LANGUAGES.length]!;
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Language" onKeyDown={onKeyDown} className="inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1">
      {LANGUAGES.map((l) => (
        <button
          key={l}
          ref={(el) => {
            refs.current[l] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === l}
          aria-label={LANGUAGE_NAMES[l]}
          tabIndex={value === l ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(l)}
          className={cn(
            "inline-flex h-7 min-w-11 items-center justify-center rounded-md px-3 text-[13px] font-medium text-muted-foreground outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50",
            value === l && "bg-background text-foreground shadow-xs",
          )}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Textarea that grows with its content. */
function AutoGrowTextarea(props: React.ComponentProps<typeof Textarea>) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <Textarea ref={ref} {...props} className={cn("min-h-48 resize-none overflow-hidden", props.className)} />;
}

function BusinessFacts({ business }: { business: BusinessRow }) {
  const parts = [business.category, business.city, WEBSITE_LABEL[business.websiteStatus]].filter((p): p is string => Boolean(p));
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
      {parts.map((p, i) => (
        <React.Fragment key={p}>
          {i > 0 && <span aria-hidden>·</span>}
          <span>{p}</span>
        </React.Fragment>
      ))}
    </p>
  );
}

function errorMessage(e: unknown, fallback: string) {
  return e instanceof ApiClientError || e instanceof Error ? e.message : fallback;
}

function ProposalEditor({ businessRef, business, onSent, onClose }: Omit<ProposalDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const qc = useQueryClient();
  const historyKey = ["proposals", businessRef.kind, businessRef.id] as const;

  const settings = useQuery({
    queryKey: ["me-settings"],
    queryFn: () => api<SenderProfile>("/api/v1/me/settings"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeDto & { aiAvailable?: boolean }>("/api/v1/me"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () =>
      api<ProposalListResponse>(`/api/v1/proposals?ref_kind=${encodeURIComponent(businessRef.kind)}&ref_id=${encodeURIComponent(businessRef.id)}`),
    retry: false,
  });
  // /api/v1/me is the source of truth; the history endpoint reports the same flag as a fallback.
  const aiAvailable = (me.isSuccess ? me.data.aiAvailable : undefined) ?? (history.isSuccess ? history.data.aiAvailable : false);

  const [topic, setTopic] = React.useState<ProposalTopic>(business.websiteStatus === "none" ? "new_website" : "website_redesign");
  const [chosenLanguage, setChosenLanguage] = React.useState<Language | null>(null);
  const language: Language = chosenLanguage ?? settings.data?.defaultLanguage ?? "en";
  const [customService, setCustomService] = React.useState("");
  const [aiWanted, setAiWanted] = React.useState(false);
  const useAi = aiWanted && aiAvailable;
  const [draft, setDraft] = React.useState<ProposalDraft | null>(null);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  /** Channel + content last logged, so opening email then marking as sent doesn't log twice. */
  const [savedKey, setSavedKey] = React.useState<string | null>(null);

  const generate = useMutation({
    mutationFn: (opts: { useAi: boolean }) =>
      api<ProposalDraft>("/api/v1/proposals/draft", {
        method: "POST",
        json: {
          ref: businessRef,
          topic,
          language,
          customService: topic === "custom" ? customService.trim() || null : null,
          useAi: opts.useAi,
        },
      }),
    onSuccess: (d) => {
      setDraft(d);
      setSubject(d.subject);
      setBody(d.body);
      setSavedKey(null);
    },
    onError: (e) => toast.error("Couldn't write the draft", { description: errorMessage(e, "Please try again.") }),
  });

  // First draft: the plain template, as soon as the default language is known.
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current || settings.isPending) return;
    started.current = true;
    generate.mutate({ useAi: false });
  }, [settings.isPending, generate]);

  const save = useMutation({
    mutationFn: (channel: ProposalChannel) =>
      api<SaveProposalResponse>("/api/v1/proposals", {
        method: "POST",
        json: {
          ref: businessRef,
          topic: draft?.topic ?? topic,
          language: draft?.language ?? language,
          subject: subject.trim(),
          body: body.trim(),
          channel,
          generatedBy: draft?.generatedBy ?? "template",
        },
      }),
    onSuccess: (res, channel) => {
      setSavedKey(`${channel}\n${subject}\n${body}`);
      void qc.invalidateQueries({ queryKey: historyKey });
      onSent?.();
      return res;
    },
  });

  const channels = draft?.channels ?? { email: null, whatsappNumber: null };
  const email = channels.email && SIMPLE_EMAIL.test(channels.email) ? channels.email : null;
  const whatsapp = channels.whatsappNumber;
  const hasContent = subject.trim() !== "" && body.trim() !== "";
  const busy = generate.isPending;

  const stale =
    draft !== null && (draft.topic !== topic || draft.language !== language || (topic === "custom" && (draft.factsUsed.customService ?? "") !== customService.trim().toLowerCase() && customService.trim() !== ""));

  function logSend(channel: ProposalChannel, opts: { closeAfter?: boolean } = {}) {
    const key = `${channel}\n${subject}\n${body}`;
    const done = (res?: SaveProposalResponse) => {
      const moved = res?.lead && res.lead.status === "proposal_sent" ? ` Lead status: ${LEAD_STATUS_LABELS.proposal_sent}.` : "";
      toast.success(opts.closeAfter ? "Marked as sent" : "Saved to this business's proposal history", {
        description: `Sent ${CHANNEL_LABEL[channel]}.${moved}`,
      });
      if (opts.closeAfter) onClose();
    };
    if (savedKey === key) return done();
    save.mutate(channel, {
      onSuccess: (res) => done(res),
      onError: (e) => toast.error("Couldn't save the proposal", { description: errorMessage(e, "Please try again.") }),
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${subject.trim()}\n\n${body.trim()}`);
      toast.success("Copied subject and message");
    } catch {
      toast.error("Couldn't copy automatically", { description: "Select the text and copy it yourself." });
    }
  }

  function openEmail() {
    if (!email) return;
    window.location.href = mailtoUrl(email, subject.trim(), body.trim());
    logSend("email");
  }

  function openWhatsapp() {
    if (!whatsapp) return;
    window.open(whatsappUrl(whatsapp, body.trim()), "_blank", "noopener,noreferrer");
    logSend("whatsapp");
  }

  const last = history.data?.proposals[0];
  const facts = Object.entries(draft?.factsUsed ?? {}).filter((e): e is [string, string | number] => e[1] !== null && e[1] !== "");
  const ids = React.useId();

  return (
    <>
      <DialogHeader className="border-b border-border px-5 pb-4 pt-5 pr-12 sm:px-6">
        <DialogTitle className="truncate">{business.name ?? "Unnamed business"}</DialogTitle>
        <DialogDescription asChild>
          <div className="grid gap-1">
            <BusinessFacts business={business} />
            {last && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <History className="size-3.5" aria-hidden />
                Last proposal {formatRelative(last.createdAt)}
                {last.channel ? ` · ${CHANNEL_LABEL[last.channel]}` : ""} · {PROPOSAL_TOPIC_LABELS[last.topic]}
              </p>
            )}
          </div>
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5 px-5 py-5 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Topic" htmlFor={`${ids}-topic`}>
            <Select
              id={`${ids}-topic`}
              value={topic}
              onValueChange={(v) => setTopic(v as ProposalTopic)}
              disabled={busy}
              options={PROPOSAL_TOPICS.map((t) => ({ value: t, label: PROPOSAL_TOPIC_LABELS[t], description: TOPIC_HINTS[t] }))}
            />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium leading-none" id={`${ids}-lang`}>
              Language
            </span>
            <LanguageToggle value={language} onChange={setChosenLanguage} disabled={busy} />
          </div>
        </div>

        {topic === "custom" && (
          <Field label="Your service" htmlFor={`${ids}-service`} hint="A few words, in the message's language — e.g. “menu design” or “photos de produits”.">
            <Input
              id={`${ids}-service`}
              value={customService}
              maxLength={200}
              placeholder="What do you offer?"
              onChange={(e) => setCustomService(e.target.value)}
              disabled={busy}
            />
          </Field>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <DisabledHint hint={aiAvailable ? null : AI_UNAVAILABLE_TOOLTIP}>
            <div className="flex items-center gap-2.5">
              <Switch id={`${ids}-ai`} checked={useAi} onCheckedChange={setAiWanted} disabled={!aiAvailable || busy} aria-describedby={`${ids}-ai-hint`} />
              <div className="grid gap-0.5">
                <Label htmlFor={`${ids}-ai`}>Polish with AI</Label>
                <span id={`${ids}-ai-hint`} className="text-xs text-muted-foreground">
                  Rewrites the template to sound more natural. No new facts.
                </span>
              </div>
            </div>
          </DisabledHint>
          <Button size="sm" variant={draft ? "outline" : "default"} onClick={() => generate.mutate({ useAi })} loading={busy}>
            {!busy && (useAi ? <Sparkles /> : <RefreshCw />)}
            {draft ? "Generate again" : "Generate"}
          </Button>
        </div>
        {stale && !busy && <p className="-mt-2 text-xs text-muted-foreground">You changed the options — generate again to update the message.</p>}

        <div className="h-px bg-border" role="presentation" />

        {!draft ? (
          <div className="grid gap-3" aria-busy="true" aria-label="Writing the draft">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : (
          <div className={cn("grid gap-4 transition-opacity", busy && "opacity-60")}>
            <Field label="Subject" htmlFor={`${ids}-subject`}>
              <Input id={`${ids}-subject`} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`${ids}-body`}>Message</Label>
                {draft.generatedBy === "ai" ? (
                  <Badge variant="accent">
                    <Sparkles aria-hidden /> AI-polished — read it before sending
                  </Badge>
                ) : (
                  <Badge variant="outline">Template</Badge>
                )}
              </div>
              <AutoGrowTextarea id={`${ids}-body`} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} className="text-[13px]" />
            </div>

            {facts.length > 0 && (
              <div className="grid gap-2">
                <p className="text-xs font-medium text-muted-foreground">Facts used — only these details about the business are in the message</p>
                <ul className="flex flex-wrap gap-1.5">
                  {facts.map(([k, v]) => (
                    <li key={k}>
                      <Badge variant="outline" className="max-w-full whitespace-normal break-words text-left">
                        <span className="text-muted-foreground">{FACT_LABELS[k] ?? k}:</span> <span className="text-foreground">{factValue(k, v)}</span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {draft.warnings.length > 0 && (
              <div className="grid gap-2">
                {draft.warnings.map((w) => (
                  <Notice key={w} tone="warning" icon={<AlertTriangle />}>
                    {w}{" "}
                    {/Settings/.test(w) && (
                      <Link href="/settings" className="font-medium underline underline-offset-2">
                        Open Settings
                      </Link>
                    )}
                  </Notice>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-popover px-5 py-3.5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={copy} disabled={!hasContent}>
            <Copy /> Copy
          </Button>
          <DisabledHint hint={draft && !email ? NO_EMAIL_TOOLTIP : null}>
            <Button size="sm" variant="outline" onClick={openEmail} disabled={!email || !hasContent}>
              <Mail /> Open in email
            </Button>
          </DisabledHint>
          <DisabledHint hint={draft && !whatsapp ? NO_PHONE_TOOLTIP : null}>
            <Button size="sm" variant="outline" onClick={openWhatsapp} disabled={!whatsapp || !hasContent}>
              <MessageCircle /> WhatsApp
            </Button>
          </DisabledHint>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={!hasContent} loading={save.isPending}>
              {!save.isPending && <Send />} Mark as sent <ChevronDown className="opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel>How did you send it?</DropdownMenuLabel>
            {(["email", "whatsapp", "copy"] as const).map((c) => (
              <DropdownMenuItem key={c} onSelect={() => logSend(c, { closeAfter: true })}>
                {c === "email" ? <Mail /> : c === "whatsapp" ? <MessageCircle /> : <Check />}
                {c === "email" ? "By email" : c === "whatsapp" ? "On WhatsApp" : "Another way"}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

/** Write a proposal (email / WhatsApp) for one business, from known facts only. */
export function ProposalDialog({ open, onOpenChange, businessRef, business, onSent }: ProposalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="gap-0 p-0" aria-describedby={undefined}>
        {open && <ProposalEditor businessRef={businessRef} business={business} onSent={onSent} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** A "Write proposal" button that opens the dialog. */
export function ProposalButton({
  businessRef,
  business,
  onSent,
  label = "Write proposal",
  size = "sm",
  variant = "outline",
  className,
}: {
  businessRef: ProposalBusinessRef;
  business: BusinessRow;
  onSent?: () => void;
  label?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        <Mail /> {label}
      </Button>
      <ProposalDialog open={open} onOpenChange={setOpen} businessRef={businessRef} business={business} onSent={onSent} />
    </>
  );
}
