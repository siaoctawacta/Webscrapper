"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

/** "Check again" re-renders the server page (which redirects once approved) and "Sign out". */
export function PendingActions() {
  const router = useRouter();
  const [checking, startCheck] = React.useTransition();
  const [signingOut, setSigningOut] = React.useState(false);
  const [checkedAt, setCheckedAt] = React.useState<Date | null>(null);

  function checkAgain() {
    startCheck(() => {
      router.refresh();
      setCheckedAt(new Date());
    });
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.replace("/sign-in");
      router.refresh();
    } catch {
      toast.error("Couldn't sign you out. Check your connection and try again.");
      setSigningOut(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={checkAgain} loading={checking} className="sm:flex-1">
          {!checking && <RefreshCw aria-hidden />}
          Check again
        </Button>
        <Button variant="outline" onClick={signOut} loading={signingOut} className="sm:flex-1">
          {!signingOut && <LogOut aria-hidden />}
          Sign out
        </Button>
      </div>
      <p className="min-h-4 text-center text-xs text-muted-foreground" aria-live="polite">
        {checkedAt && !checking
          ? `Still waiting for approval — checked at ${checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
          : ""}
      </p>
    </div>
  );
}
