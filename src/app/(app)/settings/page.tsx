import type { Metadata } from "next";
import { AccountCard } from "@/components/settings/account-card";
import { SenderProfileForm } from "@/components/settings/sender-profile-form";
import { PageHeader } from "@/components/ui/misc";
import { pageUser } from "@/server/auth/session";
import { getSenderProfile } from "@/server/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await pageUser();
  const profile = await getSenderProfile(me);
  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" description="Your details for proposals and your account." />
      <SenderProfileForm initialProfile={profile} />
      <AccountCard me={me} />
    </div>
  );
}
