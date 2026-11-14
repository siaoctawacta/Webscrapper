"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Gauge, MoreHorizontal, Search, ShieldCheck, ShieldMinus, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api-client";
import type { UserStatus } from "@/lib/domain";
import { cn, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { EmptyState, Notice } from "@/components/ui/misc";
import { SegmentTabs } from "@/components/ui/tabs";
import type { AdminUserDto, AdminUsersResponse } from "@/server/admin/types";
import type { AdminUserPatch } from "@/server/admin/schemas";
import { UserRoleBadge, UserStatusBadge } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { SetLimitsDialog, type LimitsPatch } from "./set-limits-dialog";
import { TimeText } from "./time-text";

export const ADMIN_USERS_KEY = ["admin", "users"] as const;

type Filter = "all" | UserStatus;
type Confirm = { user: AdminUserDto; kind: "disable" | "make_admin" | "make_member" } | null;

const displayName = (u: AdminUserDto) => u.name || u.email;

function successMessage(u: AdminUserDto, patch: AdminUserPatch): string {
  const who = displayName(u);
  if (patch.status === "disabled") return `${who} is disabled and has been signed out everywhere.`;
  if (patch.status === "active") return `${who} can now use LeadFinder.`;
  if (patch.role === "admin") return `${who} is now an admin.`;
  if (patch.role === "member") return `${who} is now a member.`;
  return `Limits updated for ${who}.`;
}

export function UsersPanel({ meId, initialData }: { meId: string; initialData: AdminUsersResponse }) {
  const qc = useQueryClient();
  const { data = initialData } = useQuery({
    queryKey: ADMIN_USERS_KEY,
    queryFn: () => api<AdminUsersResponse>("/api/v1/admin/users"),
    initialData,
  });
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  const [limitsFor, setLimitsFor] = React.useState<AdminUserDto | null>(null);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AdminUserPatch }) =>
      api<AdminUserDto>(`/api/v1/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", json: patch }),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: (updated, { patch }) => {
      qc.setQueryData<AdminUsersResponse>(ADMIN_USERS_KEY, (old) => {
        if (!old) return old;
        const users = old.users.map((u) => (u.id === updated.id ? updated : u));
        return { ...old, users, pendingCount: users.filter((u) => u.status === "pending").length };
      });
      toast.success(successMessage(updated, patch));
      setLimitsFor(null);
      setConfirm(null);
    },
    onError: (e) => {
      toast.error(e instanceof ApiClientError ? e.message : "Something went wrong. Please try again.");
      setConfirm(null);
    },
    onSettled: () => {
      setBusyId(null);
      void qc.invalidateQueries({ queryKey: ADMIN_USERS_KEY });
    },
  });

  const change = (u: AdminUserDto, patch: AdminUserPatch) => update.mutate({ id: u.id, patch });

  const counts = React.useMemo(() => {
    const c = { all: data.users.length, pending: 0, active: 0, disabled: 0 };
    for (const u of data.users) c[u.status] += 1;
    return c;
  }, [data.users]);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.users.filter(
      (u) => (filter === "all" || u.status === filter) && (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    );
  }, [data.users, filter, query]);

  return (
    <div className="grid gap-5">
      {data.pendingCount > 0 && (
        <Notice tone="warning" icon={<UserCheck />}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p>
              <Badge variant="warning" className="mr-2 border-warning/40 bg-background/60 tabular">
                {formatNumber(data.pendingCount)}
              </Badge>
              {data.pendingCount === 1 ? "1 person is waiting for approval." : `${formatNumber(data.pendingCount)} people are waiting for approval.`}
            </p>
            {filter !== "pending" && (
              <Button variant="link" size="xs" className="text-warning-soft-foreground" onClick={() => setFilter("pending")}>
                Show pending
              </Button>
            )}
          </div>
        </Notice>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <SegmentTabs<Filter>
            value={filter}
            onChange={setFilter}
            className="min-w-max border-b-0"
            items={[
              { value: "all", label: "All", count: counts.all },
              { value: "pending", label: "Pending", count: counts.pending },
              { value: "active", label: "Active", count: counts.active },
              { value: "disabled", label: "Disabled", count: counts.disabled },
            ]}
          />
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search users by name or email"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={filter === "pending" && !query ? "Nobody is waiting for approval" : "No users match"}
            description={filter === "pending" && !query ? "New sign-ups that need approval will appear here." : "Try another filter or search."}
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <caption className="sr-only">Users</caption>
              <thead>
                <tr className="border-b border-border bg-subtle text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">User</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Role</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Joined</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Last active</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Requests this month</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <UserRow
                    key={u.id}
                    u={u}
                    isSelf={u.id === meId}
                    busy={busyId === u.id}
                    monthlyLimit={u.monthlyRequestLimit ?? data.defaults.monthlyRequestLimit}
                    onApprove={() => change(u, { status: "active" })}
                    onEnable={() => change(u, { status: "active" })}
                    onDisable={() => setConfirm({ user: u, kind: "disable" })}
                    onMakeAdmin={() => setConfirm({ user: u, kind: "make_admin" })}
                    onMakeMember={() => setConfirm({ user: u, kind: "make_member" })}
                    onLimits={() => setLimitsFor(u)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SetLimitsDialog
        user={limitsFor}
        defaults={data.defaults}
        saving={update.isPending}
        onOpenChange={(open) => !open && setLimitsFor(null)}
        onSave={(patch: LimitsPatch) => limitsFor && change(limitsFor, patch)}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        loading={update.isPending}
        destructive={confirm?.kind === "disable"}
        title={
          confirm?.kind === "disable"
            ? `Disable ${confirm ? displayName(confirm.user) : ""}?`
            : confirm?.kind === "make_admin"
              ? `Make ${confirm ? displayName(confirm.user) : ""} an admin?`
              : `Make ${confirm ? displayName(confirm.user) : ""} a member?`
        }
        description={
          confirm?.kind === "disable"
            ? "They will be signed out on every device and won't be able to sign in until you enable the account again. Their collections are kept."
            : confirm?.kind === "make_admin"
              ? "Admins can approve and disable people, change limits, create invitations and see usage and the audit log."
              : "They will lose access to the admin area. Their own searches and collections are not affected."
        }
        confirmLabel={confirm?.kind === "disable" ? "Disable account" : confirm?.kind === "make_admin" ? "Make admin" : "Make member"}
        onConfirm={() => {
          if (!confirm) return;
          const patch: AdminUserPatch =
            confirm.kind === "disable" ? { status: "disabled" } : { role: confirm.kind === "make_admin" ? "admin" : "member" };
          change(confirm.user, patch);
        }}
      />
    </div>
  );
}

function UserRow({
  u,
  isSelf,
  busy,
  monthlyLimit,
  onApprove,
  onEnable,
  onDisable,
  onMakeAdmin,
  onMakeMember,
  onLimits,
}: {
  u: AdminUserDto;
  isSelf: boolean;
  busy: boolean;
  monthlyLimit: number;
  onApprove: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onMakeAdmin: () => void;
  onMakeMember: () => void;
  onLimits: () => void;
}) {
  const hasOverrides = u.maxResultsPerSearch != null || u.monthlyRequestLimit != null;
  return (
    <tr className={cn("border-b border-border last:border-0", u.status === "pending" && "bg-warning-soft/40")}>
      <td className="max-w-72 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{u.name || "—"}</span>
          {isSelf && <Badge variant="outline">You</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
      </td>
      <td className="px-3 py-3">
        <UserRoleBadge role={u.role} />
      </td>
      <td className="px-3 py-3">
        <UserStatusBadge status={u.status} />
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
        <TimeText iso={u.createdAt} />
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
        <TimeText iso={u.lastActiveAt} mode="relative" empty="Not signed in" />
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right">
        <span className="tabular font-medium">{formatNumber(u.requestsThisMonth)}</span>
        <span className="tabular text-muted-foreground"> / {formatNumber(monthlyLimit)}</span>
        {hasOverrides && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {u.maxResultsPerSearch != null ? `Max ${formatNumber(u.maxResultsPerSearch)} per search` : "Custom monthly limit"}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {u.status === "pending" && (
            <Button size="xs" variant="default" onClick={onApprove} loading={busy} aria-label={`Approve ${displayName(u)}`}>
              {!busy && <Check aria-hidden />}
              Approve
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${displayName(u)}`} disabled={busy && u.status !== "pending"}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              {u.status === "pending" && (
                <DropdownMenuItem onSelect={onApprove} disabled={isSelf}>
                  <UserCheck /> Approve
                </DropdownMenuItem>
              )}
              {u.status === "disabled" ? (
                <DropdownMenuItem onSelect={onEnable} disabled={isSelf}>
                  <UserCheck /> Enable
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={onDisable} disabled={isSelf} destructive>
                  <Ban /> Disable
                </DropdownMenuItem>
              )}
              {u.role === "admin" ? (
                <DropdownMenuItem onSelect={onMakeMember} disabled={isSelf}>
                  <ShieldMinus /> Make member
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={onMakeAdmin} disabled={isSelf}>
                  <ShieldCheck /> Make admin
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onLimits}>
                <Gauge /> Set limits…
              </DropdownMenuItem>
              {isSelf && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="normal-case tracking-normal">You can&apos;t change your own role or status.</DropdownMenuLabel>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
}
