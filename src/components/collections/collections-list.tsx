"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderHeart, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { CollectionDto } from "@/lib/api-types";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/domain";
import { api } from "@/lib/api-client";
import { formatNumber, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCollections } from "./save-to-collection-dialog";

/** Colour per lead status for the small breakdown bar (semantic tokens only). */
export const STATUS_DOT: Record<LeadStatus, string> = {
  new: "bg-muted-foreground/40",
  contacted: "bg-accent/60",
  proposal_sent: "bg-accent",
  replied: "bg-warning",
  qualified: "bg-success/70",
  won: "bg-success",
  not_a_fit: "bg-destructive/60",
};

function StatusBar({ c }: { c: CollectionDto }) {
  const total = Object.values(c.statusCounts).reduce((a, b) => a + (b ?? 0), 0);
  if (!total) return <div className="h-1.5 rounded-full bg-muted" />;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      {LEAD_STATUSES.map((s) => {
        const n = c.statusCounts[s] ?? 0;
        return n ? <div key={s} className={STATUS_DOT[s]} style={{ width: `${(n / total) * 100}%` }} /> : null;
      })}
    </div>
  );
}

type CollectionFormProps = { open: boolean; onOpenChange: (o: boolean) => void; initial?: CollectionDto | null };

/** Remounts the form each time it opens so fields start from the collection's current values. */
export function CollectionFormDialog(props: CollectionFormProps) {
  return <CollectionFormDialogInner key={props.open ? `open-${props.initial?.id ?? "new"}` : "closed"} {...props} />;
}

function CollectionFormDialogInner({ open, onOpenChange, initial }: CollectionFormProps) {
  const qc = useQueryClient();
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const save = useMutation({
    mutationFn: () =>
      initial
        ? api<CollectionDto>(`/api/v1/collections/${initial.id}`, { method: "PATCH", json: { name: name.trim(), description: description.trim() || null } })
        : api<CollectionDto>("/api/v1/collections", { method: "POST", json: { name: name.trim(), description: description.trim() || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections"] });
      toast.success(initial ? "Collection updated" : "Collection created");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit collection" : "New collection"}</DialogTitle>
          <DialogDescription>Group leads you want to work on together, e.g. “Lomé hotels without a website”.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
        >
          <Field label="Name" htmlFor="c-name">
            <Input id="c-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="c-desc" hint="Optional">
            <Textarea id="c-desc" maxLength={500} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()} loading={save.isPending}>
              {initial ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CollectionsList() {
  const qc = useQueryClient();
  const q = useCollections();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CollectionDto | null>(null);
  const [deleting, setDeleting] = React.useState<CollectionDto | null>(null);

  const del = useMutation({
    mutationFn: (c: CollectionDto) => api<void>(`/api/v1/collections/${c.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections"] });
      toast.success("Collection deleted");
      setDeleting(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete"),
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Collections"
        description="Saved leads with your status, tags and notes."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus /> New collection
          </Button>
        }
      />

      {q.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      )}
      {q.error && <p className="text-sm text-destructive">{q.error.message}</p>}
      {q.data && q.data.collections.length === 0 && (
        <EmptyState
          className="rounded-xl border border-dashed border-border"
          icon={<FolderHeart />}
          title="No collections yet"
          description="Run a search, select the businesses you like and choose “Save to collection”. Or create an empty collection now."
          action={
            <Button variant="outline" onClick={() => setFormOpen(true)}>
              <Plus /> New collection
            </Button>
          }
        />
      )}
      {q.data && q.data.collections.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.collections.map((c) => (
            <div key={c.id} className="group relative rounded-xl border border-border bg-card p-5 shadow-xs transition-shadow hover:shadow-sm">
              <Link href={`/collections/${c.id}`} className="absolute inset-0 rounded-xl focus-visible:outline-2" aria-label={`Open ${c.name}`} />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-semibold tracking-tight">{c.name}</h3>
                  <p className="mt-0.5 line-clamp-2 min-h-[2.5em] text-[13px] text-muted-foreground">{c.description || "No description"}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" className="relative z-10" aria-label="Collection actions">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onSelect={() => {
                        setEditing(c);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setDeleting(c)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="mt-5 grid gap-2">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-medium tabular">{formatNumber(c.leadCount)} leads</span>
                  <span className="text-xs text-muted-foreground">Updated {formatRelative(c.updatedAt)}</span>
                </div>
                <StatusBar c={c} />
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {LEAD_STATUSES.filter((s) => (c.statusCounts[s] ?? 0) > 0).map((s) => (
                    <span key={s} className="flex items-center gap-1 tabular">
                      <span className={`size-1.5 rounded-full ${STATUS_DOT[s]}`} /> {LEAD_STATUS_LABELS[s]} {formatNumber(c.statusCounts[s] ?? 0)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CollectionFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              Its {formatNumber(deleting?.leadCount ?? 0)} leads, with their status, tags and notes, will be removed. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={del.isPending} onClick={() => deleting && del.mutate(deleting)}>
              Delete collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
