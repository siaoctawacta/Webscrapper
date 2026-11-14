"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Info, MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { SignupMode } from "@/server/admin/types";
import { PasswordInput } from "./password-input";
import { MIN_PASSWORD_LENGTH, readUserStatus, signUpErrorMessage } from "./auth-messages";

type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

const MODE_NOTICE: Record<Exclude<SignupMode, "approval">, string> = {
  invite: "Sign-up is by invitation only. If an administrator invited you, use the email address they invited.",
  closed: "New sign-ups are closed. If an administrator invited you, you can still create your account with that email address.",
};

export function SignUpForm({ signupMode }: { signupMode: SignupMode }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Errors>({});
  const [pending, setPending] = React.useState(false);
  const ids = { name: React.useId(), email: React.useId(), password: React.useId(), hint: React.useId(), form: React.useId() };
  const longEnough = password.length >= MIN_PASSWORD_LENGTH;

  function validate(): Errors {
    const e: Errors = {};
    if (!name.trim()) e.name = "Enter your name.";
    else if (name.trim().length > 100) e.name = "Use 100 characters or fewer.";
    if (!email.trim()) e.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "Enter a valid email address, like name@company.com.";
    if (!longEnough) e.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    else if (password.length > 128) e.password = "Use 128 characters or fewer.";
    return e;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length) return;
    setPending(true);
    try {
      const { data, error } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
      if (error || !data) {
        setErrors({ form: signUpErrorMessage(error) });
        return;
      }
      router.replace(readUserStatus(data.user) === "active" ? "/search" : "/pending");
      router.refresh();
    } catch {
      setErrors({ form: "We couldn't reach LeadFinder. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="p-6 pb-0">
        <CardTitle className="text-lg">Create your account</CardTitle>
        <CardDescription>Find businesses that need a website, and win them as clients.</CardDescription>
      </CardHeader>
      <CardContent className="p-6">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {signupMode !== "approval" ? (
            <Notice tone="warning" icon={<MailCheck />}>
              {MODE_NOTICE[signupMode]}
            </Notice>
          ) : (
            <Notice tone="info" icon={<Info />}>
              New accounts are reviewed by an administrator before you can start searching.
            </Notice>
          )}
          <Field label="Name" htmlFor={ids.name} error={errors.name}>
            <Input
              id={ids.name}
              autoComplete="name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              placeholder="Ama Mensah"
            />
          </Field>
          <Field label="Email" htmlFor={ids.email} error={errors.email}>
            <Input
              id={ids.email}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errors.email ? true : undefined}
              placeholder="you@studio.com"
            />
          </Field>
          <div className="grid gap-1.5">
            <Field label="Password" htmlFor={ids.password} error={errors.password}>
              <PasswordInput
                id={ids.password}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={ids.hint}
              />
            </Field>
            {!errors.password && (
              <p id={ids.hint} className={cn("text-xs text-muted-foreground transition-colors", longEnough && "text-success-soft-foreground")}>
                {longEnough ? "Good — at least 10 characters." : `At least ${MIN_PASSWORD_LENGTH} characters. A short phrase is easy to remember.`}
              </p>
            )}
          </div>
          {errors.form && (
            <p id={ids.form} role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {errors.form}
                {errors.form.includes("Sign in instead") && (
                  <>
                    {" "}
                    <Link href="/sign-in" className="font-medium underline underline-offset-4">
                      Go to sign in
                    </Link>
                  </>
                )}
              </span>
            </p>
          )}
          <Button type="submit" loading={pending} className="w-full">
            Create account
          </Button>
        </form>
        <p className="mt-6 text-center text-[13px] text-muted-foreground">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
