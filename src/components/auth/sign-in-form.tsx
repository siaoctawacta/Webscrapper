"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Ban } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Notice } from "@/components/ui/misc";
import { PasswordInput } from "./password-input";
import { readUserStatus, signInErrorMessage } from "./auth-messages";

const DISABLED_MESSAGE = "This account has been disabled. If you think this is a mistake, contact your LeadFinder administrator.";

export function SignInForm({ next, disabled }: { next: string; disabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [accountDisabled, setAccountDisabled] = React.useState(disabled);
  const [pending, setPending] = React.useState(false);
  const errorId = React.useId();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    setAccountDisabled(false);
    try {
      const { data, error: err } = await authClient.signIn.email({ email: email.trim(), password });
      if (err || !data) {
        setError(signInErrorMessage(err));
        return;
      }
      const status = readUserStatus(data.user);
      if (status === "disabled") {
        await authClient.signOut();
        setAccountDisabled(true);
        return;
      }
      router.replace(status === "pending" ? "/pending" : next);
      router.refresh();
    } catch {
      setError("We couldn't reach LeadFinder. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="p-6 pb-0">
        <CardTitle className="text-lg">Sign in</CardTitle>
        <CardDescription>Welcome back. Pick up your prospecting where you left off.</CardDescription>
      </CardHeader>
      <CardContent className="p-6">
        <form onSubmit={onSubmit} noValidate className="grid gap-4" aria-describedby={error ? errorId : undefined}>
          {accountDisabled && (
            <Notice tone="danger" icon={<Ban />}>
              {DISABLED_MESSAGE}
            </Notice>
          )}
          <Field label="Email" htmlFor="sign-in-email">
            <Input
              id="sign-in-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              placeholder="you@studio.com"
            />
          </Field>
          <Field label="Password" htmlFor="sign-in-password">
            <PasswordInput
              id="sign-in-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </Field>
          {error && (
            <p id={errorId} role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          <Button type="submit" loading={pending} className="w-full">
            Sign in
          </Button>
        </form>
        <p className="mt-6 text-center text-[13px] text-muted-foreground">
          New to LeadFinder?{" "}
          <Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
