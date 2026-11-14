"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Info, MailPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api-client";
import type { UserRole } from "@/lib/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { EmptyState, Notice } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import type { InvitationDto, InvitationsResponse, SignupMode } from "@/server/admin/types";
import { UserRoleBadge } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { TimeText } from "./time-text";

export const ADMIN_INVITATIONS_KEY = ["admin", "invitations"] as const;

const MODE_TEXT: Record<SignupMode, string> = {
  approval: "Anyone can create an account; an admin approves it before they can search.",
  invite: "Only invited people can create an account.",
  closed: "Sign-up is closed to everyone who has not been invited.",
};

export function InvitationsPanel({ initialData, signUpUrl }: { initialData: InvitationsResponse; signUpUrl: string }) {
  const qc = useQueryClient();
  const { data = initialData } = useQuery({
    queryKey: ADMIN_INVITATIONS_KEY,
    queryFn: () => api<InvitationsResponse>("/api/v1/admin/invitations"),
    initialData,
  });
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<UserRole>("member");
  const [error, setError] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<InvitationDto | null>(null);
  const emailId = React.useId();
  const roleId = React.useId();

  const create = useMutation({
    mutationFn: (input: { email: string; role: UserRole }) =>
      api<InvitationDto>("/api/v1/admin/invitations", { method: "POST", json: input }),
    onSuccess: (inv) => {
      qc.setQueryData<InvitationsResponse>(ADMIN_INVITATIONS_KEY, (old) =>
        old ? { ...old, invitations: [inv, ...old.invitations.filter((i) => i.id !== inv.id)] } : old,
      );
      toast.success(`Invitation created for ${inv.email}. Share the sign-up link with them.`);
      setEmail("");
      setRole("member");
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiClientError ? firstDetail(e) : "Something went wrong. Please try again."),
    onSettled: () => void qc.invalidateQueries({ queryKey: ADMIN_INVITATIONS_KEY }),
  });

  const revoke = useMutation({
    mutationFn: (inv: InvitationDto) => api<void>(`/api/v1/admin/invitations/${inv.id}`, { method: "DELETE" }),
    onSuccess: (_v, inv) => {
      qc.setQueryData<InvitationsResponse>(ADMIN_INVITATIONS_KEY, (old) =>
        old ? { ...old, invitations: old.invitations.filter((i) => i.id !== inv.id) } : old,
      );
      toast.success(`Invitation for ${inv.email} revoked.`);
    },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Something went wrong. Please try again."),
    onSettled: () => {
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: ADMIN_INVITATIONS_KEY });
    },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = email.trim();
    if (!v) return setError("Enter the email address of the person you want to invite.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setError("Enter a valid email address, like name@company.com.");
    setError(null);
    create.mutate({ email: v, role });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(signUpUrl);
      toast.success("Sign-up link copied.");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  }

  const pendingCount = data.invitations.filter((i) => i.status === "pending").length;

  return (
    <div className="grid gap-5">
      <Notice tone="info" icon={<Info />}>
        <p>Invited people can sign up even when sign-up is closed and are approved automatically.</p>
        <p className="mt-1 opacity-90">
          <span className="font-medium">Current sign-up mode:</span> {MODE_TEXT[data.signupMode]}
        </p>
      </Notice>

      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>LeadFinder doesn&apos;t send emails. After creating the invitation, send them the sign-up link yourself.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-start">
            <Field label="Email" htmlFor={emailId} error={error}>
              <Input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                aria-invalid={error ? true : undefined}
              />
            </Field>
            <Field label="Role" htmlFor={roleId}>
              <Select
                id={roleId}
                value={role}
                onValueChange={(v) => setRole(v === "admin" ? "admin" : "member")}
                options={[
                  { value: "member", label: "Member" },
                  { value: "admin", label: "Admin" },
                ]}
                aria-label="Role"
              />
            </Field>
            <Button type="submit" loading={create.isPending} className="sm:mt-[19px]">
              {!create.isPending && <MailPlus aria-hidden />}
              Create invitation
            </Button>
          </form>
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-subtle px-3 py-2.5 sm:flex-row sm:items-center">
            <span className="shrink-0 text-xs text-muted-foreground">Sign-up link</span>
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{signUpUrl}</code>
            <Button type="button" variant="outline" size="xs" onClick={copyLink} className="self-start sm:self-auto">
              <Copy aria-hidden /> Copy link
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
          <h2 className="text-[15px] font-semibold tracking-tight">Invitations</h2>
          {data.invitations.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {pendingCount} pending · {data.invitations.length - pendingCount} accepted
            </span>
          )}
        </div>
        {data.invitations.length === 0 ? (
          <EmptyState icon={<MailPlus />} title="No invitations yet" description="People you invite will appear here until they create their account." />
        ) : (
          <div className="relative overflow-x-auto border-t border-border">
            <table className="w-full min-w-[720px] text-[13px]">
              <caption className="sr-only">Invitations</caption>
              <thead>
                <tr className="border-b border-border bg-subtle text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-2.5 font-medium">Email</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Role</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Invited by</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Created</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.invitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0">
                    <td className="max-w-72 truncate px-5 py-3 font-medium">{inv.email}</td>
                    <td className="px-3 py-3">
                      <UserRoleBadge role={inv.role} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {inv.status === "accepted" ? (
                        <span className="inline-flex items-center gap-2">
                          <Badge variant="success">Accepted</Badge>
                          <TimeText iso={inv.acceptedAt} className="text-xs text-muted-foreground" />
                        </span>
                      ) : (
                        <Badge variant="warning">Pending</Badge>
                      )}
                    </td>
                    <td className="max-w-56 truncate px-3 py-3 text-muted-foreground">
                      {inv.invitedBy ? inv.invitedBy.name || inv.invitedBy.email : "Deleted user"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                      <TimeText iso={inv.createdAt} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      {inv.status === "pending" ? (
                        <Button variant="ghost" size="xs" onClick={() => setRevoking(inv)} aria-label={`Revoke invitation for ${inv.email}`}>
                          <Trash2 aria-hidden /> Revoke
                        </Button>
                      ) : (
                        <Tooltip content="Used invitations stay as a record. Manage the account on the Users page.">
                          <span tabIndex={0} className="text-xs text-muted-foreground outline-none focus-visible:underline">
                            Used
                          </span>
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this invitation?"
        description={
          revoking ? `${revoking.email} will no longer be able to use it. If sign-up is open, they can still request an account that needs approval.` : ""
        }
        confirmLabel="Revoke invitation"
        destructive
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </div>
  );
}

/** Prefer the first field-level validation message when the server sends details. */
function firstDetail(e: ApiClientError): string {
  const d = e.details;
  if (Array.isArray(d) && d[0] && typeof d[0] === "object" && "message" in d[0] && typeof d[0].message === "string") return d[0].message;
  return e.message;
}
