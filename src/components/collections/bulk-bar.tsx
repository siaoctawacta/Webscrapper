"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, CircleDot, Copy, Tags, Trash2 } from "lucide-react";
import type { ListQuery } from "@/lib/list-query";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/domain";
import { api } from "@/lib/api-client";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LeadStatusPill, TagEditor } from "./lead-editors";
import { useCollections } from "./save-to-collection-dialog";

type BulkAction = "set_status" | "add_tags" | "remove_tags" | "replace_tags" | "copy_to" | "move_to" | "remove";

export type BulkSelector = { leadIds: string[] } | { query: ListQuery };

/** Bulk actions for selected leads in a collection. */
export function BulkActions({
  collectionId,
  selector,
  count,
  tagSuggestions,
  onDone,
}: {
  collectionId: string;
  selector: BulkSelector;
  count: number;
  tagSuggestions: string[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const collections = useCollections();
  const [tagMode, setTagMode] = React.useState<null | "add_tags" | "remove_tags" | "replace_tags">(null);
  const [tags, setTags] = React.useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const run = useMutation({
    mutationFn: (body: { action: BulkAction; status?: LeadStatus; tags?: string[]; targetCollectionId?: string }) =>
      api<{ affected: number }>(`/api/v1/collections/${collectionId}/leads/bulk`, { method: "POST", json: { ...selector, ...body } }),
    onSuccess: (r, body) => {
      qc.invalidateQueries({ queryKey: ["leads", collectionId] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      const verb: Record<BulkAction, string> = {
        set_status: "Updated status for",
        add_tags: "Tagged",
        remove_tags: "Removed tags from",
        replace_tags: "Replaced tags on",
        copy_to: "Copied",
        move_to: "Moved",
        remove: "Removed",
      };
      toast.success(`${verb[body.action]} ${formatNumber(r.affected)} ${r.affected === 1 ? "lead" : "leads"}`);
      setTagMode(null);
      setTags([]);
      setConfirmRemove(false);
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Bulk action failed"),
  });

  const others = (collections.data?.collections ?? []).filter((c) => c.id !== collectionId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <CircleDot /> Status
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Set status for {formatNumber(count)}</DropdownMenuLabel>
          {LEAD_STATUSES.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => run.mutate({ action: "set_status", status: s })}>
              <LeadStatusPill status={s} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <Tags /> Tags
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setTagMode("add_tags")}>Add tags…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTagMode("remove_tags")}>Remove tags…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTagMode("replace_tags")}>Replace all tags…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={others.length === 0}>
            <ArrowRightLeft /> Copy / move
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Copy to</DropdownMenuLabel>
          {others.map((c) => (
            <DropdownMenuItem key={`c-${c.id}`} onSelect={() => run.mutate({ action: "copy_to", targetCollectionId: c.id })}>
              <Copy /> <span className="truncate">{c.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {others.map((c) => (
            <DropdownMenuItem key={`m-${c.id}`} onSelect={() => run.mutate({ action: "move_to", targetCollectionId: c.id })}>
              <ArrowRightLeft /> <span className="truncate">{c.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmRemove(true)}>
        <Trash2 /> Remove
      </Button>

      <Dialog open={tagMode !== null} onOpenChange={(o) => !o && setTagMode(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{tagMode === "add_tags" ? "Add tags" : tagMode === "remove_tags" ? "Remove tags" : "Replace tags"}</DialogTitle>
            <DialogDescription>
              {tagMode === "replace_tags" ? "These tags will replace all existing tags on" : tagMode === "remove_tags" ? "These tags will be removed from" : "These tags will be added to"} {formatNumber(count)} {count === 1 ? "lead" : "leads"}.
            </DialogDescription>
          </DialogHeader>
          <TagEditor autoFocus tags={tags} onChange={setTags} suggestions={tagSuggestions} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagMode(null)}>
              Cancel
            </Button>
            <Button disabled={tags.length === 0 && tagMode !== "replace_tags"} loading={run.isPending} onClick={() => tagMode && run.mutate({ action: tagMode, tags })}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Remove {formatNumber(count)} {count === 1 ? "lead" : "leads"}?</DialogTitle>
            <DialogDescription>They’ll be removed from this collection along with their status, tags and notes.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={run.isPending} onClick={() => run.mutate({ action: "remove" })}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
