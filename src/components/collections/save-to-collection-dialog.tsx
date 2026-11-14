"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderPlus, Plus } from "lucide-react";
import type { CollectionDto } from "@/lib/api-types";
import type { ListQuery } from "@/lib/list-query";
import { api } from "@/lib/api-client";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function useCollections() {
  return useQuery({ queryKey: ["collections"], queryFn: () => api<{ collections: CollectionDto[] }>("/api/v1/collections") });
}

export type SaveToCollectionProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  jobId: string;
  /** Explicit result ids, or null to save every result matching `query`. */
  resultIds: string[] | null;
  query: ListQuery;
  count: number;
  /** When set (e.g. "all filtered" minus a few excluded rows), resolves the exact ids at save time. */
  resolveIds?: () => Promise<string[]>;
  onSaved?: () => void;
};

export function SaveToCollectionDialog({ open, onOpenChange, jobId, resultIds, query, count, resolveIds, onSaved }: SaveToCollectionProps) {
  const qc = useQueryClient();
  const collections = useCollections();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setCreating(false);
      setName("");
      setSelected(null);
    }
  }, [open]);
  React.useEffect(() => {
    if (open && collections.data && collections.data.collections.length === 0) setCreating(true);
  }, [open, collections.data]);

  const save = useMutation({
    mutationFn: async () => {
      let target = selected;
      let targetName = collections.data?.collections.find((c) => c.id === selected)?.name ?? "";
      if (creating) {
        const c = await api<CollectionDto>("/api/v1/collections", { method: "POST", json: { name: name.trim() } });
        target = c.id;
        targetName = c.name;
      }
      if (!target) throw new Error("Choose a collection");
      const ids = resultIds ?? (resolveIds ? await resolveIds() : null);
      const body = ids ? { jobId, resultIds: ids } : { jobId, query };
      const res = await api<{ added: number; skipped: number }>(`/api/v1/collections/${target}/leads`, { method: "POST", json: body });
      return { ...res, id: target, name: targetName };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["collections"] });
      toast.success(`Saved ${formatNumber(r.added)} ${r.added === 1 ? "lead" : "leads"} to “${r.name}”`, {
        description: r.skipped ? `${formatNumber(r.skipped)} were already in it.` : undefined,
        action: { label: "Open", onClick: () => (window.location.href = `/collections/${r.id}`) },
      });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const canSave = creating ? name.trim().length > 0 : selected !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Save to collection</DialogTitle>
          <DialogDescription>
            {formatNumber(count)} {count === 1 ? "business" : "businesses"} will be saved as leads you can tag, annotate and come back to.
          </DialogDescription>
        </DialogHeader>

        {creating ? (
          <Field label="New collection name" htmlFor="new-collection">
            <Input id="new-collection" autoFocus placeholder="e.g. Lomé hotels without website" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canSave && save.mutate()} />
          </Field>
        ) : (
          <div className="grid max-h-72 gap-1 overflow-y-auto">
            {collections.isLoading &&
              Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-11 w-full" />)}
            {collections.data?.collections.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c.id)}
                aria-pressed={selected === c.id}
                className={cn(
                  "flex items-center justify-between rounded-lg border border-transparent px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-muted",
                  selected === c.id && "border-primary bg-muted",
                )}
              >
                <span className="truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular">{formatNumber(c.leadCount)} leads</span>
              </button>
            ))}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {creating ? (
            collections.data && collections.data.collections.length > 0 ? (
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Choose existing
              </Button>
            ) : (
              <span />
            )
          ) : (
            <Button variant="ghost" onClick={() => setCreating(true)}>
              <Plus /> New collection
            </Button>
          )}
          <Button onClick={() => save.mutate()} disabled={!canSave} loading={save.isPending}>
            <FolderPlus /> Save
          </Button>
        </DialogFooter>
        <p className="text-xs text-muted-foreground">
          Manage collections on the <Link href="/collections" className="text-accent hover:underline">Collections</Link> page.
        </p>
      </DialogContent>
    </Dialog>
  );
}
