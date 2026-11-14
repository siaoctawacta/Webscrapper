import type { Metadata } from "next";
import { InvitationsPanel } from "@/components/admin/invitations-panel";
import { listInvitations } from "@/server/admin";
import { pageAdmin } from "@/server/auth/session";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Invitations · Admin" };

export default async function AdminInvitationsPage() {
  await pageAdmin();
  const invitations = await listInvitations();
  const signUpUrl = new URL("/sign-up", env().APP_URL).toString();
  return <InvitationsPanel initialData={{ invitations, signupMode: env().SIGNUP_MODE }} signUpUrl={signUpUrl} />;
}
