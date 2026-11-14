import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeNextPath } from "@/components/auth/safe-next";
import { currentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNextPath(first(sp.next));
  const me = await currentUser();
  if (me?.status === "active") redirect(next);
  const disabled = first(sp.disabled) === "1" || me?.status === "disabled";
  return <SignInForm next={next} disabled={disabled} />;
}
