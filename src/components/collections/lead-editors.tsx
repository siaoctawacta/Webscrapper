"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, Plus, Tag, X } from "lucide-react";
import type { BusinessRow } from "@/lib/api-types";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/domain";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { STATUS_DOT } from "./collections-list";

type LeadPatch = { status?: LeadStatus; tags?: string[]; notes?: string };

export function useLeadUpdate(onUpdated: (row: BusinessRow) => void) {
  return useMutation({
    mutationFn: ({ leadId, patch }: { leadId: string; patch: LeadPatch }) =>
      api<BusinessRow>(`/api/v1/leads/${leadId}`, { method: "PATCH", json: patch }),
    onSuccess: (row) => onUpdated(row),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update the lead"),
  });
}

export function LeadStatusPill({ status }: { status: LeadStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]">
      <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}

/** Inline status picker for a lead row. */
export function LeadStatusSelect({ row, onUpdated }: { row: BusinessRow; onUpdated: (row: BusinessRow) => void }) {
  const update = useLeadUpdate(onUpdated);
  const status = row.lead?.status ?? "new";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
        aria-label={`Lead status: ${LEAD_STATUS_LABELS[status]}`}
      >
        <LeadStatusPill status={status} />
        <ChevronDown className="size-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {LEAD_STATUSES.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => s !== status && update.mutate({ leadId: row.id, patch: { status: s } })}>
            <LeadStatusPill status={s} />
            {s === status && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TagChips({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (!tags.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, max).map((t) => (
        <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">
          {t}
        </span>
      ))}
      {tags.length > max && <span className="text-[11px] text-muted-foreground">+{tags.length - max}</span>}
    </span>
  );
}

/** Editable tag list (used in cells via popover and in the detail sheet). */
export function TagEditor({ tags, onChange, suggestions = [], autoFocus }: { tags: string[]; onChange: (tags: string[]) => void; suggestions?: string[]; autoFocus?: boolean }) {
  const [draft, setDraft] = React.useState("");
  const add = (t: string) => {
    const v = t.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!v || tags.some((x) => x.toLowerCase() === v.toLowerCase())) return setDraft("");
    onChange([...tags, v]);
    setDraft("");
  };
  const remaining = suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()) && s.toLowerCase().includes(draft.toLowerCase())).slice(0, 8);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pl-2 pr-1 text-xs font-medium">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => onChange(tags.filter((x) => x !== t))}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-xs text-muted-foreground">No tags yet</span>}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
        }}
      >
        <Input autoFocus={autoFocus} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a tag, e.g. hot lead" className="h-8 text-[13px]" maxLength={40} />
        <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()}>
          <Plus /> Add
        </Button>
      </form>
      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {remaining.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-solid hover:text-foreground">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LeadTagsCell({ row, suggestions, onUpdated }: { row: BusinessRow; suggestions: string[]; onUpdated: (row: BusinessRow) => void }) {
  const update = useLeadUpdate(onUpdated);
  const tags = row.lead?.tags ?? [];
  return (
    <Popover>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="-mx-1.5 flex min-h-7 items-center gap-1 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
        aria-label="Edit tags"
      >
        {tags.length ? <TagChips tags={tags} /> : <span className="flex items-center gap-1 text-xs text-muted-foreground"><Tag className="size-3" /> Add tag</span>}
      </PopoverTrigger>
      <PopoverContent onClick={(e) => e.stopPropagation()} className="w-80">
        <TagEditor autoFocus tags={tags} suggestions={suggestions} onChange={(next) => update.mutate({ leadId: row.id, patch: { tags: next } })} />
      </PopoverContent>
    </Popover>
  );
}

/** Notes editor with explicit save (used in the lead detail sheet). */
export function LeadNotesEditor({ row, onUpdated }: { row: BusinessRow; onUpdated: (row: BusinessRow) => void }) {
  const update = useLeadUpdate((r) => {
    onUpdated(r);
    toast.success("Notes saved");
  });
  // The parent keys this editor by lead id, so the draft resets when another lead is opened.
  const [notes, setNotes] = React.useState(row.lead?.notes ?? "");
  const dirty = notes !== (row.lead?.notes ?? "");
  return (
    <div className="grid gap-2">
      <Textarea rows={5} maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Call notes, decision maker, follow-up date…" />
      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty} loading={update.isPending} onClick={() => update.mutate({ leadId: row.id, patch: { notes } })}>
          Save notes
        </Button>
      </div>
    </div>
  );
}
