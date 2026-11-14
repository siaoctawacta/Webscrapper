import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { currentUser } from "@/server/auth/session";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  const me = await currentUser();
  if (me?.status === "active") redirect("/search");
  if (me?.status === "pending") redirect("/pending");
  return <SignUpForm signupMode={env().SIGNUP_MODE} />;
}
