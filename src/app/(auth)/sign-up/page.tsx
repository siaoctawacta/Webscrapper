import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { currentUser } from "@/server/auth/session";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Create account" };

const param = (v: string | string[] | undefined, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await currentUser();
  if (me?.status === "active") redirect("/search");
  if (me?.status === "pending") redirect("/pending");
  const sp = await searchParams;
  return (
    <SignUpForm
      signupMode={env().SIGNUP_MODE}
      inviteToken={param(sp.invite, 200)}
      setupToken={param(sp.setup, 200)}
      invitedEmail={param(sp.email, 254)}
    />
  );
}
