"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import type { MeDto } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserRoleBadge, UserStatusBadge } from "@/components/admin/badges";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

export function AccountCard({ me }: { me: MeDto }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function signOutEverywhere() {
    setBusy(true);
    try {
      const { error } = await authClient.revokeSessions();
      if (error) {
        toast.error(error.message || "Couldn't sign you out of your other devices. Please try again.");
        setBusy(false);
        return;
      }
      // The current session is revoked too; clear the cookie and go to sign-in.
      await authClient.signOut().catch(() => undefined);
      router.replace("/sign-in");
      router.refresh();
    } catch {
      toast.error("We couldn't reach LeadFinder. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Your sign-in details and access level.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] lg:grid-cols-4">
          <div className="col-span-2 grid min-w-0 gap-1 sm:col-span-1">
            <dt className="text-xs text-muted-foreground">Name</dt>
            <dd className="truncate font-medium">{me.name || "—"}</dd>
          </div>
          <div className="col-span-2 grid min-w-0 gap-1 sm:col-span-1">
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="break-all font-medium">{me.email}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs text-muted-foreground">Role</dt>
            <dd>
              <UserRoleBadge role={me.role} />
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd>
              <UserStatusBadge status={me.status} />
            </dd>
          </div>
        </dl>
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-muted-foreground">
            Lost a phone or used a shared computer? Sign out everywhere, including this browser.
          </p>
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)} className="self-start sm:self-auto">
            <LogOut aria-hidden /> Sign out of all devices
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sign out of all devices?"
        description="You will be signed out everywhere, including this browser, and need to sign in again."
        confirmLabel="Sign out everywhere"
        destructive
        loading={busy}
        onConfirm={signOutEverywhere}
      />
    </Card>
  );
}
