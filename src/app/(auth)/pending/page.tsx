import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { PendingActions } from "@/components/auth/pending-actions";
import { Card, CardContent } from "@/components/ui/card";
import { currentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Waiting for approval" };

export default async function PendingPage() {
  const me = await currentUser();
  if (!me) redirect("/sign-in");
  if (me.status === "active") redirect("/search");
  if (me.status === "disabled") redirect("/sign-in?disabled=1");

  return (
    <Card>
      <CardContent className="grid gap-5 p-6">
        <div className="flex size-10 items-center justify-center rounded-full bg-warning-soft text-warning-soft-foreground">
          <Clock className="size-5" aria-hidden />
        </div>
        <div className="grid gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Your account is waiting for approval</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Thanks for signing up{me.name ? `, ${me.name}` : ""}. An administrator needs to approve your account before you can
            search for businesses. There is nothing else you need to do — once you are approved, you can start right away.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-subtle px-3.5 py-2.5 text-[13px]">
          <span className="text-muted-foreground">Signed in as </span>
          <span className="break-all font-medium">{me.email}</span>
        </div>
        <PendingActions />
      </CardContent>
    </Card>
  );
}
